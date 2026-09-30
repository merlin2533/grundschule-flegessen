<?php
defined('GSF_API') or exit;

final class Health
{
    /** level: ok | warn | error */
    private static function row(string $id, string $label, string $level, string $detail, string $hint = ''): array
    {
        return ['id' => $id, 'label' => $label, 'level' => $level, 'ok' => $level === 'ok', 'detail' => $detail, 'hint' => $hint];
    }

    public static function run(?PDO $pdo): array
    {
        $c = [];
        $c[] = self::row('php', 'PHP-Version', version_compare(PHP_VERSION, '8.0.0', '>=') ? 'ok' : 'warn', PHP_VERSION, 'Empfohlen: PHP 8.0 oder neuer.');
        $c[] = self::row('sqlite', 'SQLite (pdo_sqlite)', extension_loaded('pdo_sqlite') ? 'ok' : 'error',
            extension_loaded('pdo_sqlite') ? 'vorhanden (SQLite ' . (class_exists('SQLite3') ? SQLite3::version()['versionString'] : '?') . ')' : 'fehlt',
            'Ohne pdo_sqlite kann nichts gespeichert werden. Beim Hoster aktivieren.');
        $gd = extension_loaded('gd');
        $c[] = self::row('gd', 'Bildverarbeitung (GD)', $gd ? 'ok' : 'error', $gd ? 'vorhanden' : 'fehlt', 'Ohne GD sind keine Bild-Uploads möglich.');
        if ($gd) {
            $g = gd_info();
            $c[] = self::row('gd_formats', 'GD: JPEG/PNG', !empty($g['JPEG Support']) && !empty($g['PNG Support']) ? 'ok' : 'error',
                'JPEG ' . (!empty($g['JPEG Support']) ? 'ja' : 'nein') . ', PNG ' . (!empty($g['PNG Support']) ? 'ja' : 'nein'));
            $webp = !empty($g['WebP Support']) && function_exists('imagewebp');
            $c[] = self::row('gd_webp', 'GD: WebP', $webp ? 'ok' : 'warn', $webp ? 'vorhanden' : 'fehlt', 'Ohne WebP werden nur JPEG/PNG-Dateien erzeugt (funktioniert trotzdem).');
        }
        $c[] = self::row('zip', 'ZIP (Backups mit Bildern)', class_exists('ZipArchive') ? 'ok' : 'warn', class_exists('ZipArchive') ? 'vorhanden' : 'fehlt',
            'Ohne zip werden Backups als einfache JSON-Datei ohne Bilder erstellt.');
        $c[] = self::row('dom', 'HTML-Bereinigung (dom)', class_exists('DOMDocument') ? 'ok' : 'warn', class_exists('DOMDocument') ? 'vorhanden' : 'fehlt',
            'Ohne dom wird eine einfachere Notlösung zur Bereinigung genutzt.');
        $c[] = self::row('mbstring', 'mbstring', extension_loaded('mbstring') ? 'ok' : 'warn', extension_loaded('mbstring') ? 'vorhanden' : 'fehlt');
        $c[] = self::row('fileinfo', 'Dateityp-Erkennung (fileinfo)', extension_loaded('fileinfo') ? 'ok' : 'warn', extension_loaded('fileinfo') ? 'vorhanden' : 'fehlt',
            'Uploads werden zusätzlich über getimagesize geprüft.');
        $c[] = self::row('exif', 'EXIF-Ausrichtung', 'ok', function_exists('exif_read_data') ? 'exif-Erweiterung vorhanden' : 'integrierte Auswertung wird genutzt');

        foreach ([['data', 'Datenverzeichnis (data/)', DATA_DIR], ['backups', 'Backup-Verzeichnis', BACKUP_DIR], ['uploads', 'Upload-Verzeichnis (uploads/)', UPLOAD_DIR]] as [$id, $label, $dir]) {
            $exists = is_dir($dir);
            $w = $exists && is_writable($dir);
            $c[] = self::row('dir_' . $id, $label, $w ? 'ok' : ($id === 'backups' && !$exists ? 'warn' : 'error'),
                $w ? 'beschreibbar' : ($exists ? 'nicht beschreibbar' : 'nicht vorhanden'),
                $w ? '' : 'Schreibrechte (chmod 775) für dieses Verzeichnis setzen.');
        }
        $c[] = self::row('content_file', 'Standardinhalt (content/content.json)', is_readable(CONTENT_FILE) ? 'ok' : 'error', is_readable(CONTENT_FILE) ? 'lesbar' : 'nicht lesbar');
        if (is_file(DB_FILE)) {
            $c[] = self::row('dbsize', 'Datenbank-Größe', 'ok', human_bytes((int)filesize(DB_FILE)));
        }
        $free = @disk_free_space(is_dir(DATA_DIR) ? DATA_DIR : ROOT_DIR);
        if ($free !== false) {
            $c[] = self::row('disk', 'Freier Speicherplatz', $free > 100 * 1048576 ? 'ok' : ($free > 20 * 1048576 ? 'warn' : 'error'), human_bytes((int)$free));
        }
        $um = ini_bytes((string)ini_get('upload_max_filesize'));
        $pm = ini_bytes((string)ini_get('post_max_size'));
        $eff = min($um ?: PHP_INT_MAX, $pm ?: PHP_INT_MAX);
        $c[] = self::row('limits', 'Upload-Limits von PHP', $eff >= 4 * 1048576 ? 'ok' : 'warn',
            'upload_max_filesize ' . ini_get('upload_max_filesize') . ', post_max_size ' . ini_get('post_max_size'),
            'Bilder werden vor dem Hochladen im Browser verkleinert. Große Backups (mit Bildern) brauchen ein höheres Limit.');
        $c[] = self::row('https', 'Verschlüsselte Verbindung (HTTPS)', is_https() ? 'ok' : 'warn', is_https() ? 'aktiv' : 'nicht aktiv',
            'Für den Admin-Bereich unbedingt HTTPS nutzen (Passwort und Sitzung).');
        if ($pdo) {
            $initial = Db::metaGet($pdo, 'password_is_initial', '0') === '1';
            $c[] = self::row('password', 'Admin-Passwort', $initial ? 'warn' : 'ok', $initial ? 'Start-Passwort noch aktiv' : 'individuell gesetzt',
                $initial ? 'Bitte unter Einstellungen ein eigenes Passwort festlegen.' : '');
            $c[] = self::row('schema', 'Datenbank-Schema', 'ok', 'Version ' . Db::metaGet($pdo, 'schema_version', '?'));
        }
        return $c;
    }
}
