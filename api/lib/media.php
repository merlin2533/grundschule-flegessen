<?php
defined('GSF_API') or exit;

/** Bilder: Upload (GD-Neucodierung), Mediathek, Löschen. */
final class Media
{
    public const MAIN_RE = '/^[A-Za-z0-9][A-Za-z0-9_\-]{0,80}\.(jpg|jpeg|png)$/';

    public static function uploadPrefix(): string
    {
        return trim(UPLOAD_URL, '/') . '/';
    }

    /** Relativer Pfad -> Dateiname, nur für Hauptbilder in uploads/. */
    public static function uploadName(string $rel): ?string
    {
        $pre = self::uploadPrefix();
        if (strpos($rel, $pre) !== 0) return null;
        $name = substr($rel, strlen($pre));
        if (!preg_match(self::MAIN_RE, $name) || preg_match('/-thumb\.[a-z]+$/i', $name)) return null;
        return $name;
    }

    /** Varianten eines Hauptbildes (Dateisystempfade), z. B. -thumb und .webp. */
    public static function variants(string $name): array
    {
        $base = preg_replace('/\.[a-z]+$/i', '', $name);
        $ext = substr($name, strlen($base));
        $dir = rtrim(UPLOAD_DIR, '/') . '/';
        return [
            'main' => $dir . $name,
            'thumb' => $dir . $base . '-thumb' . $ext,
            'webp' => $dir . $base . '.webp',
            'thumbWebp' => $dir . $base . '-thumb.webp',
        ];
    }

    // ------------------------------------------------------------ Upload

    /** PHP verwirft zu große POST-Bodys stillschweigend – dann eine verständliche Meldung liefern. */
    public static function checkPostSize(): void
    {
        $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        $max = ini_bytes((string)ini_get('post_max_size'));
        if ($len > 0 && $max > 0 && $len > $max) {
            fail(413, 'Die Datei ist größer als das Limit dieses Servers (post_max_size ' . ini_get('post_max_size') . ').');
        }
    }

    public static function handleUpload(PDO $pdo): array
    {
        if (!extension_loaded('gd')) fail(503, 'Die PHP-Erweiterung GD fehlt – Bilder können nicht verarbeitet werden.');
        self::checkPostSize();
        if (!isset($_FILES['file']) || !is_array($_FILES['file'])) fail(400, 'Keine Datei empfangen (Feld „file“).');
        $f = $_FILES['file'];
        if (is_array($f['error'])) fail(400, 'Bitte je Anfrage nur eine Datei senden.');
        switch ($f['error']) {
            case UPLOAD_ERR_OK: break;
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE: fail(413, 'Die Datei ist größer als erlaubt (max. ' . human_bytes(MAX_UPLOAD_BYTES) . ').');
            case UPLOAD_ERR_NO_FILE: fail(400, 'Keine Datei ausgewählt.');
            default: fail(500, 'Upload fehlgeschlagen (Code ' . (int)$f['error'] . ').');
        }
        if (!is_uploaded_file($f['tmp_name'])) fail(400, 'Ungültiger Upload.');
        if ((int)$f['size'] > MAX_UPLOAD_BYTES) fail(413, 'Die Datei ist zu groß (max. ' . human_bytes(MAX_UPLOAD_BYTES) . ').');
        $alt = isset($_POST['alt']) ? trim(mb_substr(strip_tags((string)$_POST['alt']), 0, 300)) : '';
        $orig = mb_substr(preg_replace('/[^\p{L}\p{N} ._\-()]/u', '', basename((string)$f['name'])), 0, 120);
        return self::processFile($pdo, $f['tmp_name'], $orig, $alt);
    }

