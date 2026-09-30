<?php
defined('GSF_API') or exit;

/**
 * Inhaltsmodell: Standardinhalt (content.json + Galerie als Pseudo-Wurzel "gallery")
 * + Überschreibungen aus SQLite. Kompatibilitätsregel siehe Content::compat().
 */
final class Content
{
    private static ?array $defaults = null;

    public const MAX_STRING = 5000;
    public const MAX_HTML = 200000;
    public const MAX_ARRAY_ITEMS = 500;
    public const MAX_GALLERY_ITEMS = 1500;
    public const MAX_ARRAY_JSON = 1500000;
    private const IMG_RE = '#^(assets/images|uploads)/[A-Za-z0-9._/\-]+\.(jpe?g|png|webp)$#i';

    // ------------------------------------------------------------ Standardwerte

    /** Standardinhalt inkl. Pseudo-Wurzel gallery.items. */
    public static function defaults(): array
    {
        if (self::$defaults === null) {
            $c = read_json_file(CONTENT_FILE);
            $items = [];
            if (is_file(GALLERY_FILE)) {
                $g = read_json_file(GALLERY_FILE);
                $items = is_list_array($g) ? $g : [];
            }
            $c['gallery'] = ['items' => $items];
            self::$defaults = $c;
        }
        return self::$defaults;
    }

    public static function withoutGallery(array $tree): array
    {
        unset($tree['gallery']);
        return $tree;
    }

    // ------------------------------------------------------------ Typen & Pfade

    public static function isImage($v): bool
    {
        return is_array($v) && !is_list_array($v) && array_key_exists('file', $v) && array_key_exists('alt', $v);
    }

    /** null|string|number|bool|image|array|object */
    public static function cls($v): string
    {
        if ($v === null) return 'null';
        if (is_string($v)) return 'string';
        if (is_int($v) || is_float($v)) return 'number';
        if (is_bool($v)) return 'bool';
        if (is_array($v)) {
            if (is_list_array($v)) return 'array';
            return self::isImage($v) ? 'image' : 'object';
        }
        return 'unknown';
    }

    public static function pathValid(string $p): bool
    {
        return strlen($p) <= 200 && preg_match('/^[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+){1,8}$/', $p) === 1;
    }

    /** Wert am Pfad im Baum (nur über assoziative Ebenen). $found zeigt Existenz an. */
    public static function lookup(array $tree, string $path, ?bool &$found = null)
    {
        $found = false;
        $cur = $tree;
        foreach (explode('.', $path) as $seg) {
            if (!is_array($cur) || is_list_array($cur) || self::isImage($cur) || !array_key_exists($seg, $cur)) return null;
            $cur = $cur[$seg];
        }
        $found = true;
        return $cur;
    }

    private static function setPath(array &$tree, string $path, $value): void
    {
        $segs = explode('.', $path);
        $cur = &$tree;
        foreach ($segs as $i => $seg) {
            if ($i === count($segs) - 1) {
                $cur[$seg] = $value;
            } else {
                if (!isset($cur[$seg]) || !is_array($cur[$seg])) $cur[$seg] = [];
                $cur = &$cur[$seg];
            }
        }
    }

    /**
     * Überschreibbare Einheiten des Standardinhalts: Skalare, Bildobjekte, ganze Listen.
     * @return array<string,string> Pfad => Typklasse
     */
    public static function units(array $tree, string $prefix = ''): array
    {
        $out = [];
        foreach ($tree as $k => $v) {
            $p = $prefix === '' ? (string)$k : $prefix . '.' . $k;
            $c = self::cls($v);
            if ($c === 'object') {
                $out += self::units($v, $p);
            } else {
                $out[$p] = $c;
            }
        }
        return $out;
    }

    public static function defaultsHash(?array $defaults = null): string
    {
        $u = self::units($defaults ?? self::defaults());
        ksort($u);
        return sha1(json_encode($u));
    }

    // ------------------------------------------------------------ Listen-Schema

