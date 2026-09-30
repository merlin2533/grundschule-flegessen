<?php
defined('GSF_API') or exit;

/** Schreibzugriffe auf die Überschreibungen (immer mit Revision + Versionszähler). */
final class Store
{
    /**
     * Änderungen speichern. $patch: Pfad => Wert | null (null = zurück auf Standard).
     * Optimistic Locking: Mit $baseRev (Stand, auf dem der Editor aufbaut) wird geprüft, ob einer der zu ändernden
     * Pfade seither von jemand anderem geändert wurde (path_rev > baseRev) – dann 409 „conflict“ mit den Pfaden,
     * ohne etwas zu schreiben. Mit $force wird trotzdem überschrieben. Ohne $baseRev keine Prüfung (API-Clients).
     * @return array{changed:int, rev:int, set:string[], removed:string[]}
     */
    public static function applyPatch(PDO $pdo, array $patch, string $note, ?int $baseRev = null, bool $force = false): array
    {
        if (!$patch) return ['changed' => 0, 'rev' => Db::contentRev($pdo), 'set' => [], 'removed' => []];
        if (count($patch) > 2000) fail(413, 'Zu viele Änderungen auf einmal.');
        $defaults = Content::defaults();
        $errors = [];
        $intent = []; // Pfad => bereinigter Wert | null
        foreach ($patch as $path => $value) {
            $path = (string)$path;
            if (!Content::pathValid($path)) {
                $errors[$path] = 'Ungültiger Pfad.';
                continue;
            }
            if ($value === null) {
                $intent[$path] = null;
                continue;
            }
            try {
                $intent[$path] = Content::sanitizeForPath($path, $value, $defaults);
            } catch (InvalidArgumentException $e) {
                $errors[$path] = $e->getMessage();
            }
        }
        if ($errors) fail(422, 'Einige Angaben sind ungültig und wurden nicht gespeichert.', ['errors' => $errors]);

        Backups::maybeDaily($pdo);

        // Vergleich, Konfliktprüfung und Schreiben in EINER Sofort-Transaktion (kein Zeitfenster für parallele Speicherungen).
        return Db::tx(function (PDO $pdo) use ($intent, $note, $defaults, $baseRev, $force) {
            $existing = Db::overrides($pdo);
            $set = [];
            $remove = [];
            foreach ($intent as $path => $clean) {
                if ($clean === null) {
                    if (isset($existing[$path])) $remove[] = $path;
                    continue;
                }
                if (Content::sameAsDefault($clean, Content::lookup($defaults, $path))) {
                    if (isset($existing[$path])) $remove[] = $path;
                    continue;
                }
                if (isset($existing[$path]) && json_encode($existing[$path]['value'], json_flags()) === json_encode($clean, json_flags())) continue;
                $set[$path] = $clean;
            }
            $n = count($set) + count($remove);
            $cur = Db::contentRev($pdo);
            if ($n === 0) return ['changed' => 0, 'rev' => $cur, 'set' => [], 'removed' => []];

            $paths = array_merge(array_keys($set), $remove);
            if (!$force && $baseRev !== null && $baseRev < $cur) {
                $conflicts = Db::changedSince($pdo, $paths, $baseRev);
                if ($conflicts) fail(409, 'conflict', ['paths' => $conflicts, 'rev' => $cur]);
            }
            $summary = ($note !== '' ? mb_substr($note, 0, 150) . ' – ' : '') . $n . ' Änderung' . ($n === 1 ? '' : 'en')
                . ': ' . implode(', ', array_slice($paths, 0, 3)) . (count($paths) > 3 ? ' …' : '');
            Db::addRevision($pdo, $summary);
            foreach ($remove as $p) Db::deleteOverride($pdo, $p);
            foreach ($set as $p => $v) Db::setOverride($pdo, $p, $v);
            $rev = Db::bumpRev($pdo);
            Db::markPaths($pdo, $paths, $rev);
            return ['changed' => $n, 'rev' => $rev, 'set' => array_keys($set), 'removed' => $remove];
        });
    }

