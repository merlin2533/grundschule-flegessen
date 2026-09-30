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

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
    if (($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
    return false;
}

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
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
    return round($b / 1048576, 1) . ' MB';
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
