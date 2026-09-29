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
| `tools/` | Hilfsskripte (Bildoptimierung) |

Die HTML-Seiten enthalten die Texte bereits fest eingebaut (gut für Suchmaschinen, funktioniert auch ohne JavaScript).
Beim Laden überschreibt `main.js` diese Texte mit den aktuellen Werten aus `content/content.json` –
so wirken Änderungen aus dem Admin-Bereich sofort.

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

> **Sicherheit:** Der Passwortschutz im Admin ist nur ein Basisschutz im Browser. Vor dem Livegang den Ordner `admin/` zusätzlich serverseitig schützen (z. B. `.htpasswd`, siehe `admin/.htaccess`).

## Rechtliches

- **Impressum** und **Datenschutzerklärung** sind enthalten (bearbeitbar im Admin) – bitte von der Schulleitung / dem Datenschutzbeauftragten prüfen lassen.
- Keine Cookies, kein Tracking, keine externen Schriftarten.
- Die OpenStreetMap-Karte lädt erst nach Klick („Zwei-Klick-Lösung“).
- Personenfotos nur mit Einwilligung der Sorgeberechtigten veröffentlichen.

## SEO

Semantisches HTML, Meta-Tags, Open Graph, JSON-LD (`School`), `sitemap.xml`, `robots.txt`, WebP-Bilder, Lazy Loading, Caching/Kompression via `.htaccess`.
Für Google Ads (SEA): Zielseiten `eltern.html` (Anmeldung/Einschulung), `unsere-schule.html`, `kontakt.html`; Conversion = Klick auf Telefon/E-Mail.

## Deployment

Alle Dateien (außer `node_modules/`, `tools/`) auf den Webspace hochladen. Kein Build-Schritt nötig.
