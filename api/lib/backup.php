<?php
defined('GSF_API') or exit;

/** Backups: ZIP (overrides.json, media.json, optional uploads/*) in DATA_DIR/backups. */
final class Backups
{
    public const NAME_RE = '/^backup-\d{8}-\d{6}-[a-f0-9]{4}(-auto)?\.(zip|json)$/';
    private const MEDIA_ENTRY_RE = '#^uploads/([A-Za-z0-9][A-Za-z0-9._\-]{0,90}\.(?:jpe?g|png|webp))$#i';

    public static function validName(string $n): bool
    {
        return preg_match(self::NAME_RE, $n) === 1;
    }

    public static function dir(): string
    {
        if (!ensure_dir(BACKUP_DIR, true)) fail(503, 'Das Backup-Verzeichnis ist nicht beschreibbar.');
        if (!is_writable(BACKUP_DIR)) fail(503, 'Das Backup-Verzeichnis ist nicht beschreibbar.');
        return rtrim(BACKUP_DIR, '/');
    }

    private static function overridesDoc(PDO $pdo, string $note, bool $includeMedia, string $mediaSkipped = ''): array
    {
        $ov = Db::overrides($pdo);
        return [
            'format' => 'gsf-backup',
            'app_schema_version' => APP_SCHEMA_VERSION,
            'db_schema_version' => (int)Db::metaGet($pdo, 'schema_version', '1'),
            'created_at' => now_iso(),
            'note' => $note,
            'include_media' => $includeMedia,
            'media_skipped' => $mediaSkipped,
            'defaults_hash' => Content::defaultsHash(),
            'defaults_path_count' => count(Content::units(Content::defaults())),
            'override_count' => count($ov),
            'overrides' => $ov === [] ? new stdClass() : $ov,
        ];
    }

    /** Alle vorhandenen Dateien (Haupt- und Vorschaubilder, WebP) der Mediathek. @return string[] absolute Pfade */
    private static function mediaFiles(array $media): array
    {
        $files = [];
        foreach ($media as $r) {
            $name = Media::uploadName((string)$r['file']);
            if ($name === null) continue;
            foreach (Media::variants($name) as $abs) if (is_file($abs)) $files[$abs] = (int)@filesize($abs);
        }
        return $files;
    }

