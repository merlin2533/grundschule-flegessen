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

    // ------------------------------------------------------------ Sitzungsversion / Pflicht-Passwortwechsel

    public static function sessionVersion(PDO $pdo): int
    {
        return (int)Db::metaGet($pdo, 'session_version', '1');
    }

    public static function mustChangePassword(PDO $pdo): bool
    {
        return Db::metaGet($pdo, 'must_change_password', '0') === '1';
    }

    /** Ist die Sitzung noch gültig? (Passwortwechsel/Reset macht alle älteren Sitzungen ungültig.) */
    public static function sessionCurrent(PDO $pdo): bool
    {
        return !empty($_SESSION['auth']) && (int)($_SESSION['sv'] ?? -1) === self::sessionVersion($pdo);
    }

    /** Anmeldung verwerfen; die Sitzung (samt CSRF-Token) bleibt für einen neuen Login bestehen. */
    public static function dropLogin(): void
    {
        unset($_SESSION['auth'], $_SESSION['sv']);
    }

    /** 401, wenn die Sitzung durch Passwortwechsel/Reset ungültig wurde. */
    public static function requireCurrent(PDO $pdo): void
    {
        if (!self::sessionCurrent($pdo)) {
            self::dropLogin();
            fail(401, 'Ihre Sitzung ist nicht mehr gültig. Bitte erneut anmelden.');
        }
    }

    // ------------------------------------------------------------ Login-Begrenzung

    private static function busyFail(): void
    {
        header('Retry-After: 3');
        fail(503, 'Der Server ist gerade ausgelastet. Bitte in einigen Sekunden erneut versuchen.', ['retry_after' => 3]);
    }

    private static function locked(int $wait, bool $global): void
    {
        $wait = max(1, $wait);
        header('Retry-After: ' . $wait);
        fail(429, ($global ? 'Die Anmeldung ist wegen zu vieler Fehlversuche vorübergehend gesperrt.' : 'Zu viele Fehlversuche.')
            . ' Bitte in ' . (int)ceil($wait / 60) . ' Minute(n) erneut versuchen.', ['retry_after' => $wait]);
    }

    /**
     * Versuch VOR der Passwortprüfung atomar reservieren: Prüfung und Eintrag geschehen in EINER
     * Sofort-Transaktion, parallele Anfragen können die Grenze also nicht unterlaufen. Eine erfolgreiche
     * Anmeldung gibt ihren Eintrag wieder frei (release). Fail-closed: bei Datenbanksperren kommt 503, nie 500.
     * @return array{gid:int}
     */
    private static function reserve(PDO $pdo, string $key, int $max, bool $withGlobal): array
    {
        $now = time();
        $win = LOGIN_WINDOW_SECONDS;
        $lock = null;
        $out = null;
        try {
            Db::beginImmediate($pdo);
            try {
                $pdo->prepare('DELETE FROM login_attempts WHERE ts <= ?')->execute([$now - $win]);
                if ($withGlobal) {
                    $until = (int)Db::metaGet($pdo, 'login_lock_until', '0');
                    if ($until > $now) $lock = [$until - $now, true];
                }
                if ($lock === null) {
                    $st = $pdo->prepare('SELECT COUNT(*), MIN(ts) FROM login_attempts WHERE ip = ? AND ts > ?');
                    $st->execute([$key, $now - $win]);
                    $row = $st->fetch(PDO::FETCH_NUM);
                    $st->closeCursor();
                    if ((int)$row[0] >= $max) $lock = [(int)$row[1] + $win - $now, false];
                }
                if ($lock === null) {
                    $ins = $pdo->prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)');
                    $ins->execute([$key, $now]);
                    $gid = 0;
                    if ($withGlobal) {
                        $ins->execute(['*', $now]);
                        $gid = (int)$pdo->lastInsertId();
                        $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND ts > ?');
                        $st->execute(['*', $now - $win]);
                        $n = (int)$st->fetchColumn();
                        $st->closeCursor();
                        if ($n >= LOGIN_GLOBAL_MAX_FAILURES) {
                            // Globale Sperre; der globale Zähler beginnt danach von vorn.
                            Db::metaSet($pdo, 'login_lock_until', (string)($now + LOGIN_GLOBAL_LOCK_SECONDS));
                            $pdo->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute(['*']);
                            $gid = 0;
                        }
                    }
                    $out = ['gid' => $gid];
                }
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                try { $pdo->exec('ROLLBACK'); } catch (Throwable $e2) { /* ignore */ }
                throw $e;
            }
        } catch (Throwable $e) {
            log_error('Login-Begrenzung: ' . $e->getMessage());
            self::busyFail();
        }
        if ($out === null) self::locked($lock[0], $lock[1]);
        return $out;
    }

    /** Nach erfolgreicher Prüfung: Fehlversuchs-Einträge dieses Schlüssels (und den globalen Eintrag) entfernen. */
    private static function release(PDO $pdo, string $key, array $r): void
    {
        try {
            Db::beginImmediate($pdo);
            try {
                $pdo->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute([$key]);
                if ($r['gid'] > 0) $pdo->prepare('DELETE FROM login_attempts WHERE rowid = ? AND ip = ?')->execute([$r['gid'], '*']);
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                try { $pdo->exec('ROLLBACK'); } catch (Throwable $e2) { /* ignore */ }
                throw $e;
            }
        } catch (Throwable $e) {
            log_error('Login-Begrenzung (Freigabe): ' . $e->getMessage()); // Anmeldung selbst ist gültig, Eintrag verfällt von allein
        }
    }

    public static function login(PDO $pdo, string $password): void
    {
        // Notfall-Reset ZUERST (auch ein ausgesperrter Admin mit FTP-Zugriff soll sich wieder anmelden können).
        self::applyResetFile($pdo);
        $key = 'ip:' . client_key();
        $r = self::reserve($pdo, $key, LOGIN_MAX_FAILURES, true);
        $hash = (string)Db::metaGet($pdo, 'password_hash', '');
        $ok = $hash !== '' && password_verify($password, $hash);
        if (!$ok) {
            usleep(300000);
            fail(401, 'Falsches Passwort.');
        }
        self::release($pdo, $key, $r);
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            Db::metaSet($pdo, 'password_hash', password_hash($password, PASSWORD_DEFAULT));
        }
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        $_SESSION['sv'] = self::sessionVersion($pdo);
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
     * (Inhalt = neues Passwort, mind. MIN_PASSWORD_LENGTH Zeichen; nur reguläre Datei, kein Symlink), wird sie beim
     * nächsten Login-Versuch übernommen und gelöscht. Die Prüfung erfolgt vor der Sperre. Danach: Sperren
     * aufgehoben, Passwortwechsel erzwungen, alle bestehenden Sitzungen ungültig.
     * Ist die Datei zu kurz, gibt es eine ausdrückliche Fehlermeldung (kein stilles Ignorieren).
     */
    private static function applyResetFile(PDO $pdo): void
    {
        $f = DATA_DIR . '/RESET_PASSWORD.txt';
        if (is_link($f) || !is_file($f)) return;
        if ((int)@filesize($f) > 1024) fail(422, 'RESET_PASSWORD.txt zu lang – die Datei darf nur das neue Passwort enthalten. Sie wurde nicht verwendet.');
        $raw = @file_get_contents($f, false, null, 0, 1025);
        if ($raw === false) fail(422, 'RESET_PASSWORD.txt konnte nicht gelesen werden (Dateirechte prüfen). Sie wurde nicht verwendet.');
        $pw = trim(preg_replace('/^\xEF\xBB\xBF/', '', $raw));
        if (mb_strlen($pw) < MIN_PASSWORD_LENGTH) {
            fail(422, 'RESET_PASSWORD.txt zu kurz – das neue Passwort braucht mindestens ' . MIN_PASSWORD_LENGTH . ' Zeichen. Die Datei wurde nicht verwendet.');
        }
        if (!is_writable(DATA_DIR)) fail(500, 'RESET_PASSWORD.txt kann nicht gelöscht werden (data/ nicht beschreibbar) und wurde deshalb nicht verwendet.');
        $hash = password_hash($pw, PASSWORD_DEFAULT);
        try {
            Db::tx(function (PDO $pdo) use ($f, $hash) {
                if (is_link($f) || !is_file($f)) return; // parallele Anfrage war schneller
                Db::metaSet($pdo, 'password_hash', $hash);
                Db::metaSet($pdo, 'password_is_initial', '0');
                Db::metaSet($pdo, 'must_change_password', '1');
                Db::metaSet($pdo, 'session_version', (string)(self::sessionVersion($pdo) + 1));
                Db::metaSet($pdo, 'login_lock_until', '0');
                $pdo->exec('DELETE FROM login_attempts');
                if (!@unlink($f)) throw new RuntimeException('RESET_PASSWORD.txt konnte nicht gelöscht werden');
            });
        } catch (ApiError $e) {
            throw $e;
        } catch (Throwable $e) {
            log_error('Reset-Datei: ' . $e->getMessage());
            if (Db::isBusy($e)) self::busyFail();
            fail(500, 'RESET_PASSWORD.txt konnte nicht übernommen werden.');
        }
    }

    public static function changePassword(PDO $pdo, string $current, string $new): void
    {
        if (mb_strlen($new) < MIN_PASSWORD_LENGTH) fail(422, 'Das neue Passwort muss mindestens ' . MIN_PASSWORD_LENGTH . ' Zeichen lang sein.');
        if (mb_strlen($new) > 200) fail(422, 'Das neue Passwort ist zu lang.');
        if ($new === (string)INITIAL_ADMIN_PASSWORD) fail(422, 'Das neue Passwort darf nicht das Start-Passwort sein.');
        if ($new === $current) fail(422, 'Das neue Passwort muss sich vom alten unterscheiden.');
        $key = 'pw:' . client_key();
        $r = self::reserve($pdo, $key, LOGIN_MAX_FAILURES, false);
        $hash = (string)Db::metaGet($pdo, 'password_hash', '');
        if (!password_verify($current, $hash)) {
            usleep(300000);
            fail(403, 'Das aktuelle Passwort ist falsch.');
        }
        self::release($pdo, $key, $r);
        $ver = Db::tx(function (PDO $pdo) use ($new) {
            Db::metaSet($pdo, 'password_hash', password_hash($new, PASSWORD_DEFAULT));
            Db::metaSet($pdo, 'password_is_initial', '0');
            Db::metaSet($pdo, 'must_change_password', '0');
            $v = self::sessionVersion($pdo) + 1; // alle anderen Sitzungen werden ungültig
            Db::metaSet($pdo, 'session_version', (string)$v);
            return $v;
        });
        session_regenerate_id(true);
        $_SESSION['sv'] = $ver;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}
