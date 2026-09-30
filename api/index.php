<?php
/**
 * Grundschule Flegessen – kleine JSON-API (keine Abhängigkeiten).
 * Aufruf: api/?a=<aktion>. Öffentlich: content, gallery, version. Alles andere: Admin (Login + CSRF).
 */
define('GSF_API', true);

@ini_set('display_errors', '0');
@ini_set('html_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set('Europe/Berlin');
if (function_exists('mb_internal_encoding')) mb_internal_encoding('UTF-8');

require __DIR__ . '/config.php';
foreach (['util', 'html', 'db', 'content', 'auth', 'media', 'store', 'backup', 'health'] as $lib) {
    require __DIR__ . '/lib/' . $lib . '.php';
}

set_error_handler(function ($no, $str, $file, $line) {
    if (!(error_reporting() & $no)) return false;
    log_error("PHP[$no] $str @ " . basename($file) . ":$line");
    return true;
});

send_security_headers();

try {
    $action = (string)($_GET['a'] ?? '');
    if (!preg_match('/^[a-z_]{1,32}$/', $action)) fail(400, 'Aktion fehlt oder ist ungültig.');

    $public = ['content', 'gallery', 'version'];
    // method, needs csrf
    $admin = [
        'login' => ['POST', true], 'logout' => ['POST', true], 'session' => ['GET', false],
        'admin_content' => ['GET', false], 'save' => ['POST', true],
        'upload' => ['POST', true], 'media' => ['GET', false], 'media_alt' => ['POST', true], 'media_delete' => ['POST', true],
        'revisions' => ['GET', false], 'revision_restore' => ['POST', true],
        'reset_path' => ['POST', true], 'reset_all' => ['POST', true],
        'backup_create' => ['POST', true], 'backup_list' => ['GET', false], 'backup_download' => ['GET', false],
        'backup_delete' => ['POST', true], 'backup_restore' => ['POST', true],
        'orphans_delete' => ['POST', true], 'orphans_export' => ['GET', false],
        'password_change' => ['POST', true], 'health' => ['GET', false], 'health_cleanup' => ['POST', true],
    ];
    // Solange das Passwort noch gewechselt werden muss (Start-Passwort / nach Reset), sind nur diese Aktionen erlaubt.
    $allowedWhileMustChange = ['session', 'login', 'logout', 'password_change', 'health'];

    if (in_array($action, $public, true)) {
        // Öffentliche Besucher bekommen niemals ein Cookie.
        if (session_status() === PHP_SESSION_ACTIVE) session_abort();
        header_remove('Set-Cookie');
        if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
            header('Allow: GET, HEAD');
            fail(405, 'Methode nicht erlaubt.');
        }
        $pdo = Db::tryPublic();
        $state = Content::state($pdo);
        if ($action === 'content') {
            json_out_cached((string)json_encode(Content::withoutGallery($state['effective']), json_flags()));
        } elseif ($action === 'gallery') {
            json_out_cached((string)json_encode($state['effective']['gallery']['items'] ?? [], json_flags()));
        } else {
            $vid = 'dev';
            if (is_file(VERSION_FILE)) {
                $v = json_decode((string)@file_get_contents(VERSION_FILE), true);
                if (is_array($v) && isset($v['id']) && is_string($v['id']) && $v['id'] !== '') $vid = $v['id'];
            }
            json_out_cached((string)json_encode(['id' => $vid . '.' . $state['rev']], json_flags()));
        }
        exit;
    }

    if (!isset($admin[$action])) fail(404, 'Unbekannte Aktion.');
    [$method, $needsCsrf] = $admin[$action];
    require_method($method);
    Auth::start();

    // ---- ohne Login erlaubt
    if ($action === 'session') {
        $authed = Auth::authenticated();
        $must = false;
        if ($authed) {
            $pdo = Db::pdo();
            if (Auth::sessionCurrent($pdo)) $must = Auth::mustChangePassword($pdo);
            else { Auth::dropLogin(); $authed = false; }
        }
        json_out(['ok' => true, 'authenticated' => $authed, 'must_change_password' => $must, 'csrf' => Auth::csrf(), 'https' => is_https(),
            'db' => Db::available()]);
        exit;
    }
    if ($action === 'login') {
        Auth::requireCsrf();
        $body = read_json_body();
        $pw = (string)($body['password'] ?? '');
        if ($pw === '' || strlen($pw) > 500) fail(400, 'Bitte Passwort eingeben.');
        $pdo = Db::pdo();
        Auth::login($pdo, $pw);
        json_out(['ok' => true, 'authenticated' => true, 'csrf' => Auth::csrf(),
            'must_change_password' => Auth::mustChangePassword($pdo),
            'password_is_initial' => Db::metaGet($pdo, 'password_is_initial', '0') === '1']);
        exit;
    }

    // ---- ab hier Login erforderlich
    Auth::requireLogin();
    if ($needsCsrf) Auth::requireCsrf();

    if ($action === 'logout') {
        Auth::logout();
        json_out(['ok' => true]);
        exit;
    }

    $pdo = Db::pdo();
    Auth::requireCurrent($pdo); // Sitzungsversion: nach Passwortwechsel/Reset sind alle anderen Sitzungen ungültig
    if (Auth::mustChangePassword($pdo) && !in_array($action, $allowedWhileMustChange, true)) {
        fail(403, 'password_change_required');
    }
    if ($action !== 'password_change') session_write_close(); // Sitzungssperre früh lösen

    switch ($action) {
        case 'admin_content': {
            $s = Content::state($pdo);
            json_out(['ok' => true, 'defaults' => $s['defaults'], 'effective' => $s['effective'],
                'overridden' => $s['applied'], 'orphans' => array_map(function ($p, $o) {
                    return ['path' => $p, 'reason' => $o['reason'], 'updated_at' => $o['updated_at'], 'value' => $o['value']];
                }, array_keys($s['orphans']), array_values($s['orphans'])),
                'rev' => $s['rev'], 'defaults_hash' => Content::defaultsHash($s['defaults'])]);
            break;
        }
        case 'save': {
            $b = read_json_body();
            if (!isset($b['patch']) || !is_array($b['patch'])) fail(400, 'Feld „patch“ fehlt.');
            $note = is_string($b['note'] ?? null) ? trim(strip_tags($b['note'])) : '';
            $baseRev = isset($b['base_rev']) && is_numeric($b['base_rev']) ? (int)$b['base_rev'] : null;
            $r = Store::applyPatch($pdo, $b['patch'], $note, $baseRev, !empty($b['force']));
            json_out(['ok' => true] + $r);
            break;
        }
        case 'reset_path': {
            $b = read_json_body();
            $p = (string)($b['path'] ?? '');
            if (!Content::pathValid($p)) fail(400, 'Ungültiger Pfad.');
            $r = Store::applyPatch($pdo, [$p => null], 'Auf Standard zurückgesetzt');
            json_out(['ok' => true] + $r);
            break;
        }
        case 'reset_all': {
            $b = read_json_body();
            if (($b['confirm'] ?? '') !== 'ALLES ZURUECKSETZEN') fail(400, 'Bestätigung fehlt.');
            json_out(['ok' => true] + Store::resetAll($pdo));
            break;
        }
        case 'revisions': {
            $rows = [];
            foreach ($pdo->query('SELECT id, ts, note, LENGTH(snapshot) AS size, snapshot FROM revisions ORDER BY id DESC LIMIT ' . (int)MAX_REVISIONS) as $r) {
                $snap = json_decode($r['snapshot'], true);
                $rows[] = ['id' => (int)$r['id'], 'ts' => $r['ts'], 'note' => (string)$r['note'], 'override_count' => is_array($snap) ? count($snap) : 0];
            }
            json_out(['ok' => true, 'revisions' => $rows]);
            break;
        }
        case 'revision_restore': {
            $b = read_json_body();
            $id = (int)($b['id'] ?? 0);
            if ($id < 1) fail(400, 'Version fehlt.');
            json_out(['ok' => true] + Store::restoreRevision($pdo, $id));
            break;
        }
        case 'media': {
            $s = Content::state($pdo);
            json_out(['ok' => true] + Media::listAll($pdo, $s['effective']) + ['max_bytes' => MAX_UPLOAD_BYTES]);
            break;
        }
        case 'upload': {
            $r = Media::handleUpload($pdo);
            json_out(['ok' => true] + $r);
            break;
        }
        case 'media_alt': {
            $b = read_json_body();
            $rel = (string)($b['file'] ?? '');
            $name = Media::uploadName($rel);
            if ($name === null || !is_file(Media::variants($name)['main'])) fail(404, 'Bild nicht gefunden.');
            $alt = trim(preg_replace('/[\x00-\x1F\x7F]/', ' ', strip_tags((string)($b['alt'] ?? ''))));
            if (mb_strlen($alt) > 300) fail(422, 'Alt-Text ist zu lang (max. 300 Zeichen).');
            $st = $pdo->prepare('UPDATE media SET alt = ? WHERE file = ?');
            $st->execute([$alt, $rel]);
            if ($st->rowCount() === 0) {
                $gi = @getimagesize(Media::variants($name)['main']);
                $pdo->prepare('INSERT OR REPLACE INTO media (file, original_name, width, height, bytes, alt, created_at) VALUES (?,?,?,?,?,?,?)')
                    ->execute([$rel, $name, $gi ? $gi[0] : 0, $gi ? $gi[1] : 0, (int)filesize(Media::variants($name)['main']), $alt, now_iso()]);
            }
            json_out(['ok' => true, 'file' => $rel, 'alt' => $alt]);
            break;
        }
        case 'media_delete': {
            $b = read_json_body();
            $s = Content::state($pdo);
            $r = Media::delete($pdo, (string)($b['file'] ?? ''), !empty($b['force']), $s['effective']);
            json_out(['ok' => true] + $r);
            break;
        }
        case 'backup_create': {
            $b = read_json_body();
            $r = Backups::create($pdo, (string)($b['note'] ?? ''), !empty($b['includeMedia']), false);
            json_out(['ok' => true, 'backup' => $r]);
            break;
        }
        case 'backup_list': {
            json_out(['ok' => true, 'backups' => Backups::list(), 'zip' => class_exists('ZipArchive'),
                'max_upload' => min(ini_bytes((string)ini_get('upload_max_filesize')) ?: MAX_BACKUP_UPLOAD_BYTES, ini_bytes((string)ini_get('post_max_size')) ?: MAX_BACKUP_UPLOAD_BYTES, MAX_BACKUP_UPLOAD_BYTES)]);
            break;
        }
        case 'backup_download': {
            Backups::download((string)($_GET['file'] ?? ''));
            break;
        }
        case 'backup_delete': {
            $b = read_json_body();
            Backups::delete((string)($b['file'] ?? ''));
            json_out(['ok' => true]);
            break;
        }
        case 'backup_restore': {
            Media::checkPostSize();
            if (isset($_FILES['file'])) {
                $f = $_FILES['file'];
                if (is_array($f['error']) || $f['error'] !== UPLOAD_ERR_OK) {
                    $code = is_array($f['error']) ? -1 : (int)$f['error'];
                    if ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE) fail(413, 'Die Datei ist größer als das PHP-Upload-Limit dieses Servers.');
                    fail(400, 'Upload fehlgeschlagen.');
                }
                if (!is_uploaded_file($f['tmp_name'])) fail(400, 'Ungültiger Upload.');
                if ($f['size'] > MAX_BACKUP_UPLOAD_BYTES) fail(413, 'Datei zu groß.');
                $label = mb_substr(preg_replace('/[^\p{L}\p{N} ._\-()]/u', '', basename((string)$f['name'])), 0, 80);
                $r = Backups::restore($pdo, $f['tmp_name'], $label ?: 'hochgeladene Datei');
            } else {
                $b = read_json_body();
                $abs = Backups::path((string)($b['file'] ?? ''));
                $r = Backups::restore($pdo, $abs, basename($abs));
            }
            json_out(['ok' => true] + $r);
            break;
        }
        case 'orphans_delete': {
            $b = read_json_body();
            $paths = $b['paths'] ?? null;
            if (!is_array($paths)) fail(400, 'Feld „paths“ fehlt.');
            $s = Content::state($pdo);
            $del = [];
            foreach ($paths as $p) {
                if (is_string($p) && isset($s['orphans'][$p])) $del[] = $p;
            }
            if ($del) {
                Backups::maybeDaily($pdo);
                Db::tx(function (PDO $pdo) use ($del) {
                    Db::addRevision($pdo, 'Nicht mehr passende Einträge gelöscht (' . count($del) . ')');
                    foreach ($del as $p) Db::deleteOverride($pdo, $p);
                    Db::markPaths($pdo, $del, Db::bumpRev($pdo));
                });
            }
            json_out(['ok' => true, 'deleted' => $del]);
            break;
        }
        case 'orphans_export': {
            $s = Content::state($pdo);
            $only = isset($_GET['path']) ? (string)$_GET['path'] : null;
            $out = [];
            foreach ($s['orphans'] as $p => $o) {
                if ($only !== null && $only !== $p) continue;
                $out[$p] = ['value' => $o['value'], 'updated_at' => $o['updated_at']];
            }
            $doc = Backups::exportDoc($out, 'Export nicht mehr passender Einträge');
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="nicht-mehr-passende-eintraege-' . date('Ymd-His') . '.json"');
            header('Cache-Control: no-store');
            echo json_encode($doc, json_flags() | JSON_PRETTY_PRINT);
            break;
        }
        case 'password_change': {
            $b = read_json_body();
            Auth::changePassword($pdo, (string)($b['current'] ?? ''), (string)($b['new'] ?? ''));
            json_out(['ok' => true, 'csrf' => Auth::csrf()]);
            break;
        }
        case 'health': {
            $probe = Health::probes(!empty($_GET['probe']));
            json_out(['ok' => true, 'checks' => Health::run($pdo), 'php' => PHP_VERSION, 'time' => now_iso()] + $probe);
            break;
        }
        case 'health_cleanup': {
            Health::probeCleanup();
            json_out(['ok' => true]);
            break;
        }
        default:
            fail(404, 'Unbekannte Aktion.');
    }
} catch (ApiError $e) {
    if (headers_sent()) exit;
    json_out(['ok' => false, 'error' => $e->getMessage()] + $e->extra, $e->status);
} catch (Throwable $e) {
    if ($e instanceof PDOException && Db::isBusy($e)) {
        // Datenbank kurz gesperrt: nie 500, sondern ein klares, wiederholbares 503.
        if (headers_sent()) exit;
        header('Retry-After: 3');
        json_out(['ok' => false, 'error' => 'Der Server ist gerade ausgelastet. Bitte in einigen Sekunden erneut versuchen.', 'retry_after' => 3], 503);
        exit;
    }
    log_error(get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
    if (headers_sent()) exit;
    json_out(['ok' => false, 'error' => 'Interner Fehler.'] + (API_DEBUG ? ['debug' => $e->getMessage()] : []), 500);
}