    /**
     * Form der Listeneinträge aus dem Standard ableiten.
     * @return array|null null = leer/unbekannt (keine Prüfung); ['scalar'=>[classes]] oder ['keys'=>[key=>[classes]]]
     */
    public static function schema(array $defaultArr): ?array
    {
        if (!$defaultArr) return null;
        $keys = [];
        $scalars = [];
        $hasObj = false;
        foreach ($defaultArr as $item) {
            if (is_array($item) && !is_list_array($item) && !self::isImage($item)) {
                $hasObj = true;
                foreach ($item as $k => $v) {
                    $c = self::cls($v);
                    if ($c === 'string' && preg_match(self::IMG_RE, $v)) $c = 'imgpath';
                    $keys[$k][$c] = true;
                }
            } elseif (self::isImage($item)) {
                $hasObj = true;
                $keys['@image']['image'] = true;
            } else {
                $scalars[self::cls($item)] = true;
            }
        }
        if ($hasObj) {
            $out = [];
            foreach ($keys as $k => $set) $out[$k] = array_keys($set);
            return ['keys' => $out];
        }
        return ['scalar' => array_keys($scalars)];
    }

    private static function classOk(string $actual, array $allowed): bool
    {
        foreach ($allowed as $a) {
            if ($a === $actual) return true;
            if ($a === 'imgpath' && $actual === 'string') return true;
            if ($a === 'string' && $actual === 'imgpath') return true;
            if ($a === 'null') return true; // null im Standard = beliebiger Skalar
        }
        return false;
    }

    // ------------------------------------------------------------ Kompatibilität

    /**
     * Kompatibilitätsregel: Eine Überschreibung wird nur angewandt, wenn ihr Pfad im aktuellen
     * Standard noch existiert UND die Typklasse passt (string/number/bool, Bildobjekt, Liste, Objekt).
     * Bei Listen müssen zusätzlich die Feldnamen der Einträge noch zum Standard passen.
     * @return string|null null = kompatibel, sonst Begründung (deutsch)
     */
    public static function compat(string $path, $value, array $defaults): ?string
    {
        if (!self::pathValid($path)) return 'Ungültiger Pfad';
        $def = self::lookup($defaults, $path, $found);
        if (!$found) return 'Feld existiert im aktuellen Standardinhalt nicht mehr';
        $dc = self::cls($def);
        $vc = self::cls($value);
        if ($dc === 'null') {
            if (!in_array($vc, ['null', 'string', 'number', 'bool'], true)) return 'Typ passt nicht (erwartet einfachen Wert, gefunden: ' . $vc . ')';
            return null;
        }
        if ($dc !== $vc) {
            return 'Typ passt nicht mehr (erwartet: ' . self::label($dc) . ', gefunden: ' . self::label($vc) . ')';
        }
        if ($dc === 'array') {
            $schema = self::schema($def);
            if ($schema !== null) {
                foreach ($value as $i => $item) {
                    if (isset($schema['keys'])) {
                        if (!is_array($item) || (is_list_array($item) && $item)) return 'Listeneintrag ' . ($i + 1) . ' hat nicht mehr die erwartete Form';
                        if (isset($schema['keys']['@image'])) continue;
                        foreach ($item as $k => $v) {
                            if (!isset($schema['keys'][$k])) return 'Feld „' . $k . '“ in Listeneintrag ' . ($i + 1) . ' existiert nicht mehr';
                            if (!self::classOk(self::cls($v), $schema['keys'][$k])) {
                                return 'Feld „' . $k . '“ in Listeneintrag ' . ($i + 1) . ' hat einen anderen Typ als im Standard';
                            }
                        }
                    } else {
                        if (!self::classOk(self::cls($item), $schema['scalar'])) return 'Listeneintrag ' . ($i + 1) . ' hat einen anderen Typ als im Standard';
                    }
                }
            }
        }
        return null;
    }

    private static function label(string $c): string
    {
        return [
            'string' => 'Text', 'number' => 'Zahl', 'bool' => 'Ja/Nein', 'image' => 'Bild', 'array' => 'Liste',
            'object' => 'Bereich', 'null' => 'leer', 'unknown' => 'unbekannt',
        ][$c] ?? $c;
    }

    // ------------------------------------------------------------ Zusammenführen