    /**
     * Backup anlegen. Automatische Backups ($auto) enthalten die Bilder, solange deren Gesamtgröße
     * AUTO_BACKUP_MEDIA_MAX_BYTES (30 MB) nicht übersteigt – sonst ohne Bilder (Hinweis in den Metadaten).
     */
    public static function create(PDO $pdo, string $note, bool $includeMedia, bool $auto = false): array
    {
        $dir = self::dir();
        @set_time_limit(300);
        $note = mb_substr(trim(strip_tags($note)), 0, 200);
        $media = [];
        foreach ($pdo->query('SELECT * FROM media') as $r) $media[] = $r;
        $warn = '';
        $skipped = '';
        $useZip = class_exists('ZipArchive');
        if ($auto) $includeMedia = true;
        $files = [];
        if ($includeMedia && !$useZip) {
            $includeMedia = false;
            $warn = 'Die PHP-Erweiterung zip fehlt – es wurde ein Backup ohne Bilder erstellt.';
            if ($auto) $skipped = 'zip-Erweiterung fehlt';
        }
        if ($includeMedia) {
            $files = self::mediaFiles($media);
            $total = array_sum($files);
            if ($auto && $total > AUTO_BACKUP_MEDIA_MAX_BYTES) {
                $includeMedia = false;
                $files = [];
                $skipped = 'Bilder (' . human_bytes((int)$total) . ') überschreiten ' . human_bytes(AUTO_BACKUP_MEDIA_MAX_BYTES) . ' – automatisches Backup ohne Bilder; Bilder bitte manuell sichern.';
            }
        }
        $doc = self::overridesDoc($pdo, $note, $includeMedia, $skipped);
        $stamp = date('Ymd-His') . '-' . rand_hex(2);
        $final = 'backup-' . $stamp . ($auto ? '-auto' : '') . ($useZip ? '.zip' : '.json');
        $target = $dir . '/' . $final;
        $tmp = $dir . '/.tmp-' . rand_hex(6);

        if ($useZip) {
            $zip = new ZipArchive();
            if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) fail(500, 'Backup-Datei konnte nicht angelegt werden.');
            $zip->addFromString('overrides.json', json_encode($doc, json_flags() | JSON_PRETTY_PRINT));
            $zip->addFromString('media.json', json_encode(['format' => 'gsf-media', 'media' => $media], json_flags() | JSON_PRETTY_PRINT));
            foreach (array_keys($files) as $abs) {
                $zip->addFile($abs, 'uploads/' . basename($abs));
                if (method_exists($zip, 'setCompressionName')) $zip->setCompressionName('uploads/' . basename($abs), ZipArchive::CM_STORE);
            }
            if (!$zip->close()) {
                @unlink($tmp);
                fail(500, 'Backup konnte nicht geschrieben werden (Speicherplatz?).');
            }
        } else {
            $doc['media'] = $media;
            if (file_put_contents($tmp, json_encode($doc, json_flags() | JSON_PRETTY_PRINT)) === false) fail(500, 'Backup konnte nicht geschrieben werden.');
        }
        if (!@rename($tmp, $target)) {
            @unlink($tmp);
            fail(500, 'Backup konnte nicht abgelegt werden.');
        }
        @chmod($target, 0640);
        if ($auto) self::pruneAuto();
        $r = self::describe($target);
        $r['warning'] = $warn ?: $skipped;
        return $r;
    }

    /** Höchstens einmal pro Tag automatisch sichern (nur wenn es Überschreibungen gibt). */
    public static function maybeDaily(PDO $pdo): void
    {
        try {
            $today = date('Y-m-d');
            if (Db::metaGet($pdo, 'last_auto_backup', '') === $today) return;
            $n = (int)$pdo->query('SELECT COUNT(*) FROM overrides')->fetchColumn();
            if ($n === 0) return;
            self::create($pdo, 'Automatische Tagessicherung', false, true);
            Db::metaSet($pdo, 'last_auto_backup', $today);
        } catch (Throwable $e) {
            log_error('Auto-Backup: ' . $e->getMessage());
        }
    }

    private static function pruneAuto(): void
    {
        $files = glob(rtrim(BACKUP_DIR, '/') . '/backup-*-auto.*') ?: [];
        rsort($files); // Name enthält Zeitstempel -> neueste zuerst
        foreach (array_slice($files, (int)MAX_AUTO_BACKUPS) as $f) @unlink($f);
    }

    public static function describe(string $abs): array
    {
        $name = basename($abs);
        $info = [
            'file' => $name,
            'bytes' => (int)@filesize($abs),
            'mtime' => gmdate('Y-m-d\TH:i:s\Z', (int)@filemtime($abs)),
            'auto' => (bool)preg_match('/-auto\./', $name),
            'type' => substr($name, -4) === '.zip' ? 'zip' : 'json',
            'note' => '', 'include_media' => false, 'media_skipped' => '', 'override_count' => null, 'media_files' => 0, 'created_at' => null,
        ];
        try {
            $doc = null;
            if ($info['type'] === 'zip' && class_exists('ZipArchive')) {
                $z = new ZipArchive();
                if ($z->open($abs) === true) {
                    $raw = $z->getFromName('overrides.json');
                    if ($raw !== false && strlen($raw) < 20000000) $doc = json_decode($raw, true);
                    for ($i = 0; $i < $z->numFiles; $i++) {
                        if (strpos((string)$z->getNameIndex($i), 'uploads/') === 0) $info['media_files']++;
                    }
                    $z->close();
                }
            } elseif ($info['type'] === 'json' && $info['bytes'] < 20000000) {
                $doc = json_decode((string)file_get_contents($abs), true);
            }
            if (is_array($doc)) {
                $info['note'] = (string)($doc['note'] ?? '');
                $info['include_media'] = (bool)($doc['include_media'] ?? false);
                $info['media_skipped'] = (string)($doc['media_skipped'] ?? '');
                $info['override_count'] = isset($doc['override_count']) ? (int)$doc['override_count'] : (is_array($doc['overrides'] ?? null) ? count($doc['overrides']) : null);
                $info['created_at'] = $doc['created_at'] ?? null;
            }
        } catch (Throwable $e) { /* Metadaten optional */ }
        return $info;
    }

    public static function list(): array
    {
        $out = [];
        $dir = rtrim(BACKUP_DIR, '/');
        if (!is_dir($dir)) return $out;
        foreach (scandir($dir) ?: [] as $n) {
            if (self::validName($n) && is_file($dir . '/' . $n)) $out[] = self::describe($dir . '/' . $n);
        }
        usort($out, function ($a, $b) { return strcmp($b['file'], $a['file']); });
        return $out;
    }

    public static function path(string $name): string
    {
        if (!self::validName($name)) fail(400, 'Ungültiger Dateiname.');
        $abs = rtrim(BACKUP_DIR, '/') . '/' . $name;
        $real = realpath($abs);
        $base = realpath(BACKUP_DIR);
        if ($real === false || $base === false || dirname($real) !== $base || !is_file($real)) fail(404, 'Backup nicht gefunden.');
        return $real;
    }

    public static function download(string $name): void
    {
        $abs = self::path($name);
        $isZip = substr($name, -4) === '.zip';
        header('Content-Type: ' . ($isZip ? 'application/zip' : 'application/json'));
        header('Content-Disposition: attachment; filename="' . $name . '"');
        header('Content-Length: ' . filesize($abs));
        header('Cache-Control: no-store');
        while (ob_get_level() > 0) ob_end_clean();
        readfile($abs);
    }

    public static function delete(string $name): void
    {
        $abs = self::path($name);
        if (!@unlink($abs)) fail(500, 'Backup konnte nicht gelöscht werden.');
    }

    // ------------------------------------------------------------ Wiederherstellung

    /**
     * Backup (ZIP oder JSON-Datei) einspielen: zuerst automatisches Backup, dann nur kompatible
     * Überschreibungen übernehmen. Bilder aus dem ZIP werden nach uploads/ zurückgeschrieben.
     */
    public static function restore(PDO $pdo, string $file, string $label): array
    {
        @set_time_limit(300);
        $head = (string)@file_get_contents($file, false, null, 0, 4);
        $zip = null;
        $doc = null;
        $mediaDoc = null;
        if (substr($head, 0, 2) === 'PK') {
            if (!class_exists('ZipArchive')) fail(503, 'Die PHP-Erweiterung zip fehlt – ZIP-Backups können nicht eingelesen werden.');
            $zip = new ZipArchive();
            if ($zip->open($file) !== true) fail(422, 'Die ZIP-Datei ist beschädigt oder kein Backup.');
            $st = $zip->statName('overrides.json');
            if (!$st || $st['size'] > 20000000) fail(422, 'Das ist kein gültiges Backup (overrides.json fehlt).');
            $doc = json_decode((string)$zip->getFromName('overrides.json'), true, 128);
            $mst = $zip->statName('media.json');
            if ($mst && $mst['size'] < 5000000) $mediaDoc = json_decode((string)$zip->getFromName('media.json'), true, 32);
        } else {
            if (filesize($file) > 20000000) fail(413, 'Datei zu groß.');
            $doc = json_decode((string)file_get_contents($file), true, 128);
            if (is_array($doc) && isset($doc['media']) && is_array($doc['media'])) $mediaDoc = ['media' => $doc['media']];
        }
        if (!is_array($doc) || ($doc['format'] ?? '') !== 'gsf-backup' || !is_array($doc['overrides'] ?? null)) {
            if ($zip) $zip->close();
            fail(422, 'Das ist kein gültiges Backup dieser Website.');
        }
        if ((int)($doc['app_schema_version'] ?? 1) > APP_SCHEMA_VERSION) {
            if ($zip) $zip->close();
            fail(422, 'Dieses Backup stammt von einer neueren Programmversion und kann hier nicht eingespielt werden.');
        }

        // 1) IMMER zuerst sichern
        $auto = self::create($pdo, 'Automatisch vor Wiederherstellung (' . mb_substr($label, 0, 60) . ')', true, true);

        // 2) Bilder zurückschreiben – wie Uploads durch GD neu kodiert (Metadaten/Fremdinhalte entfallen, Größe begrenzt);
        //    Dateien, die sich nicht verlustfrei lesen lassen, werden übersprungen.
        $mediaReport = ['restored' => 0, 'existing' => 0, 'rejected' => 0];
        if ($zip) {
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $st = $zip->statIndex($i);
                if (!$st || !preg_match(self::MEDIA_ENTRY_RE, (string)$st['name'], $m)) continue;
                $name = $m[1];
                if ($st['size'] > MAX_UPLOAD_BYTES || ($total += $st['size']) > 600 * 1048576) {
                    $mediaReport['rejected']++;
                    continue;
                }
                $dest = rtrim(UPLOAD_DIR, '/') . '/' . $name;
                if (is_file($dest)) {
                    $mediaReport['existing']++;
                    continue;
                }
                if (!ensure_dir(UPLOAD_DIR)) {
                    $mediaReport['rejected']++;
                    continue;
                }
                $data = $zip->getFromIndex($i);
                $tmpImg = rtrim(BACKUP_DIR, '/') . '/.img-' . rand_hex(6);
                $ok = $data !== false && @file_put_contents($tmpImg, $data) !== false
                    && Media::reencode($tmpImg, $dest, preg_match('/-thumb\.[a-z]+$/i', $name) ? THUMB_SIDE : IMAGE_MAX_SIDE);
                @unlink($tmpImg);
                unset($data);
                if ($ok) {
                    @chmod($dest, 0644);
                    $mediaReport['restored']++;
                } else {
                    $mediaReport['rejected']++;
                }
            }
            $zip->close();
        }
        if (is_array($mediaDoc['media'] ?? null)) {
            $ins = $pdo->prepare('INSERT OR REPLACE INTO media (file, original_name, width, height, bytes, alt, created_at) VALUES (?,?,?,?,?,?,?)');
            foreach ($mediaDoc['media'] as $r) {
                if (!is_array($r) || !isset($r['file'])) continue;
                $name = Media::uploadName((string)$r['file']);
                if ($name === null || !is_file(rtrim(UPLOAD_DIR, '/') . '/' . $name)) continue;
                $ins->execute([
                    Media::uploadPrefix() . $name,
                    mb_substr((string)($r['original_name'] ?? ''), 0, 120),
                    (int)($r['width'] ?? 0), (int)($r['height'] ?? 0), (int)($r['bytes'] ?? 0),
                    mb_substr(strip_tags((string)($r['alt'] ?? '')), 0, 300),
                    preg_match('/^\d{4}-\d\d-\d\dT/', (string)($r['created_at'] ?? '')) ? (string)$r['created_at'] : now_iso(),
                ]);
            }
        }

        // 3) Überschreibungen: nur kompatible übernehmen
        $raw = [];
        $skipped = [];
        foreach ($doc['overrides'] as $path => $o) {
            if (!is_array($o) || !array_key_exists('value', $o)) {
                $skipped[] = ['path' => (string)$path, 'reason' => 'Ungültiges Format'];
                continue;
            }
            $raw[(string)$path] = $o['value'];
        }
        [$ok, $skip2, $warnings] = Store::filterCompatible($raw);
        $skipped = array_merge($skipped, $skip2);
        if ($mediaReport['rejected'] > 0) $warnings[] = $mediaReport['rejected'] . ' Bilddatei(en) aus dem Backup konnten nicht verarbeitet werden und wurden übersprungen.';
        $rev = Store::replaceAll($pdo, $ok, 'Wiederherstellung aus „' . mb_substr($label, 0, 80) . '“');
        return [
            'imported' => count($ok),
            'skipped' => $skipped,
            'warnings' => $warnings,
            'media' => $mediaReport,
            'auto_backup' => $auto['file'],
            'auto_backup_note' => $auto['media_skipped'] ?? '',
            'rev' => $rev,
        ];
    }

    /** Export (Datei-Inhalt) einzelner Überschreibungen, z. B. „nicht mehr passende Einträge“. */
    public static function exportDoc(array $overrides, string $note): array
    {
        return [
            'format' => 'gsf-backup',
            'app_schema_version' => APP_SCHEMA_VERSION,
            'created_at' => now_iso(),
            'note' => $note,
            'include_media' => false,
            'defaults_hash' => Content::defaultsHash(),
            'override_count' => count($overrides),
            'overrides' => $overrides === [] ? new stdClass() : $overrides,
        ];
    }
}
