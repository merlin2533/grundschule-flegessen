<?php
defined('GSF_API') or exit;

/** Sitzung, CSRF, Login-Begrenzung. Sitzungen werden NUR für Admin-Aktionen gestartet. */
final class Auth
{
    private static bool $started = false;

    public static function start(): void
    {
        if (self::$started) return;
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        $dir = dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php');
        $path = ($dir === '/' || $dir === '\\' || $dir === '.') ? '/' : rtrim(str_replace('\\', '/', $dir), '/') . '/';
        session_name('gsf_admin');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => $path,
            'secure' => is_https(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        @ini_set('session.use_strict_mode', '1');
        @ini_set('session.use_only_cookies', '1');
        @ini_set('session.cookie_httponly', '1');
        @ini_set('session.gc_maxlifetime', (string)max(SESSION_IDLE_SECONDS, 3600));
        $sp = (string)session_save_path();
        $sp = $sp === '' ? sys_get_temp_dir() : preg_replace('/^(\d+;)+/', '', $sp);
        if (!@is_writable($sp)) {
            $alt = DATA_DIR . '/sessions';
            if (ensure_dir($alt, true)) session_save_path($alt);
        }
        if (!@session_start()) fail(500, 'Sitzung konnte nicht gestartet werden.');
        self::$started = true;
        // Inaktivität
        if (!empty($_SESSION['auth']) && time() - (int)($_SESSION['last'] ?? 0) > SESSION_IDLE_SECONDS) {
            $_SESSION = [];
        }
        $_SESSION['last'] = time();
        if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    public static function authenticated(): bool
    {
        return !empty($_SESSION['auth']);
    }

    public static function csrf(): string
    {
        return (string)($_SESSION['csrf'] ?? '');
    }

    public static function requireLogin(): void
    {
        if (!self::authenticated()) fail(401, 'Bitte melden Sie sich an.');
    }

    /** CSRF-Token (Header) + Origin-Prüfung für zustandsändernde Anfragen. */
    public static function requireCsrf(): void
    {
        $tok = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        if ($tok === '' || !hash_equals(self::csrf(), $tok)) fail(403, 'Sicherheitsprüfung fehlgeschlagen (CSRF). Bitte Seite neu laden.');
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && $origin !== 'null') {
            $oh = parse_url($origin, PHP_URL_HOST);
            $op = parse_url($origin, PHP_URL_PORT);
            $host = (string)($_SERVER['HTTP_HOST'] ?? '');
            $origHostPort = $oh . ($op ? ':' . $op : '');
            if (strcasecmp($origHostPort, $host) !== 0 && strcasecmp((string)$oh, preg_replace('/:\d+$/', '', $host)) !== 0) {
                fail(403, 'Anfrage von fremder Herkunft abgelehnt.');
            }
        }
    }

    public static function login(PDO $pdo, string $password): void
    {
        $ip = client_ip();
        $now = time();
        $pdo->prepare('DELETE FROM login_attempts WHERE ts < ?')->execute([$now - 86400]);
        $st = $pdo->prepare('SELECT COUNT(*), MIN(ts) FROM login_attempts WHERE ip = ? AND ts > ?');
        $st->execute([$ip, $now - LOGIN_WINDOW_SECONDS]);
        [$fails, $oldest] = array_values($st->fetch(PDO::FETCH_NUM));
        if ((int)$fails >= LOGIN_MAX_FAILURES) {
            $wait = max(1, (int)$oldest + LOGIN_WINDOW_SECONDS - $now);
            header('Retry-After: ' . $wait);
            fail(429, 'Zu viele Fehlversuche. Bitte in ' . (int)ceil($wait / 60) . ' Minute(n) erneut versuchen.', ['retry_after' => $wait]);
        }
        self::applyResetFile($pdo);
        $hash = (string)Db::metaGet($pdo, 'password_hash', '');
        $ok = $hash !== '' && password_verify($password, $hash);
        if (!$ok) {
            $pdo->prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)')->execute([$ip, $now]);
            usleep(300000);
            fail(401, 'Falsches Passwort.');
        }
        $pdo->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute([$ip]);
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            Db::metaSet($pdo, 'password_hash', password_hash($password, PASSWORD_DEFAULT));
        }
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        $_SESSION['last'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'],
                'httponly' => true, 'samesite' => 'Strict',
            ]);
            session_destroy();
        }
    }

    /**
     * Notfall-Wiederherstellung: Legt der Betreiber per FTP die Datei data/RESET_PASSWORD.txt an
     * (Inhalt = neues Passwort, mind. 10 Zeichen), wird sie beim nächsten Login-Versuch übernommen
     * und sofort gelöscht.
     */
    private static function applyResetFile(PDO $pdo): void
    {
        $f = DATA_DIR . '/RESET_PASSWORD.txt';
        if (!is_file($f)) return;
        $pw = trim((string)@file_get_contents($f));
        if (mb_strlen($pw) >= 10) {
            Db::metaSet($pdo, 'password_hash', password_hash($pw, PASSWORD_DEFAULT));
            Db::metaSet($pdo, 'password_is_initial', '0');
            $pdo->prepare('DELETE FROM login_attempts')->execute();
            @unlink($f);
        }
    }

    public static function changePassword(PDO $pdo, string $current, string $new): void
    {
        $ip = 'pw:' . client_ip();
        $now = time();
        $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND ts > ?');
        $st->execute([$ip, $now - LOGIN_WINDOW_SECONDS]);
        if ((int)$st->fetchColumn() >= LOGIN_MAX_FAILURES) fail(429, 'Zu viele Fehlversuche. Bitte später erneut versuchen.');
        if (mb_strlen($new) < 10) fail(422, 'Das neue Passwort muss mindestens 10 Zeichen lang sein.');
        if (mb_strlen($new) > 200) fail(422, 'Das neue Passwort ist zu lang.');
        $hash = (string)Db::metaGet($pdo, 'password_hash', '');
        if (!password_verify($current, $hash)) {
            $pdo->prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)')->execute([$ip, $now]);
            fail(403, 'Das aktuelle Passwort ist falsch.');
        }
        if ($new === $current) fail(422, 'Das neue Passwort muss sich vom alten unterscheiden.');
        Db::metaSet($pdo, 'password_hash', password_hash($new, PASSWORD_DEFAULT));
        Db::metaSet($pdo, 'password_is_initial', '0');
        $pdo->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute([$ip]);
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}
