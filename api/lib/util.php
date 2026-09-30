<?php
defined('GSF_API') or exit;

/** Fehler mit HTTP-Status, wird zentral als JSON ausgegeben. */
class ApiError extends RuntimeException
{
    public int $status;
    public array $extra;

    public function __construct(int $status, string $message, array $extra = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->extra = $extra;
    }
}

function fail(int $status, string $message, array $extra = []): void
{
    throw new ApiError($status, $message, $extra);
}

function is_list_array($a): bool
{
    if (!is_array($a)) return false;
    $i = 0;
    foreach ($a as $k => $_) {
        if ($k !== $i++) return false;
    }
    return true;
}

/** Erster Eintrag eines Proxy-Headers – nur wenn TRUST_PROXY_HEADERS aktiv ist, sonst immer null. */
function trusted_proxy_header(string $serverKey): ?string
{
    if (!TRUST_PROXY_HEADERS) return null;
    $v = (string)($_SERVER[$serverKey] ?? '');
    if ($v === '') return null;
    $first = trim(explode(',', $v)[0]);
    return $first === '' ? null : $first;
}

function is_https(): bool
{
    $proto = trusted_proxy_header('HTTP_X_FORWARDED_PROTO');
    if ($proto !== null) return strtolower($proto) === 'https';
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
    if (($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
    return false;
}

/** Client-IP. X-Forwarded-For wird ignoriert, außer TRUST_PROXY_HEADERS ist true (dann der erste Eintrag). */
function client_ip(): string
{
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $xff = trusted_proxy_header('HTTP_X_FORWARDED_FOR');
    if ($xff !== null && filter_var($xff, FILTER_VALIDATE_IP)) $ip = $xff;
    return substr($ip !== '' ? $ip : 'unknown', 0, 64);
}

/** Schlüssel für die Login-Begrenzung: IPv4 einzeln, IPv6 auf /64 zusammengefasst, IPv4-mapped als IPv4. */
function client_key(): string
{
    $ip = client_ip();
    $bin = filter_var($ip, FILTER_VALIDATE_IP) ? @inet_pton($ip) : false;
    if ($bin === false) return 'unknown';
    if (strlen($bin) === 16) {
        if (substr($bin, 0, 12) === "\0\0\0\0\0\0\0\0\0\0\xff\xff") return (string)inet_ntop(substr($bin, 12));
        return 'v6:' . bin2hex(substr($bin, 0, 8));
    }
    return (string)inet_ntop($bin);
}

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: DENY');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Cross-Origin-Resource-Policy: same-origin');
}

function json_flags(): int
{
    return JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;
}

function json_out($data, int $status = 200, bool $noStore = true): void
{
    $body = json_encode($data, json_flags());
    if ($body === false) {
        $status = 500;
        $body = '{"ok":false,"error":"Antwort konnte nicht erzeugt werden."}';
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    if ($noStore) header('Cache-Control: no-store');
    echo $body;
}

/** Wie json_out, aber für öffentliche Endpunkte mit ETag/304. */
function json_out_cached(string $body): void
{
    $etag = '"' . md5($body) . '"';
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    $inm = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if ($inm !== '') {
        foreach (explode(',', $inm) as $cand) {
            $cand = trim($cand);
            $cand = preg_replace('/^W\//', '', $cand);
            $cand = preg_replace('/-(gzip|br|deflate)"$/', '"', $cand);
            if ($cand === $etag || $cand === '*') {
                http_response_code(304);
                return;
            }
        }
    }
    http_response_code(200);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $body;
}

function require_method(string $m): void
{
    $actual = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($actual !== $m) {
        header('Allow: ' . $m);
        fail(405, 'Methode nicht erlaubt.');
    }
}

/** JSON-Body als assoziatives Array lesen (mit Größenlimit). */
function read_json_body(): array
{
    $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > MAX_JSON_BYTES) fail(413, 'Anfrage zu groß.');
    $raw = file_get_contents('php://input', false, null, 0, MAX_JSON_BYTES + 1);
    if ($raw === false) fail(400, 'Anfrage konnte nicht gelesen werden.');
    if (strlen($raw) > MAX_JSON_BYTES) fail(413, 'Anfrage zu groß.');
    if (trim($raw) === '') return [];
    $data = json_decode($raw, true, 64);
    if (!is_array($data)) fail(400, 'Ungültiges JSON.');
    return $data;
}

function read_json_file(string $file): array
{
    $raw = @file_get_contents($file);
    if ($raw === false) fail(500, 'Datei nicht lesbar: ' . basename($file));
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
    $data = json_decode($raw, true, 128);
    if (!is_array($data)) fail(500, 'Datei enthält kein gültiges JSON: ' . basename($file));
    return $data;
}

/** Verzeichnis anlegen und (falls neu) mit .htaccess-Sperre versehen. */
function ensure_dir(string $dir, bool $protect = false): bool
{
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0775, true) && !is_dir($dir)) return false;
    }
    if ($protect) {
        $ht = $dir . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "# Kein direkter Zugriff\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
        }
    }
    return is_dir($dir);
}

function log_error(string $msg): void
{
    error_log('[gsf-api] ' . $msg);
}

/** Kurze, sichere Zufallskennung (hex). */
function rand_hex(int $bytes = 4): string
{
    return bin2hex(random_bytes($bytes));
}

function human_bytes(int $b): string
{
    if ($b < 1024) return $b . ' B';
    if ($b < 1048576) return round($b / 1024, 1) . ' KB';
    if ($b < 1073741824) return round($b / 1048576, 1) . ' MB';
    return round($b / 1073741824, 1) . ' GB';
}

function ini_bytes(string $v): int
{
    $v = trim($v);
    if ($v === '') return 0;
    $n = (int)$v;
    switch (strtolower(substr($v, -1))) {
        case 'g': $n *= 1024;
        // no break
        case 'm': $n *= 1024;
        // no break
        case 'k': $n *= 1024;
    }
    return $n;
}

/* ---- Notlösungen, falls die PHP-Erweiterung mbstring fehlt ---- */
if (!function_exists('mb_check_encoding')) {
    function mb_check_encoding($s = null, $enc = null): bool { return preg_match('//u', (string)$s) === 1; }
}
if (!function_exists('mb_strlen')) {
    function mb_strlen($s, $enc = null): int { return preg_match_all('/./us', (string)$s) ?: 0; }
}
if (!function_exists('mb_substr')) {
    function mb_substr($s, $start, $len = null, $enc = null): string
    {
        if (preg_match_all('/./us', (string)$s, $m) === false) return substr((string)$s, $start, $len);
        return implode('', array_slice($m[0], $start, $len));
    }
}