    /** Bilddatei prüfen, neu kodieren, Varianten erzeugen, in DB eintragen. */
    public static function processFile(PDO $pdo, string $tmp, string $origName, string $alt): array
    {
        $bytes = (int)@filesize($tmp);
        if ($bytes <= 0) fail(400, 'Leere Datei.');
        if ($bytes > MAX_UPLOAD_BYTES) fail(413, 'Die Datei ist zu groß (max. ' . human_bytes(MAX_UPLOAD_BYTES) . ').');
        if (!ensure_dir(UPLOAD_DIR, false)) fail(503, 'Das Upload-Verzeichnis ist nicht beschreibbar.');
        if (!is_writable(UPLOAD_DIR)) fail(503, 'Das Upload-Verzeichnis ist nicht beschreibbar.');

        $info = @getimagesize($tmp);
        if (!$info) fail(415, 'Das ist keine gültige Bilddatei. Erlaubt sind JPEG, PNG und WebP.');
        $type = $info[2];
        if (!in_array($type, [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
            fail(415, 'Dateityp nicht erlaubt. Erlaubt sind JPEG, PNG und WebP.');
        }
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            $mime = $fi ? finfo_file($fi, $tmp) : null;
            if ($fi) finfo_close($fi);
            if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
                fail(415, 'Dateityp nicht erlaubt (erkannt: ' . ($mime ?: 'unbekannt') . ').');
            }
        }
        $w = (int)$info[0];
        $h = (int)$info[1];
        if ($w < 1 || $h < 1 || $w > 12000 || $h > 12000 || $w * $h > 50000000) fail(413, 'Das Bild hat zu viele Pixel (max. 50 Megapixel).');

        $mem = ini_bytes((string)ini_get('memory_limit'));
        if ($mem > 0 && $mem < 512 * 1048576) @ini_set('memory_limit', '512M');
        @set_time_limit(120);

        if ($type === IMAGETYPE_JPEG) $im = @imagecreatefromjpeg($tmp);
        elseif ($type === IMAGETYPE_PNG) $im = @imagecreatefrompng($tmp);
        else {
            if (!function_exists('imagecreatefromwebp')) fail(415, 'WebP wird von diesem Server nicht unterstützt.');
            $im = @imagecreatefromwebp($tmp);
        }
        if (!$im) fail(415, 'Das Bild konnte nicht gelesen werden (beschädigt?).');
        if (!imageistruecolor($im)) imagepalettetotruecolor($im);

        if ($type === IMAGETYPE_JPEG) {
            $o = self::exifOrientation($tmp);
            $im = self::orient($im, $o);
        }
        $hasAlpha = $type !== IMAGETYPE_JPEG && self::hasAlpha($im);

        $im = self::fit($im, IMAGE_MAX_SIDE);
        $thumb = self::fit($im, THUMB_SIDE, true);
        $fw = imagesx($im);
        $fh = imagesy($im);

        $ext = $hasAlpha ? '.png' : '.jpg';
        $dir = rtrim(UPLOAD_DIR, '/') . '/';
        $tries = 0;
        do {
            $base = date('Ym') . '-' . rand_hex(4);
            $tries++;
        } while ((is_file($dir . $base . $ext) || is_file($dir . $base . '.webp')) && $tries < 20);
        $name = $base . $ext;
        $v = self::variants($name);

        $ok = self::save($im, $v['main'], $hasAlpha);
        if ($ok) self::save($thumb, $v['thumb'], $hasAlpha);
        if ($ok && function_exists('imagewebp')) {
            @imagewebp($im, $v['webp'], 80);
            @imagewebp($thumb, $v['thumbWebp'], 78);
        }
        imagedestroy($im);
        if ($thumb !== $im) imagedestroy($thumb);
        if (!$ok || !is_file($v['main'])) {
            foreach ($v as $p) @unlink($p);
            fail(500, 'Das Bild konnte nicht gespeichert werden.');
        }
        foreach ($v as $p) if (is_file($p)) @chmod($p, 0644);

        $rel = self::uploadPrefix() . $name;
        $st = $pdo->prepare('INSERT OR REPLACE INTO media (file, original_name, width, height, bytes, alt, created_at) VALUES (?,?,?,?,?,?,?)');
        $st->execute([$rel, $origName, $fw, $fh, (int)filesize($v['main']), $alt, now_iso()]);

        return [
            'file' => $rel,
            'thumb' => is_file($v['thumb']) ? self::uploadPrefix() . basename($v['thumb']) : $rel,
            'webp' => is_file($v['webp']) ? self::uploadPrefix() . basename($v['webp']) : '',
            'thumbWebp' => is_file($v['thumbWebp']) ? self::uploadPrefix() . basename($v['thumbWebp']) : '',
            'width' => $fw,
            'height' => $fh,
            'bytes' => (int)filesize($v['main']),
            'alt' => $alt,
            'original_name' => $origName,
        ];
    }

