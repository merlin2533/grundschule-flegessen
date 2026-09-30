# Grundschule Flegessen – Website

Moderne, schnelle und SEO-optimierte Website für die Grundschule Flegessen (Bad Münder).
Frontend in **HTML, CSS und JavaScript**; Inhalte und Bilder werden über einen Admin mit kleiner PHP-Schnittstelle und SQLite-Datenbank gepflegt. Für Besucher: keine Cookies, kein Tracking.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `*.html` | Öffentliche Seiten (Startseite, Schule, Team, Klassen, Aktuelles, Eltern, Galerie, Kontakt, Impressum, Datenschutz, 404) |
| `content/content.json` | **Standardinhalt** (Texte, Bildverweise) – Grundlage für den Admin; der Admin ändert diese Datei nie, sondern speichert Abweichungen in der Datenbank |
| `version.json` | Aktuelle Build-ID (Cache-Busting), wird von Build und Admin erzeugt |
| `content/gallery-public.json` | Liste der Galerie-Fotos |
| `css/style.css` | Design-System (responsive, nur helles Design) |
| `js/main.js` | Navigation, Übernahme der Inhalte aus `content.json`, Lightbox, Karten-Einwilligung |
| `admin/` | Admin-Oberfläche (WYSIWYG, Mediathek, Backup) |
| `api/` | PHP-Schnittstelle + SQLite (Inhalte, Upload, Backup) |
| `data/`, `uploads/` | Laufzeitdaten des Admins (nicht im Git, nicht überschreiben) |
| `assets/images/` | Optimierte Bilder (JPEG + WebP) |
| `assets/downloads/` | PDFs (Elternbriefe) und Schullied |
| `assets/fonts/` | Selbst gehostete Schrift (keine Verbindung zu Google) |
| `tools/` | Hilfsskripte (`bake-content.js`, Bildoptimierung) |
| `archive/` | Aussortierte Fotos (Porträts, Klassenfotos …) – **nicht hochladen** |

Die HTML-Seiten enthalten die Texte bereits fest eingebaut (gut für Suchmaschinen, funktioniert auch ohne JavaScript).
Beim Laden holt `main.js` die aktuellen Inhalte von `api/?a=content` (Fallback: `content/content.json`) und legt sie über die eingebauten Texte –
so wirken Änderungen aus dem Admin sofort.
Für Suchmaschinen und Besucher ohne JavaScript enthält das HTML den Standardtext. Der Build schreibt `content/content.json` fest ein:

```bash
node tools/bake-content.js   # schreibt content.json fest in die HTML-Seiten
```

## Build, Cache-ID und Sitemap

```bash
npm run build   # = node tools/build.js
```

Der Build
1. schreibt `content.json` fest in die HTML-Seiten,
2. erzeugt bei **jedem** Lauf eine neue eindeutige Build-ID in `version.json` und hängt sie als `?v=<ID>` an CSS/JS,
3. erzeugt `sitemap.xml` neu (`lastmod` ändert sich nur bei geänderten Seiten).

Die API meldet zusätzlich eine Inhalts-Revision (`api/?a=version`), die sich bei jedem Speichern im Admin erhöht. Beim Seitenaufruf vergleicht `js/version-check.js` die ID mit der im Browser gemerkten;
fehlt sie oder weicht sie ab, werden Cache Storage und Service Worker geleert und die Seite einmal neu geladen – so sehen Besucher immer den neuesten Stand.
HTML, JSON und XML werden per `.htaccess` nie zwischengespeichert. Vor jedem Upload (Deployment) `npm run build` ausführen.

## Lokale Vorschau

```bash
python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

## Admin-Bereich (Texte, Bilder, Backup)

Der Admin läuft auf dem Webserver mit einer kleinen PHP-Schnittstelle (`api/`, PHP 8, ohne Frameworks) und einer **SQLite-Datenbank**.
Die Seiten selbst bleiben reines HTML/JavaScript.

- Aufruf: `https://<domain>/admin/`
- **Start-Passwort:** `Flegessen#Admin26` (danach im Admin unter *Einstellungen* ändern; das Passwort wird nur als Hash in der Datenbank gespeichert).
  Passwort vergessen: Datei `data/RESET_PASSWORD.txt` mit dem neuen Passwort (mind. 10 Zeichen) anlegen – sie wird beim nächsten Login übernommen und gelöscht.
- Menü: Übersicht (Systemprüfung), Seiten & Texte (alle Texte per WYSIWYG, alle Bilder), Bilder & Medien (Mediathek, Galerie-Manager),
  Backup & Wiederherstellung, Verlauf (auf früheren Stand zurücksetzen), Einstellungen (Passwort, alles auf Auslieferungszustand, nicht mehr passende Einträge).