    /**
     * Standard + kompatible Überschreibungen.
     * @param array<string,array{value:mixed,updated_at:string}> $overrides
     * @return array{0:array,1:array,2:array} [effektiv, Orphans(path=>[reason,...]), angewandt(path=>updated_at)]
     */
    public static function merge(array $defaults, array $overrides): array
    {
        $eff = $defaults;
        $orphans = [];
        $applied = [];
        foreach ($overrides as $path => $o) {
            $reason = self::compat((string)$path, $o['value'], $defaults);
            if ($reason !== null) {
                $orphans[$path] = ['reason' => $reason, 'value' => $o['value'], 'updated_at' => $o['updated_at']];
                continue;
            }
            $def = self::lookup($defaults, $path);
            $val = $o['value'];
            if (is_array($val) && is_list_array($val)) {
                $val = self::fillItems($val, self::schema($def));
            }
            self::setPath($eff, $path, $val);
            $applied[$path] = $o['updated_at'];
        }
        return [$eff, $orphans, $applied];
    }

    /** Fehlende Felder in Listeneinträgen mit leeren Werten auffüllen (neue Felder im Standard). */
    private static function fillItems(array $items, ?array $schema): array
    {
        if (!$schema || !isset($schema['keys']) || isset($schema['keys']['@image'])) return $items;
        foreach ($items as $i => $item) {
            if (!is_array($item)) continue;
            foreach ($schema['keys'] as $k => $classes) {
                if (!array_key_exists($k, $item)) $item[$k] = self::blank($classes[0]);
            }
            $items[$i] = $item;
        }
        return $items;
    }

    public static function blank(string $cls)
    {
        switch ($cls) {
            case 'image': return ['file' => '', 'alt' => ''];
            case 'number': return 0;
            case 'bool': return false;
            case 'array': return [];
            case 'null': return '';
            default: return '';
        }
    }

    /** @return array{effective:array, orphans:array, applied:array, rev:int} */
    public static function state(?PDO $pdo = null): array
    {
        $defaults = self::defaults();
        if ($pdo === null) {
            return ['defaults' => $defaults, 'effective' => $defaults, 'orphans' => [], 'applied' => [], 'rev' => 0];
        }
        [$eff, $orph, $applied] = self::merge($defaults, Db::overrides($pdo));
        return ['defaults' => $defaults, 'effective' => $eff, 'orphans' => $orph, 'applied' => $applied, 'rev' => Db::contentRev($pdo)];
    }

    // ------------------------------------------------------------ Prüfen & Bereinigen

    /**
     * Wert für einen Pfad prüfen und bereinigen.
     * @throws InvalidArgumentException mit deutscher Fehlermeldung
     */
    public static function sanitizeForPath(string $path, $value, array $defaults)
    {
        $reason = self::compat($path, $value, $defaults);
        if ($reason !== null) throw new InvalidArgumentException($reason);
        $def = self::lookup($defaults, $path);
        $dc = self::cls($def);
        $key = substr($path, (int)strrpos($path, '.') + 1);
        switch ($dc) {
            case 'object':
                throw new InvalidArgumentException('Nur einzelne Felder, Bilder oder ganze Listen können gespeichert werden.');
            case 'image':
                return self::sanitizeImage($value);
            case 'array':
                return self::sanitizeArray($path, $value, $def);
            case 'number':
            case 'bool':
                return $value;
            default:
                if ($value === null) return '';
                if (!is_string($value)) {
                    if (is_int($value) || is_float($value) || is_bool($value)) return $value;
                    throw new InvalidArgumentException('Erwartet wird ein Text.');
                }
                return self::sanitizeString($key, $value);
        }
    }