    /**
     * Rohe Überschreibungen (Pfad => Wert) gegen den aktuellen Standard prüfen und migrieren.
     * Listen werden je Eintrag angepasst (entfernte Felder verworfen, neue Felder leer ergänzt, fehlende Bilder
     * geleert) – eine Liste wird nur übersprungen, wenn Pfad oder Typklasse nicht mehr existieren.
     * @return array{0:array,1:array,2:array} [kompatible Pfad=>bereinigter Wert, übersprungen [{path,reason}], Warnungen [string]]
     */
    public static function filterCompatible(array $raw): array
    {
        $defaults = Content::defaults();
        $ok = [];
        $skipped = [];
        $tot = ['missing_images' => 0, 'dropped_fields' => 0, 'dropped_items' => 0, 'filled_fields' => 0];
        $lists = 0;
        foreach ($raw as $path => $value) {
            $path = (string)$path;
            try {
                if (is_array($value) && is_list_array($value) && Content::pathValid($path)) {
                    $def = Content::lookup($defaults, $path, $found);
                    if ($found && Content::cls($def) === 'array' && Content::compat($path, $value, $defaults) === null) {
                        $st = [];
                        $value = Content::migrateList($value, Content::schema($def), true, $path, $st);
                        $adj = ($st['missing_images'] ?? 0) + ($st['dropped_fields'] ?? 0) + ($st['dropped_items'] ?? 0) + ($st['filled_fields'] ?? 0);
                        if ($adj > 0) $lists++;
                        foreach ($tot as $k => $_) $tot[$k] += $st[$k] ?? 0;
                    }
                }
                $clean = Content::sanitizeForPath($path, $value, $defaults);
                if (Content::sameAsDefault($clean, Content::lookup($defaults, $path))) {
                    $skipped[] = ['path' => $path, 'reason' => 'Entspricht bereits dem Standard'];
                    continue;
                }
                $ok[$path] = $clean;
            } catch (InvalidArgumentException $e) {
                $skipped[] = ['path' => $path, 'reason' => $e->getMessage()];
            }
        }
        $warn = [];
        $one = function (int $n, string $sing, string $plur) { return $n . ' ' . ($n === 1 ? $sing : $plur); };
        if ($tot['missing_images'] > 0) $warn[] = $one($tot['missing_images'], 'Bild fehlte', 'Bilder fehlten') . ' (Datei nicht mehr vorhanden) und wurde' . ($tot['missing_images'] === 1 ? '' : 'n') . ' in den Listen geleert.';
        if ($tot['dropped_items'] > 0) $warn[] = $one($tot['dropped_items'], 'Galerie-Eintrag ohne vorhandenes Hauptbild entfiel', 'Galerie-Einträge ohne vorhandenes Hauptbild entfielen') . '.';
        if ($tot['dropped_fields'] > 0) $warn[] = $one($tot['dropped_fields'], 'Feld in Listeneinträgen', 'Felder in Listeneinträgen') . ' gibt es auf der Website nicht mehr und ' . ($tot['dropped_fields'] === 1 ? 'wurde' : 'wurden') . ' verworfen.';
        if ($tot['filled_fields'] > 0) $warn[] = 'In Listeneinträgen ' . ($tot['filled_fields'] === 1 ? 'wurde 1 neues Feld' : 'wurden ' . $tot['filled_fields'] . ' neue Felder') . ' leer ergänzt.';
        return [$ok, $skipped, $warn];
    }

    /**
     * Überschreibungen durch die übergebenen (bereits geprüften) ersetzen. Bereits vorhandene nicht mehr passende
     * Einträge („Orphans“) bleiben gespeichert – nur passende Überschreibungen werden ersetzt oder entfernt.
     */
    public static function replaceAll(PDO $pdo, array $clean, string $note): int
    {
        return Db::tx(function (PDO $pdo) use ($clean, $note) {
            $defaults = Content::defaults();
            $existing = Db::overrides($pdo);
            Db::addRevision($pdo, $note);
            $touched = [];
            foreach ($existing as $p => $o) {
                if (Content::compat((string)$p, $o['value'], $defaults) !== null) continue; // Orphan: bleibt erhalten
                if (!array_key_exists($p, $clean)) {
                    Db::deleteOverride($pdo, (string)$p);
                    $touched[] = (string)$p;
                }
            }
            foreach ($clean as $p => $v) {
                if (isset($existing[$p]) && json_encode($existing[$p]['value'], json_flags()) === json_encode($v, json_flags())) continue;
                Db::setOverride($pdo, (string)$p, $v);
                $touched[] = (string)$p;
            }
            $rev = Db::bumpRev($pdo);
            Db::markPaths($pdo, $touched, $rev);
            return $rev;
        });
    }

    /** Auf Zustand einer Revision zurückgehen (Kompatibilitätsprüfung inklusive). */
    public static function restoreRevision(PDO $pdo, int $id): array
    {
        $st = $pdo->prepare('SELECT ts, note, snapshot FROM revisions WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) fail(404, 'Version nicht gefunden.');
        $snap = json_decode($row['snapshot'], true);
        if (!is_array($snap)) fail(500, 'Die gespeicherte Version ist beschädigt.');
        $raw = [];
        foreach ($snap as $p => $o) $raw[$p] = is_array($o) && array_key_exists('value', $o) ? $o['value'] : null;
        [$ok, $skipped, $warnings] = self::filterCompatible($raw);
        $rev = self::replaceAll($pdo, $ok, 'Zurückgesetzt auf Stand vom ' . $row['ts']);
        return ['imported' => count($ok), 'skipped' => $skipped, 'warnings' => $warnings, 'rev' => $rev];
    }

    /** Alles auf die ausgelieferten Standardinhalte zurücksetzen (nach automatischem Backup). */
    public static function resetAll(PDO $pdo): array
    {
        $backup = Backups::create($pdo, 'Automatisch vor „Alles zurücksetzen“', false, true);
        $rev = self::replaceAll($pdo, [], 'Alles auf Standard zurückgesetzt');
        return ['rev' => $rev, 'backup' => $backup['file']];
    }
}
