<?php
defined('GSF_API') or exit;

/** HTML-Bereinigung nach Positivliste (Defense in Depth; der Editor erzeugt ohnehin nur diese Tags). */
final class Html
{
    private const ALLOWED = [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a',
        'h2', 'h3', 'h4', 'blockquote', 'span',
    ];
    /** Diese Elemente werden samt Inhalt entfernt. */
    private const DROP = [
        'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math',
        'head', 'title', 'textarea', 'select', 'option', 'button', 'form', 'input', 'link', 'meta', 'base',
        'applet', 'frame', 'frameset', 'audio', 'video', 'canvas', 'map', 'xmp', 'plaintext',
    ];

    public static function looksLikeHtml(string $v): bool
    {
        return strpos($v, '<') !== false;
    }

    public static function sanitize(string $html): string
    {
        if (!class_exists('DOMDocument')) return self::fallback($html);
        $prev = libxml_use_internal_errors(true);
        try {
            $doc = new DOMDocument('1.0', 'UTF-8');
            $ok = $doc->loadHTML(
                '<?xml encoding="UTF-8"><html><body><div>' . $html . '</div></body></html>',
                LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET
            );
            if (!$ok) return self::fallback($html);
            $body = $doc->getElementsByTagName('body')->item(0);
            if (!$body) return '';
            $out = '';
            foreach (iterator_to_array($body->childNodes) as $child) {
                $out .= self::node($child);
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
        }
        return trim($out);
    }

    private static function node(DOMNode $n): string
    {
        switch ($n->nodeType) {
            case XML_TEXT_NODE:
            case XML_CDATA_SECTION_NODE:
                return htmlspecialchars($n->nodeValue, ENT_NOQUOTES | ENT_SUBSTITUTE, 'UTF-8');
            case XML_ELEMENT_NODE:
                $name = strtolower($n->nodeName);
                if (in_array($name, self::DROP, true)) return '';
                $inner = '';
                foreach (iterator_to_array($n->childNodes) as $c) $inner .= self::node($c);
                if (!in_array($name, self::ALLOWED, true)) return $inner; // Tag entfernen, Inhalt behalten
                if ($name === 'br') return '<br>';
                $attrs = '';
                if ($name === 'a') {
                    $href = self::safeHref($n->getAttribute('href'));
                    if ($href !== null) {
                        $attrs .= ' href="' . htmlspecialchars($href, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"';
                        if (strtolower(trim($n->getAttribute('target'))) === '_blank') {
                            $attrs .= ' target="_blank" rel="noopener"';
                        }
                    }
                }
                return '<' . $name . $attrs . '>' . $inner . '</' . $name . '>';
            default:
                return ''; // Kommentare, PIs usw.
        }
    }

    /** HTML-Entities wiederholt auflösen (auch numerische ohne Semikolon), wie es ein Browser in Attributen tut. */
    public static function decodeEntitiesDeep(string $s): string
    {
        for ($i = 0; $i < 5; $i++) {
            $d = preg_replace_callback('/&#(x[0-9a-f]{1,6}|[0-9]{1,7});?/i', function ($m) {
                $n = strtolower($m[1][0]) === 'x' ? hexdec(substr($m[1], 1)) : (int)$m[1];
                return $n > 0 && $n <= 0x10FFFF ? html_entity_decode('&#' . $n . ';', ENT_QUOTES | ENT_HTML5, 'UTF-8') : '';
            }, $s);
            $d = html_entity_decode((string)$d, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if ($d === $s) break;
            $s = $d;
        }
        return $s;
    }

    /**
     * URL-Schema (kleingeschrieben) oder null. Entities werden zuerst aufgelöst, danach Leerraum-, Steuer- und
     * unsichtbare Zeichen entfernt – so werden „java&#x0A;script:“, „javascript&colon;“ oder „java\tscript:“ erkannt.
     */
    public static function schemeOf(string $url): ?string
    {
        $d = self::decodeEntitiesDeep($url);
        $probe = @preg_replace('/[\p{Cc}\p{Cf}\p{Z}\s]+/u', '', $d);
        if ($probe === null) $probe = preg_replace('/[\x00-\x20\x7F]+/', '', $d);
        return preg_match('/^([a-z][a-z0-9+.\-]*):/i', (string)$probe, $m) ? strtolower($m[1]) : null;
    }

    /** Erlaubt: http, https, mailto, tel, Anker und relative Pfade. */
    public static function safeHref(string $href): ?string
    {
        $href = trim($href);
        if ($href === '' || strlen($href) > 2000) return null;
        $scheme = self::schemeOf($href);
        if ($scheme !== null && !in_array($scheme, ['http', 'https', 'mailto', 'tel'], true)) return null;
        if (preg_match('/[\x00-\x1F\x7F]/', $href)) return null;
        return $href;
    }

    /** Notlösung ohne DOM-Erweiterung. */
    private static function fallback(string $html): string
    {
        $html = preg_replace('#<(script|style|iframe|object|embed|noscript|template|svg|math)\b.*?</\1\s*>#is', '', $html);
        $html = preg_replace('/<!--.*?-->/s', '', $html);
        $allowed = '<' . implode('><', self::ALLOWED) . '>';
        $html = strip_tags($html, $allowed);
        return trim(preg_replace_callback('/<(\/?)([a-z0-9]+)([^>]*)>/i', function ($m) {
            $tag = strtolower($m[2]);
            if ($m[1] === '/') return '</' . $tag . '>';
            if ($tag === 'br') return '<br>';
            if ($tag === 'a' && preg_match('/\bhref\s*=\s*("([^"]*)"|\'([^\']*)\')/i', $m[3], $h)) {
                $href = self::safeHref(html_entity_decode($h[2] !== '' ? $h[2] : ($h[3] ?? ''), ENT_QUOTES, 'UTF-8'));
                if ($href !== null) {
                    $t = preg_match('/\btarget\s*=\s*["\']?_blank/i', $m[3]) ? ' target="_blank" rel="noopener"' : '';
                    return '<a href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '"' . $t . '>';
                }
            }
            return '<' . $tag . '>';
        }, $html));
    }
}