    public static function sanitizeString(string $key, string $v, bool $isImgPath = false): string
    {
        if (!mb_check_encoding($v, 'UTF-8')) throw new InvalidArgumentException('Ungültige Zeichenkodierung.');
        $v = str_replace(["\r\n", "\r"], "\n", $v);
        $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $v);
        if ($isImgPath) return self::checkImagePath(trim($v), true);
        if (preg_match('/(Href|Url)$/', $key) || $key === 'file') {
            return self::checkLink($key, $v);
        }
        if (Html::looksLikeHtml($v)) {
            if (strlen($v) > self::MAX_HTML) throw new InvalidArgumentException('Text ist zu lang.');
            return Html::sanitize($v);
        }
        if (strlen($v) > (preg_match('/(Html|html)$/', $key) ? self::MAX_HTML : self::MAX_STRING)) {
            throw new InvalidArgumentException('Text ist zu lang (max. ' . self::MAX_STRING . ' Zeichen).');
        }
        return $v;
    }

    private static function checkLink(string $key, string $v): string
    {
        $v = trim($v);
        if ($v === '') return '';
        if (strlen($v) > 2000) throw new InvalidArgumentException('Link ist zu lang.');
        if (preg_match('/[\x00-\x1F\x7F]/', $v)) throw new InvalidArgumentException('Link enthält ungültige Zeichen.');
        $probe = preg_replace('/[\x00-\x20\x7F]+/', '', $v);
        if (preg_match('/^([a-z][a-z0-9+.\-]*):/i', $probe, $m)) {
            $scheme = strtolower($m[1]);
            $allowed = preg_match('/EmbedUrl$/', $key) ? ['https'] : ['http', 'https', 'mailto', 'tel'];
            if (!in_array($scheme, $allowed, true)) {
                throw new InvalidArgumentException('Link-Art „' . $scheme . ':“ ist nicht erlaubt (erlaubt: ' . implode(', ', $allowed) . ' oder relative Adresse).');
            }
        } elseif (preg_match('/EmbedUrl$/', $key)) {
            throw new InvalidArgumentException('Einbettungs-Adresse muss mit https:// beginnen.');
        }
        return $v;
    }

    public static function resolveImage(string $rel): ?string
    {
        if (strpos($rel, '..') !== false || strpos($rel, '//') !== false || !preg_match(self::IMG_RE, $rel)) return null;
        $up = trim(UPLOAD_URL, '/') . '/';
        if (strpos($rel, $up) === 0) {
            $abs = rtrim(UPLOAD_DIR, '/') . '/' . substr($rel, strlen($up));
            $base = realpath(UPLOAD_DIR);
        } elseif (strpos($rel, 'assets/images/') === 0) {
            $abs = rtrim(ROOT_DIR, '/') . '/' . $rel;
            $base = realpath(ROOT_DIR . '/assets/images');
        } else {
            return null;
        }
        $real = realpath($abs);
        if ($real === false || $base === false || strpos($real, $base . DIRECTORY_SEPARATOR) !== 0 || !is_file($real)) return null;
        return $real;
    }

    /** Alle Bildpfade, die der aktuelle Standardinhalt selbst verwendet (bleiben immer zulässig). */
    private static function defaultImagePaths(): array
    {
        static $set = null;
        if ($set === null) {
            $set = [];
            $walk = function ($v) use (&$walk, &$set) {
                if (is_array($v)) foreach ($v as $x) $walk($x);
                elseif (is_string($v) && preg_match(self::IMG_RE, $v)) $set[$v] = true;
            };
            $walk(self::defaults());
        }
        return $set;
    }

    public static function checkImagePath(string $p, bool $allowEmpty): string
    {
        if ($p === '') {
            if ($allowEmpty) return '';
            throw new InvalidArgumentException('Bild fehlt.');
        }
        if (strlen($p) > 255) throw new InvalidArgumentException('Bildpfad ist zu lang.');
        if (strpos($p, '..') === false && strpos($p, '//') === false && isset(self::defaultImagePaths()[$p])) return $p;
        if (self::resolveImage($p) === null) {
            throw new InvalidArgumentException('Bild nicht gefunden oder Pfad nicht erlaubt: ' . mb_substr($p, 0, 80) . ' (erlaubt: assets/images/… oder ' . trim(UPLOAD_URL, '/') . '/…)');
        }
        return $p;
    }

    public static function sanitizeImage($v): array
    {
        if (!is_array($v) || is_list_array($v)) throw new InvalidArgumentException('Bildangabe ungültig.');
        foreach ($v as $k => $_) {
            if ($k !== 'file' && $k !== 'alt') throw new InvalidArgumentException('Unbekanntes Feld in Bildangabe: ' . $k);
        }
        $file = $v['file'] ?? '';
        $alt = $v['alt'] ?? '';
        if (!is_string($file) || !is_string($alt)) throw new InvalidArgumentException('Bildangabe ungültig.');
        if (!mb_check_encoding($alt, 'UTF-8')) throw new InvalidArgumentException('Ungültige Zeichenkodierung.');
        $alt = trim(preg_replace('/[\x00-\x1F\x7F]/', ' ', strip_tags($alt)));
        if (mb_strlen($alt) > 300) throw new InvalidArgumentException('Alt-Text ist zu lang (max. 300 Zeichen).');
        return ['file' => self::checkImagePath(trim($file), true), 'alt' => $alt];
    }

    private static function sanitizeArray(string $path, array $value, array $def): array
    {
        $max = $path === 'gallery.items' ? self::MAX_GALLERY_ITEMS : self::MAX_ARRAY_ITEMS;
        if (count($value) > $max) throw new InvalidArgumentException('Zu viele Einträge (max. ' . $max . ').');
        $schema = self::schema($def);
        $out = [];
        foreach ($value as $i => $item) {
            $n = $i + 1;
            try {
                $out[] = self::sanitizeItem($item, $schema, $path);
            } catch (InvalidArgumentException $e) {
                throw new InvalidArgumentException('Eintrag ' . $n . ': ' . $e->getMessage());
            }
        }
        if (strlen(json_encode($out, json_flags())) > self::MAX_ARRAY_JSON) throw new InvalidArgumentException('Liste ist insgesamt zu groß.');
        return $out;
    }

    private static function sanitizeItem($item, ?array $schema, string $path)
    {
        if ($schema === null) {
            // Standard-Liste war leer: nur einfache Formen zulassen
            return self::sanitizeLoose($item, '');
        }
        if (isset($schema['scalar'])) {
            if (is_array($item)) throw new InvalidArgumentException('Einfacher Wert erwartet.');
            return is_string($item) ? self::sanitizeString('', $item) : $item;
        }
        if (isset($schema['keys']['@image'])) return self::sanitizeImage($item);
        if (!is_array($item) || (is_list_array($item) && $item)) throw new InvalidArgumentException('Ungültige Form.');
        $out = [];
        foreach ($schema['keys'] as $k => $classes) {
            $has = array_key_exists($k, $item);
            $v = $has ? $item[$k] : self::blank($classes[0]);
            $c = self::cls($v);
            if ($c === 'image') {
                $out[$k] = self::sanitizeImage($v);
            } elseif ($c === 'string') {
                $isImg = in_array('imgpath', $classes, true);
                $s = self::sanitizeString((string)$k, $v, $isImg);
                if ($isImg && $s === '' && $path === 'gallery.items' && in_array($k, ['jpg', 'thumbJpg'], true)) {
                    throw new InvalidArgumentException('Bilddatei fehlt.');
                }
                $out[$k] = $s;
            } elseif ($c === 'number' || $c === 'bool') {
                $out[$k] = $v;
            } elseif ($c === 'null') {
                $out[$k] = '';
            } else {
                $out[$k] = self::sanitizeLoose($v, (string)$k);
            }
        }
        foreach ($item as $k => $_) {
            if (!isset($schema['keys'][$k])) throw new InvalidArgumentException('Unbekanntes Feld: ' . $k);
        }
        return $out;
    }

    /** Für Listen ohne Vorlage: Skalare, Bildobjekte und flache Objekte. */
    private static function sanitizeLoose($v, string $key, int $depth = 0)
    {
        if ($depth > 3) throw new InvalidArgumentException('Zu tief verschachtelt.');
        $c = self::cls($v);
        if ($c === 'string') return self::sanitizeString($key, $v);
        if ($c === 'number' || $c === 'bool') return $v;
        if ($c === 'null') return '';
        if ($c === 'image') return self::sanitizeImage($v);
        if ($c === 'array' || $c === 'object') {
            $o = [];
            foreach ($v as $k => $x) $o[$k] = self::sanitizeLoose($x, is_string($k) ? $k : $key, $depth + 1);
            return $o;
        }
        throw new InvalidArgumentException('Ungültiger Wert.');
    }

    /** Leere Felder entfernen, damit „fehlendes Feld“ und „leeres Feld“ als gleich gelten. */
    public static function normBlank($v)
    {
        if (is_array($v)) {
            $isList = is_list_array($v);
            $o = [];
            foreach ($v as $k => $x) {
                $x = self::normBlank($x);
                if (!$isList && ($x === '' || $x === [] || $x === null)) continue;
                if (!$isList && self::isImage($x) && ($x['file'] ?? '') === '' && ($x['alt'] ?? '') === '') continue;
                $o[$k] = $x;
            }
            if (!$isList) ksort($o);
            return $o;
        }
        return $v;
    }

    public static function sameAsDefault($value, $def): bool
    {
        return json_encode(self::normBlank($value), json_flags()) === json_encode(self::normBlank($def), json_flags());
    }
}
