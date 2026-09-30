<?php
defined('GSF_API') or exit;

/** Schreibzugriffe auf die Überschreibungen (immer mit Revision + Versionszähler). */
final class Store
{
    /**
     * Änderungen speichern. $patch: Pfad => Wert | null (null = zurück auf Standard).
     * @return array{changed:int, rev:int, set:string[], removed:string[]}
     */
    public static function applyPatch(PDO $pdo, array $patch, string $note): array
    {
        if (!$patch) return ['changed' => 0, 'rev' => Db::contentRev($pdo), 'set' => [], 'removed' => []];
        if (count($patch) > 2000) fail(413, 'Zu viele Änderungen auf einmal.');
        $defaults = Content::defaults();
        $existing = Db::overrides($pdo);
        $errors = [];
        $set = [];
        $remove = [];
        foreach ($patch as $path => $value) {
            $path = (string)$path;
            if (!Content::pathValid($path)) {
                $errors[$path] = 'Ungültiger Pfad.';
                continue;
            }
            if ($value === null) {
                if (isset($existing[$path])) $remove[] = $path;
                continue;
            }
            try {
                $clean = Content::sanitizeForPath($path, $value, $defaults);
            } catch (InvalidArgumentException $e) {
                $errors[$path] = $e->getMessage();
                continue;
            }
            $def = Content::lookup($defaults, $path);
            if (Content::sameAsDefault($clean, $def)) {
                if (isset($existing[$path])) $remove[] = $path;
                continue;
            }
            if (isset($existing[$path]) && json_encode($existing[$path]['value'], json_flags()) === json_encode($clean, json_flags())) continue;
            $set[$path] = $clean;
        }
        if ($errors) fail(422, 'Einige Angaben sind ungültig und wurden nicht gespeichert.', ['errors' => $errors]);
        $n = count($set) + count($remove);
        if ($n === 0) return ['changed' => 0, 'rev' => Db::contentRev($pdo), 'set' => [], 'removed' => []];

        Backups::maybeDaily($pdo);

        $paths = array_merge(array_keys($set), $remove);
        $summary = ($note !== '' ? mb_substr($note, 0, 150) . ' – ' : '') . $n . ' Änderung' . ($n === 1 ? '' : 'en')
            . ': ' . implode(', ', array_slice($paths, 0, 3)) . (count($paths) > 3 ? ' …' : '');
        $rev = Db::tx(function (PDO $pdo) use ($set, $remove, $summary) {
            Db::addRevision($pdo, $summary);
            foreach ($remove as $p) Db::deleteOverride($pdo, $p);
            foreach ($set as $p => $v) Db::setOverride($pdo, $p, $v);
            return Db::bumpRev($pdo);
        });
        return ['changed' => $n, 'rev' => $rev, 'set' => array_keys($set), 'removed' => $remove];
    }

    /**
     * Rohe Überschreibungen (Pfad => Wert) gegen den aktuellen Standard prüfen.
     * @return array{0:array,1:array} [kompatible Pfad=>bereinigter Wert, übersprungen [{path,reason}]]
     */
    public static function filterCompatible(array $raw): array
    {
        $defaults = Content::defaults();
        $ok = [];
        $skipped = [];
        foreach ($raw as $path => $value) {
            $path = (string)$path;
            try {
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
        return [$ok, $skipped];
    }

    /** Alle Überschreibungen durch die übergebenen (bereits geprüften) ersetzen. */
    public static function replaceAll(PDO $pdo, array $clean, string $note): int
    {
        return Db::tx(function (PDO $pdo) use ($clean, $note) {
            Db::addRevision($pdo, $note);
            $pdo->exec('DELETE FROM overrides');
            foreach ($clean as $p => $v) Db::setOverride($pdo, (string)$p, $v);
            return Db::bumpRev($pdo);
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
        [$ok, $skipped] = self::filterCompatible($raw);
        $rev = self::replaceAll($pdo, $ok, 'Zurückgesetzt auf Stand vom ' . $row['ts']);
        return ['imported' => count($ok), 'skipped' => $skipped, 'rev' => $rev];
    }

    /** Alles auf die ausgelieferten Standardinhalte zurücksetzen (nach automatischem Backup). */
    public static function resetAll(PDO $pdo): array
    {
        $backup = Backups::create($pdo, 'Automatisch vor „Alles zurücksetzen“', false, true);
        $rev = self::replaceAll($pdo, [], 'Alles auf Standard zurückgesetzt');
        return ['rev' => $rev, 'backup' => $backup['file']];
    }
}