    /**
     * Bilddatei (z. B. aus einem Backup) mit GD neu kodieren und unter $dest ablegen; Format nach Zieldatei-Endung
     * (jpg/jpeg, png, webp). Prüft Typ und Größe, wendet die EXIF-Ausrichtung an und begrenzt die Kantenlänge.
     * @return bool false = Datei unbrauchbar (überspringen)
     */
    public static function reencode(string $src, string $dest, int $max): bool
    {
        if (!extension_loaded('gd')) return false;
        $bytes = (int)@filesize($src);
        if ($bytes <= 0 || $bytes > MAX_UPLOAD_BYTES) return false;
        $info = @getimagesize($src);
        if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) return false;
        $w = (int)$info[0];
        $h = (int)$info[1];
        if ($w < 1 || $h < 1 || $w > 12000 || $h > 12000 || $w * $h > 50000000) return false;
        $mem = ini_bytes((string)ini_get('memory_limit'));
        if ($mem > 0 && $mem < 512 * 1048576) @ini_set('memory_limit', '512M');
        $type = $info[2];
        if ($type === IMAGETYPE_JPEG) $im = @imagecreatefromjpeg($src);
        elseif ($type === IMAGETYPE_PNG) $im = @imagecreatefrompng($src);
        else $im = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($src) : false;
        if (!$im) return false;
        if (!imageistruecolor($im)) imagepalettetotruecolor($im);
        if ($type === IMAGETYPE_JPEG) $im = self::orient($im, self::exifOrientation($src));
        $im = self::fit($im, $max);
        $ext = strtolower(pathinfo($dest, PATHINFO_EXTENSION));
        $tmp = $dest . '.tmp' . rand_hex(3);
        $ok = false;
        if ($ext === 'png') {
            imagesavealpha($im, true);
            $ok = @imagepng($im, $tmp, 9);
        } elseif ($ext === 'webp') {
            if (function_exists('imagewebp')) {
                imagesavealpha($im, true);
                $ok = @imagewebp($im, $tmp, 80);
            }
        } else {
            // JPEG kennt keine Transparenz: auf Weiß setzen
            $bg = imagecreatetruecolor(imagesx($im), imagesy($im));
            imagefill($bg, 0, 0, imagecolorallocate($bg, 255, 255, 255));
            imagecopy($bg, $im, 0, 0, 0, 0, imagesx($im), imagesy($im));
            imagedestroy($im);
            $im = $bg;
            imageinterlace($im, true);
            $ok = @imagejpeg($im, $tmp, JPEG_QUALITY);
        }
        imagedestroy($im);
        if (!$ok || !is_file($tmp) || filesize($tmp) === 0 || !@rename($tmp, $dest)) {
            @unlink($tmp);
            return false;
        }
        return true;
    }

    private static function save($im, string $path, bool $png): bool
    {
        if ($png) {
            imagesavealpha($im, true);
            return @imagepng($im, $path, 9);
        }
        imageinterlace($im, true);
        return @imagejpeg($im, $path, JPEG_QUALITY);
    }

    /** Auf max. Kantenlänge verkleinern (nie vergrößern). $copy = immer Kopie liefern. */
    private static function fit($im, int $max, bool $copy = false)
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $long = max($w, $h);
        if ($long <= $max) {
            if (!$copy) return $im;
            $c = imagecreatetruecolor($w, $h);
            imagealphablending($c, false);
            imagesavealpha($c, true);
            imagecopy($c, $im, 0, 0, 0, 0, $w, $h);
            return $c;
        }
        $s = $max / $long;
        $nw = max(1, (int)round($w * $s));
        $nh = max(1, (int)round($h * $s));
        $c = imagecreatetruecolor($nw, $nh);
        imagealphablending($c, false);
        imagesavealpha($c, true);
        imagefill($c, 0, 0, imagecolorallocatealpha($c, 255, 255, 255, 127));
        imagecopyresampled($c, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
        if (!$copy) imagedestroy($im);
        return $c;
    }

    private static function hasAlpha($im): bool
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $sx = max(1, (int)floor($w / 48));
        $sy = max(1, (int)floor($h / 48));
        for ($y = 0; $y < $h; $y += $sy) {
            for ($x = 0; $x < $w; $x += $sx) {
                if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) > 0) return true;
            }
        }
        return false;
    }

    private static function orient($im, int $o)
    {
        switch ($o) {
            case 2: imageflip($im, IMG_FLIP_HORIZONTAL); return $im;
            case 3: $r = imagerotate($im, 180, 0); break;
            case 4: imageflip($im, IMG_FLIP_VERTICAL); return $im;
            case 5: imageflip($im, IMG_FLIP_HORIZONTAL); $r = imagerotate($im, 90, 0); break;
            case 6: $r = imagerotate($im, -90, 0); break;
            case 7: imageflip($im, IMG_FLIP_HORIZONTAL); $r = imagerotate($im, -90, 0); break;
            case 8: $r = imagerotate($im, 90, 0); break;
            default: return $im;
        }
        if ($r) {
            imagedestroy($im);
            return $r;
        }
        return $im;
    }

    /** EXIF-Orientierung eines JPEGs (ohne exif-Erweiterung lesbar). */
    public static function exifOrientation(string $file): int
    {
        $fh = @fopen($file, 'rb');
        if (!$fh) return 1;
        try {
            if (fread($fh, 2) !== "\xFF\xD8") return 1;
            for ($i = 0; $i < 20; $i++) {
                $h = fread($fh, 4);
                if (strlen($h) < 4 || $h[0] !== "\xFF") return 1;
                $marker = ord($h[1]);
                $len = unpack('n', substr($h, 2, 2))[1];
                if ($marker === 0xDA || $marker === 0xD9) return 1;
                if ($marker === 0xE1 && $len >= 16) {
                    $data = fread($fh, min($len - 2, 65536));
                    if (substr($data, 0, 6) !== "Exif\0\0") return 1;
                    $t = substr($data, 6);
                    $le = substr($t, 0, 2) === 'II';
                    if (!$le && substr($t, 0, 2) !== 'MM') return 1;
                    $u16 = function ($s, $o) use ($le) { return unpack($le ? 'v' : 'n', substr($s, $o, 2))[1] ?? 0; };
                    $u32 = function ($s, $o) use ($le) { return unpack($le ? 'V' : 'N', substr($s, $o, 4))[1] ?? 0; };
                    $ifd = $u32($t, 4);
                    if ($ifd < 8 || $ifd > strlen($t) - 2) return 1;
                    $n = $u16($t, $ifd);
                    for ($k = 0; $k < $n && $k < 64; $k++) {
                        $e = $ifd + 2 + $k * 12;
                        if ($e + 12 > strlen($t)) return 1;
                        if ($u16($t, $e) === 0x0112) {
                            $v = $u16($t, $e + 8);
                            return ($v >= 1 && $v <= 8) ? $v : 1;
                        }
                    }
                    return 1;
                }
                fseek($fh, $len - 2, SEEK_CUR);
            }
        } finally {
            fclose($fh);
        }
        return 1;
    }

    // ------------------------------------------------------------ Liste

    /** Alle Strings im Baum mit ihren Pfaden (für „wird verwendet in“). */
    public static function usageMap(array $tree, string $prefix = '', array &$map = []): array
    {
        foreach ($tree as $k => $v) {
            $p = $prefix === '' ? (string)$k : $prefix . (is_int($k) ? '[' . ($k + 1) . ']' : '.' . $k);
            if (is_array($v)) self::usageMap($v, $p, $map);
            elseif (is_string($v) && preg_match('#^(uploads|assets/images)/#', $v)) $map[$v][] = preg_replace('/\.file$/', '', $p);
        }
        return $map;
    }

    public static function listAll(PDO $pdo, array $effective): array
    {
        $usage = self::usageMap($effective);
        $rows = [];
        foreach ($pdo->query('SELECT * FROM media') as $r) $rows[$r['file']] = $r;

        $uploads = [];
        $pre = self::uploadPrefix();
        $dir = rtrim(UPLOAD_DIR, '/') . '/';
        foreach (glob($dir . '*') ?: [] as $abs) {
            $name = basename($abs);
            if (!is_file($abs) || !preg_match(self::MAIN_RE, $name) || preg_match('/-thumb\.[a-z]+$/i', $name)) continue;
            $rel = $pre . $name;
            $r = $rows[$rel] ?? null;
            $v = self::variants($name);
            if ($r && $r['width']) {
                $wd = (int)$r['width'];
                $ht = (int)$r['height'];
            } else {
                $gi = @getimagesize($abs);
                $wd = $gi ? (int)$gi[0] : 0;
                $ht = $gi ? (int)$gi[1] : 0;
            }
            $uploads[] = [
                'file' => $rel,
                'thumb' => is_file($v['thumb']) ? $pre . basename($v['thumb']) : $rel,
                'webp' => is_file($v['webp']) ? $pre . basename($v['webp']) : '',
                'thumbWebp' => is_file($v['thumbWebp']) ? $pre . basename($v['thumbWebp']) : '',
                'name' => $r['original_name'] ?? $name,
                'width' => $wd,
                'height' => $ht,
                'bytes' => (int)filesize($abs),
                'alt' => $r['alt'] ?? '',
                'created_at' => $r['created_at'] ?? gmdate('Y-m-d\TH:i:s\Z', (int)filemtime($abs)),
                'source' => 'upload',
                'used' => count($usage[$rel] ?? []) + count($usage[$pre . basename($v['thumb'])] ?? []),
            ];
        }
        usort($uploads, function ($a, $b) { return strcmp($b['created_at'], $a['created_at']); });

        $site = [];
        $root = rtrim(ROOT_DIR, '/') . '/assets/images';
        if (is_dir($root)) {
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $fi) {
                if (!$fi->isFile()) continue;
                $n = $fi->getFilename();
                if (!preg_match('/\.(jpe?g|png)$/i', $n)) continue;
                if (preg_match('/-thumb\.[a-z]+$/i', $n) || preg_match('/-\d+w\.[a-z]+$/i', $n)) continue;
                $rel = 'assets/images/' . str_replace('\\', '/', substr($fi->getPathname(), strlen($root) + 1));
                $site[] = [
                    'file' => $rel,
                    'thumb' => $rel,
                    'name' => $n,
                    'folder' => dirname(substr($rel, strlen('assets/images/'))),
                    'bytes' => (int)$fi->getSize(),
                    'source' => 'site',
                    'used' => count($usage[$rel] ?? []),
                ];
            }
            usort($site, function ($a, $b) { return strcmp($a['file'], $b['file']); });
        }
        return ['uploads' => $uploads, 'site' => $site];
    }

    // ------------------------------------------------------------ Löschen

    public static function delete(PDO $pdo, string $rel, bool $force, array $effective): array
    {
        $name = self::uploadName($rel);
        if ($name === null) fail(400, 'Nur hochgeladene Bilder können gelöscht werden.');
        $v = self::variants($name);
        $real = realpath($v['main']);
        $base = realpath(UPLOAD_DIR);
        if ($real === false || $base === false || strpos($real, $base . DIRECTORY_SEPARATOR) !== 0) fail(404, 'Bild nicht gefunden.');

        $usage = self::usageMap($effective);
        $pre = self::uploadPrefix();
        $used = [];
        foreach (['main', 'thumb', 'webp', 'thumbWebp'] as $k) {
            foreach ($usage[$pre . basename($v[$k])] ?? [] as $p) $used[] = $p;
        }
        if ($used && !$force) {
            fail(409, 'Dieses Bild wird noch verwendet.', ['used_in' => array_values(array_unique($used)), 'needs_force' => true]);
        }
        foreach ($v as $p) if (is_file($p)) @unlink($p);
        $pdo->prepare('DELETE FROM media WHERE file = ?')->execute([$rel]);
        return ['deleted' => $rel, 'was_used_in' => array_values(array_unique($used))];
    }
}
