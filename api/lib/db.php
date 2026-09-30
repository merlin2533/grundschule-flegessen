<?php
defined('GSF_API') or exit;

/** SQLite-Zugriff (PDO, nur Prepared Statements), automatische Migration. */
final class Db
{
    private static ?PDO $pdo = null;

    public static function available(): bool
    {
        return extension_loaded('pdo_sqlite');
    }

    public static function exists(): bool
    {
        return is_file(DB_FILE);
    }

    public static function pdo(): PDO
    {
        if (self::$pdo) return self::$pdo;
        if (!self::available()) {
            fail(503, 'Die PHP-Erweiterung pdo_sqlite fehlt auf diesem Server. Der Admin-Bereich kann nicht genutzt werden.');
        }
        if (!ensure_dir(DATA_DIR, true)) {
            fail(503, 'Das Datenverzeichnis ist nicht vorhanden oder nicht beschreibbar.');
        }
        try {
            $pdo = new PDO('sqlite:' . DB_FILE, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $pdo->exec('PRAGMA busy_timeout = 5000');
            try { $pdo->exec('PRAGMA journal_mode = WAL'); } catch (Throwable $e) { /* z. B. Netzlaufwerk */ }
            $pdo->exec('PRAGMA synchronous = NORMAL');
            $pdo->exec('PRAGMA foreign_keys = ON');
            self::migrate($pdo);
            self::seed($pdo);
        } catch (ApiError $e) {
            throw $e;
        } catch (Throwable $e) {
            log_error('DB: ' . $e->getMessage());
            fail(503, 'Die Datenbank konnte nicht geöffnet werden (Schreibrechte für data/ prüfen).');
        }
        self::$pdo = $pdo;
        return $pdo;
    }

    /** Öffnet die DB nur, wenn sie schon existiert und lesbar ist (für öffentliche Endpunkte). */
    public static function tryPublic(): ?PDO
    {
        if (!self::available() || !self::exists()) return null;
        try {
            return self::pdo();
        } catch (Throwable $e) {
            return null;
        }
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
        $ver = (int)self::metaGet($pdo, 'schema_version', '0');
        $migrations = [
            1 => function (PDO $pdo) {
                $pdo->exec('CREATE TABLE IF NOT EXISTS overrides (
                    path TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
                $pdo->exec('CREATE TABLE IF NOT EXISTS revisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, note TEXT, snapshot TEXT NOT NULL)');
                $pdo->exec('CREATE TABLE IF NOT EXISTS media (
                    file TEXT PRIMARY KEY, original_name TEXT, width INTEGER, height INTEGER,
                    bytes INTEGER, alt TEXT, created_at TEXT NOT NULL)');
                $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL)');
                $pdo->exec('CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (ip, ts)');
            },
            // Künftige Schema-Änderungen hier als 2 => function..., 3 => ... ergänzen.
        ];
        if ($ver >= max(array_keys($migrations))) return;
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $ver = (int)self::metaGet($pdo, 'schema_version', '0');
            foreach ($migrations as $v => $fn) {
                if ($v > $ver) {
                    $fn($pdo);
                    self::metaSet($pdo, 'schema_version', (string)$v);
                }
            }
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
    }

    private static function seed(PDO $pdo): void
    {
        if (self::metaGet($pdo, 'password_hash', '') === '') {
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                if (self::metaGet($pdo, 'password_hash', '') === '') {
                    self::metaSet($pdo, 'password_hash', password_hash((string)INITIAL_ADMIN_PASSWORD, PASSWORD_DEFAULT));
                    self::metaSet($pdo, 'password_is_initial', '1');
                }
                if (self::metaGet($pdo, 'content_rev', '') === '') self::metaSet($pdo, 'content_rev', '1');
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                $pdo->exec('ROLLBACK');
                throw $e;
            }
        }
    }

    public static function metaGet(PDO $pdo, string $key, ?string $default = null): ?string
    {
        $st = $pdo->prepare('SELECT value FROM meta WHERE key = ?');
        $st->execute([$key]);
        $v = $st->fetchColumn();
        return $v === false ? $default : (string)$v;
    }

    public static function metaSet(PDO $pdo, string $key, string $value): void
    {
        $st = $pdo->prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        $st->execute([$key, $value]);
    }

    /** Transaktion mit sofortiger Schreibsperre. */
    public static function tx(callable $fn)
    {
        $pdo = self::pdo();
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $r = $fn($pdo);
            $pdo->exec('COMMIT');
            return $r;
        } catch (Throwable $e) {
            try { $pdo->exec('ROLLBACK'); } catch (Throwable $e2) { /* ignore */ }
            throw $e;
        }
    }

    // ---------------------------------------------------------------- Overrides

    /** @return array<string, array{value:mixed, updated_at:string}> */
    public static function overrides(PDO $pdo): array
    {
        $out = [];
        foreach ($pdo->query('SELECT path, value, updated_at FROM overrides ORDER BY path') as $r) {
            $out[$r['path']] = ['value' => json_decode($r['value'], true), 'updated_at' => $r['updated_at']];
        }
        return $out;
    }

    public static function contentRev(PDO $pdo): int
    {
        return (int)self::metaGet($pdo, 'content_rev', '1');
    }

    public static function bumpRev(PDO $pdo): int
    {
        $rev = self::contentRev($pdo) + 1;
        self::metaSet($pdo, 'content_rev', (string)$rev);
        return $rev;
    }

    // ---------------------------------------------------------------- Revisionen

    public static function addRevision(PDO $pdo, string $note): int
    {
        $snap = json_encode(self::overrides($pdo), json_flags());
        $st = $pdo->prepare('INSERT INTO revisions (ts, note, snapshot) VALUES (?, ?, ?)');
        $st->execute([now_iso(), mb_substr($note, 0, 300), $snap]);
        $id = (int)$pdo->lastInsertId();
        $pdo->prepare('DELETE FROM revisions WHERE id NOT IN (SELECT id FROM revisions ORDER BY id DESC LIMIT ' . (int)MAX_REVISIONS . ')')->execute();
        return $id;
    }

    public static function setOverride(PDO $pdo, string $path, $value): void
    {
        $st = $pdo->prepare('INSERT INTO overrides (path, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
        $st->execute([$path, json_encode($value, json_flags()), now_iso()]);
    }

    public static function deleteOverride(PDO $pdo, string $path): void
    {
        $pdo->prepare('DELETE FROM overrides WHERE path = ?')->execute([$path]);
    }
}