- Änderungen werden sofort gespeichert und sind sofort online. Hochgeladene Bilder werden verkleinert, gedreht und als WebP-Variante abgelegt.

### Wo liegen die Daten? (Deployment überschreibt sie nicht)

| Ordner | Inhalt | Beim Deployment |
|---|---|---|
| `data/` | `site.sqlite` (alle Änderungen), `backups/` | **nicht hochladen / nicht überschreiben** |
| `uploads/` | im Admin hochgeladene Bilder | **nicht hochladen / nicht überschreiben** |
| alles andere | „Rahmen“ (HTML, CSS, JS, `api/`, `admin/`, `content/content.json` als Standardinhalt) | wird ersetzt |

Beide Ordner sind in `.gitignore` und werden nur mit Platzhaltern ausgeliefert. Wer möchte, kann sie über `api/config.local.php` (Vorlage: `api/config.local.php.example`) außerhalb des Web-Roots ablegen.

### Weiterentwicklung: nur Passendes wird übernommen

Die Datenbank speichert nur **Abweichungen** vom Standardinhalt (`content/content.json`). Ändert sich der Rahmen (Felder umbenannt/entfernt/Typ geändert),
werden nur Einträge angewandt, die noch zum Standard passen. Nicht mehr passende bleiben gespeichert, sind im Admin unter *Einstellungen* sichtbar und können gelöscht oder exportiert werden.
Beim Wiederherstellen eines Backups gilt dieselbe Regel; der Import zeigt, was übernommen und was übersprungen wurde. Vor jeder Wiederherstellung, jedem Zurücksetzen und täglich beim ersten Speichern wird automatisch eine Sicherung angelegt.

### Voraussetzungen und Sicherheit

- PHP 8 mit `pdo_sqlite` (Pflicht), `gd`, `zip`, `dom`, `mbstring` (empfohlen) – die Systemprüfung im Admin zeigt fehlende Teile.
- **Unbedingt HTTPS** nutzen (Login und Sitzung). Anmeldung mit Sperre nach 5 Fehlversuchen, CSRF-Schutz, HTML-Bereinigung, Upload-Prüfung.
- Öffentliche Besucher erhalten **keine Cookies**; nur der Admin verwendet nach dem Login ein Sitzungs-Cookie.
- Ohne PHP/SQLite zeigt die Website einfach den Standardinhalt aus `content/content.json`.
- Optional: zusätzlicher Schutz per `.htpasswd` (Vorlage: `admin/.htaccess.example`).
- Das Start-Passwort muss beim ersten Login geändert werden. Hinweis: Steht das Passwort in der README, sollte das Repository privat bleiben und `README.md` nicht auf den Webserver gelangen.

Neue PDFs für „Mitteilungen“ legt man per FTP in `assets/downloads/` ab und trägt den Pfad im Admin unter *Mitteilungen* ein.

## Rechtliches

- **Impressum** und **Datenschutzerklärung** sind enthalten (bearbeitbar im Admin) – bitte von der Schulleitung / dem Datenschutzbeauftragten prüfen lassen.
- Keine Cookies, kein Tracking, keine externen Schriftarten.
- Die OpenStreetMap-Karte lädt erst nach Klick („Zwei-Klick-Lösung“).
- Personenfotos nur mit Einwilligung der Sorgeberechtigten veröffentlichen – vor dem Livegang alle Galerie- und Klassenfotos prüfen.
- Vor dem Livegang in der Datenschutzerklärung Hosting-Anbieter und Datenschutzbeauftragte/n eintragen.

## SEO

Semantisches HTML, Meta-Tags, Open Graph, JSON-LD (`School`), `sitemap.xml`, `robots.txt`, Lazy Loading, Caching/Kompression, automatische WebP-Auslieferung und 301-Weiterleitungen der alten WordPress-Adressen via `.htaccess` (Apache).
Für Google Ads (SEA): Zielseiten `eltern.html` (Anmeldung/Einschulung), `unsere-schule.html`, `kontakt.html`; Conversion = Klick auf Telefon/E-Mail.

## Deployment

Zuerst `npm run build`, dann hochladen: `*.html`, `css/`, `js/`, `assets/`, `content/`, `api/`, `admin/`, `sitemap.xml`, `robots.txt`, `version.json`, `.htaccess`.
**Nicht hochladen bzw. nicht überschreiben:** `data/`, `uploads/` (Laufzeitdaten des Admins), außerdem `node_modules/`, `tools/`, `archive/`, `.git`, `README.md`, `package*.json` (die `.htaccess` sperrt sie zusätzlich).
Beim allerersten Deployment `api/config.local.php` anlegen, falls `data/`/`uploads/` außerhalb des Web-Roots liegen sollen.
