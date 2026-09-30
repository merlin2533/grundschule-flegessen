<?php
/**
 * Grundschule Flegessen – API-Konfiguration (Standardwerte).
 *
 * Eigene Einstellungen NICHT hier ändern, sondern in api/config.local.php ablegen
 * (wird nie ins Repository übernommen und beim Frame-Deployment nicht überschrieben).
 * Beispiel config.local.php:
 *
 *   <?php
 *   define('DATA_DIR', '/home/USER/flegessen-daten');   // Datenbank + Backups außerhalb des Webroots
 *   define('INITIAL_ADMIN_PASSWORD', 'MeinStartPasswort#2026');
 *
 * Wichtig: UPLOAD_DIR muss innerhalb des Webroots liegen, damit die Bilder ausgeliefert werden.
 */
defined('GSF_API') or exit;

if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

// Wurzel der Website (Frame). api/ liegt direkt darunter.
defined('ROOT_DIR') or define('ROOT_DIR', dirname(__DIR__));

// Datenbank und Backups (per data/.htaccess gesperrt; besser: außerhalb des Webroots).
defined('DATA_DIR') or define('DATA_DIR', ROOT_DIR . '/data');
defined('BACKUP_DIR') or define('BACKUP_DIR', DATA_DIR . '/backups');
defined('DB_FILE') or define('DB_FILE', DATA_DIR . '/site.sqlite');

// Vom Admin hochgeladene Bilder (Dateisystem) und ihr URL-Präfix relativ zur Website-Wurzel.
defined('UPLOAD_DIR') or define('UPLOAD_DIR', ROOT_DIR . '/uploads');
defined('UPLOAD_URL') or define('UPLOAD_URL', 'uploads/');

// Standard-Inhalte des Frames (werden beim Deployment ersetzt).
defined('CONTENT_FILE') or define('CONTENT_FILE', ROOT_DIR . '/content/content.json');
defined('GALLERY_FILE') or define('GALLERY_FILE', ROOT_DIR . '/content/gallery-public.json');
defined('VERSION_FILE') or define('VERSION_FILE', ROOT_DIR . '/version.json');

// Start-Passwort (nur beim allerersten Start verwendet; danach im Admin ändern!).
defined('INITIAL_ADMIN_PASSWORD') or define('INITIAL_ADMIN_PASSWORD', 'Flegessen#Admin26');

// Grenzen
defined('MAX_UPLOAD_BYTES') or define('MAX_UPLOAD_BYTES', 8 * 1024 * 1024);      // je Bild
defined('MAX_BACKUP_UPLOAD_BYTES') or define('MAX_BACKUP_UPLOAD_BYTES', 128 * 1024 * 1024);
defined('MAX_JSON_BYTES') or define('MAX_JSON_BYTES', 4 * 1024 * 1024);          // JSON-Anfragen
defined('MAX_REVISIONS') or define('MAX_REVISIONS', 50);
defined('MAX_AUTO_BACKUPS') or define('MAX_AUTO_BACKUPS', 14);
defined('IMAGE_MAX_SIDE') or define('IMAGE_MAX_SIDE', 1600);
defined('THUMB_SIDE') or define('THUMB_SIDE', 480);
defined('JPEG_QUALITY') or define('JPEG_QUALITY', 82);
defined('SESSION_IDLE_SECONDS') or define('SESSION_IDLE_SECONDS', 8 * 3600);
defined('LOGIN_MAX_FAILURES') or define('LOGIN_MAX_FAILURES', 5);
defined('LOGIN_WINDOW_SECONDS') or define('LOGIN_WINDOW_SECONDS', 600);
defined('API_DEBUG') or define('API_DEBUG', false);

// Version des Datenformats für Backups/Exporte.
defined('APP_SCHEMA_VERSION') or define('APP_SCHEMA_VERSION', 1);
