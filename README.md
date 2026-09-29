# Grundschule Flegessen – Website

Moderne, schnelle und SEO-optimierte Website für die Grundschule Flegessen (Bad Münder).
Reines **HTML, CSS und JavaScript** – kein Server, keine Datenbank, keine Cookies.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `*.html` | Öffentliche Seiten (Startseite, Schule, Team, Klassen, Aktuelles, Eltern, Galerie, Kontakt, Impressum, Datenschutz, 404) |
| `content/content.json` | **Alle Texte und Bildverweise** der Seiten – wird vom Admin-Bereich bearbeitet |
| `content/gallery-public.json` | Liste der Galerie-Fotos |
| `css/style.css` | Design-System (responsive, Dark-Mode-fähig) |
| `js/main.js` | Navigation, Übernahme der Inhalte aus `content.json`, Lightbox, Karten-Einwilligung |
| `admin/` | Admin-Bereich mit WYSIWYG-Editor |
| `assets/images/` | Optimierte Bilder (JPEG + WebP) |
| `assets/downloads/` | PDFs (Elternbriefe) und Schullied |
| `assets/fonts/` | Selbst gehostete Schrift (keine Verbindung zu Google) |
| `tools/` | Hilfsskripte (`bake-content.js`, Bildoptimierung) |
| `archive/` | Aussortierte Fotos (Porträts, Klassenfotos …) – **nicht hochladen** |

Die HTML-Seiten enthalten die Texte bereits fest eingebaut (gut für Suchmaschinen, funktioniert auch ohne JavaScript).
Beim Laden überschreibt `main.js` diese Texte mit den aktuellen Werten aus `content/content.json` –
so wirken Änderungen aus dem Admin-Bereich für Besucher sofort.
Damit auch Suchmaschinen und Besucher ohne JavaScript den neuen Stand sehen, nach größeren Änderungen einmal ausführen:

```bash
node tools/bake-content.js   # schreibt content.json fest in die HTML-Seiten
```

## Lokale Vorschau

```bash
python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

## Admin-Bereich (Texte & Bilder pflegen)

1. `https://<domain>/admin/` öffnen und anmelden (Standardpasswort siehe `admin/app.js` – **bitte ändern**).
2. **Chrome/Edge:** „Projektordner öffnen“ wählen und den Website-Ordner auswählen. Änderungen werden direkt in `content/content.json` und `assets/images/` gespeichert.
3. **Firefox/Safari:** `content.json` laden, bearbeiten und die heruntergeladene Datei per FTP hochladen.
4. Texte mit dem WYSIWYG-Editor bearbeiten, Bilder per Klick ersetzen, Team-Mitglieder, Klassen, Neuigkeiten und Dokumente hinzufügen oder entfernen.

Neue PDFs für „Mitteilungen“ legt man in `assets/downloads/` ab und trägt sie im Admin unter *Mitteilungen* ein.

> **Sicherheit:** Der Passwortschutz im Admin ist nur ein Basisschutz im Browser. Vor dem Livegang den Ordner `admin/` zusätzlich serverseitig schützen (z. B. `.htpasswd`, Vorlage: `admin/.htaccess.example`) – oder den Admin nur lokal nutzen und ihn nicht hochladen.

Bilder, die im Admin ersetzt werden, werden verkleinert (max. 1600 px) und unter neuem Dateinamen gespeichert (kein Cache-Problem).

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

Alle Dateien (außer `node_modules/`, `tools/`, `archive/`) auf den Webspace hochladen. Kein Build-Schritt nötig.
