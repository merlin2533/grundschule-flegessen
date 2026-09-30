// Grundschule Flegessen – gemeinsame Front-End-Logik
// - mobile Navigation, feste Schnellkontakt-Leiste, "Nach oben"
// - legt Inhalte aus der API (Fallback: content/content.json) über die fest eingebauten
//   Texte ([data-edit], [data-edit-img], [data-edit-list]); das eingebaute HTML bleibt SEO-/No-JS-Fallback
// - Galerie mit Lightbox, Filter (Team, Aktuelles), Scroll-Effekte, Zähler, Formular-Validierung
// WICHTIG: Auf oberster Ebene darf nichts auf DOM-/Browser-APIs zugreifen – tools/bake-content.js
// lädt diese Datei in einer Node-vm-Sandbox. Renderer bleiben reine String-Funktionen.

(function () {
  "use strict";

  function rootPath() {
    var el = document.querySelector('meta[name="content-root"]');
    return el ? el.getAttribute("content") : "";
  }

  function isMobile() { return window.matchMedia("(max-width: 900px)").matches; }

  function fetchJson(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      var url = rootPath() + urls[i++];
      return fetch(url, { cache: "no-cache" })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
        .catch(next);
    }
    return next();
  }

  /* ---------------- Navigation ---------------- */
  function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector(".main-nav");
    var header = document.querySelector(".site-header");
    if (!toggle || !nav) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
      nav.classList.toggle("is-open", open);
      document.body.classList.toggle("nav-open", open);
      if (header) header.classList.remove("is-hidden");
      if (!open) nav.querySelectorAll(".has-dropdown.is-open").forEach(function (n) { n.classList.remove("is-open"); });
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.querySelectorAll(".has-dropdown > a").forEach(function (link) {
      link.setAttribute("aria-haspopup", "true");
      link.addEventListener("click", function (e) {
        if (!isMobile()) return;
        var parent = link.parentElement;
        if (!parent.classList.contains("is-open")) {
          e.preventDefault();
          nav.querySelectorAll(".has-dropdown.is-open").forEach(function (n) { n.classList.remove("is-open"); });
          parent.classList.add("is-open");
        }
      });
    });

    nav.addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (a && isMobile() && !e.defaultPrevented) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });
    window.addEventListener("resize", function () { if (!isMobile() && nav.classList.contains("is-open")) setOpen(false); });

    // Kopfzeile beim Runterscrollen ausblenden (mehr Platz auf dem Handy), beim Hochscrollen wieder einblenden
    if (header) {
      var lastY = window.scrollY, ticking = false;
      window.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
          var y = window.scrollY;
          if (isMobile() && !nav.classList.contains("is-open")) {
            if (y > lastY + 8 && y > 160) header.classList.add("is-hidden");
            else if (y < lastY - 8 || y < 80) header.classList.remove("is-hidden");
          } else {
            header.classList.remove("is-hidden");
          }
          lastY = y;
          ticking = false;
        });
      }, { passive: true });
    }
  }

  /* ---------------- Schnellkontakt-Leiste + Nach oben (Handy) ---------------- */
  function initQuickBar() {
    var tel = document.querySelector('.site-footer a[href^="tel:"]');
    var mail = document.querySelector('.site-footer a[href^="mailto:"]');
    if (!tel || !mail || document.querySelector(".cta-bar")) return;
    var bar = document.createElement("nav");
    bar.className = "cta-bar";
    bar.setAttribute("aria-label", "Schnellkontakt");
    bar.innerHTML =
      '<a class="cta-bar__btn" href="' + tel.getAttribute("href") + '"><span aria-hidden="true">📞</span> Anrufen</a>' +
      '<a class="cta-bar__btn" href="' + mail.getAttribute("href") + '"><span aria-hidden="true">✉️</span> E-Mail</a>' +
      '<a class="cta-bar__btn" href="https://www.openstreetmap.org/directions?to=52.1554,9.4410" target="_blank" rel="noopener"><span aria-hidden="true">📍</span> Route</a>';
    document.body.appendChild(bar);
    document.body.classList.add("has-cta");

    var top = document.createElement("button");
    top.type = "button";
    top.className = "back-to-top";
    top.setAttribute("aria-label", "Nach oben");
    top.innerHTML = "↑";
    top.hidden = true;
    top.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    document.body.appendChild(top);
    var t = false;
    window.addEventListener("scroll", function () {
      if (t) return; t = true;
      window.requestAnimationFrame(function () { top.hidden = window.scrollY < window.innerHeight * 1.5; t = false; });
    }, { passive: true });
  }

  /* ---------------- Content overlay ---------------- */
  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) {
      return o && typeof o === "object" && k in o ? o[k] : undefined;
    }, obj);
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slug(str) {
    return String(str || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) { return w[0]; })
      .join("")
      .toUpperCase();
  }

  // Erzeugt <img>; nutzt window.GSImageMeta (Build bzw. content/image-meta.json), falls vorhanden, für srcset/Maße
  function imgTag(img, opts) {
    opts = opts || {};
    if (!img || !img.file) return "";
    var meta = window.GSImageMeta && window.GSImageMeta[img.file];
    var attrs = ' src="' + esc(rootPath() + img.file) + '" alt="' + esc(img.alt || "") + '"';
    if (meta && meta.variants && meta.variants.length) {
      var set = meta.variants.map(function (v) { return esc(rootPath() + v.file) + " " + v.w + "w"; });
      set.push(esc(rootPath() + img.file) + " " + meta.w + "w");
      attrs += ' srcset="' + set.join(", ") + '"';
      if (opts.sizes) attrs += ' sizes="' + esc(opts.sizes) + '"';
    }
    if (meta && meta.w && meta.h) attrs += ' width="' + meta.w + '" height="' + meta.h + '"';
    attrs += ' decoding="async"';
    if (!opts.eager) attrs += ' loading="lazy"';
    return "<img" + attrs + ">";
  }

  var SIZES_TILE = "(max-width: 620px) calc(100vw - 48px), (max-width: 920px) 45vw, 270px";

  var renderers = {
    "team-member": function (m) {
      var isDog = /schulhund/i.test(m.role || "");
      var photo = m.photo && m.photo.file
        ? imgTag(m.photo, { sizes: "(max-width: 620px) 96px, 132px" })
        : '<span class="team-card__initials">' + (isDog ? "🐾" : esc(initials(m.name))) + "</span>";
      return (
        '<div class="team-card"><div class="team-card__photo">' + photo + "</div>" +
        '<h3 class="team-card__name">' + esc(m.name) + "</h3>" +
        '<p class="team-card__role">' + esc(m.role) + "</p></div>"
      );
    },
    "klasse-item": function (k) {
      return (
        '<div class="tile"><div class="tile__media">' + imgTag(k.photo, { sizes: SIZES_TILE }) + "</div>" +
        '<h3>' + esc(k.name) + '<br><span class="tile__sub">' + esc(k.teacher) + "</span></h3></div>"
      );
    },
    "post-item": function (p) {
      var media = p.image && p.image.file ? '<div class="post-card__media">' + imgTag(p.image, { sizes: "(max-width: 620px) 100vw, 220px" }) + "</div>" : "";
      return (
        '<article class="post-card' + (media ? "" : " post-card--no-media") + '">' + media +
        '<div class="post-card__body"><div class="post-card__date">' + esc(p.date) + "</div>" +
        "<h3>" + esc(p.title) + "</h3>" +
        '<div class="prose">' + (p.html || "") + "</div></div></article>"
      );
    },
    "doc-item": function (d) {
      var ext = (d.file || "").split(".").pop().toUpperCase();
      return (
        '<li class="doc-item"><div class="doc-item__icon">' + esc(ext) + "</div>" +
        '<div class="doc-item__body"><div class="doc-item__date">' + esc(d.date) + "</div>" +
        '<p class="doc-item__title">' + esc(d.title) + "</p>" +
        '<p class="doc-item__desc">' + esc(d.description || "") + "</p></div>" +
        '<a class="btn btn-ghost btn-sm" href="' + esc(rootPath() + d.file) + '" target="_blank" rel="noopener">Öffnen</a></li>'
      );
    },
    "faq-item": function (f) {
      return (
        '<details class="faq" name="faq" id="faq-' + esc(slug(f.question)) + '"><summary>' + esc(f.question) + "</summary>" +
        '<p>' + esc(f.answer) + "</p></details>"
      );
    },
    "timeline-item": function (t) {
      return (
        '<li class="timeline__item"><span class="timeline__time">' + esc(t.time) + "</span>" +
        '<div class="timeline__body"><h3>' + esc(t.title) + "</h3><p>" + esc(t.text) + "</p></div></li>"
      );
    },
    "timetable-row": function (r) {
      return (
        '<tr' + (/pause/i.test(r.label) ? ' class="is-break"' : "") + "><td>" + esc(r.label) + "</td>" +
        "<td>" + esc(r.time) + (r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</td></tr>"
      );
    },
    "gallery-item": function (g, idx) {
      var h = g.w && g.h ? Math.round(480 * g.h / g.w) : 320;
      return (
        '<button type="button" data-full="' + esc(rootPath() + (g.mid || g.jpg)) + '" data-index="' + idx + '" aria-label="Bild ' + (idx + 1) + ' vergrößern">' +
        '<img src="' + esc(rootPath() + g.thumbJpg) + '" alt="' + esc((g.alt || "Impression aus dem Schulleben") + ", Bild " + (idx + 1)) + '" loading="lazy" decoding="async" width="480" height="' + h + '"></button>'
      );
    }
  };

  window.GSRenderers = renderers;

  // Liste nur ersetzen, wenn sich sichtbarer Text oder Bildquellen tatsächlich unterscheiden (kein Layout-Sprung)
  function listSignature(root) {
    var srcs = Array.prototype.map.call(root.querySelectorAll("img"), function (i) { return i.getAttribute("src"); }).join("|");
    return root.textContent.replace(/\s+/g, " ").trim() + "##" + srcs + "##" + root.children.length;
  }

  function applyContent(data) {
    if (!data) return;

    document.querySelectorAll("[data-edit]").forEach(function (el) {
      var val = getPath(data, el.getAttribute("data-edit"));
      if (typeof val === "string" && val.trim() !== "" && el.innerHTML.trim() !== val.trim()) el.innerHTML = val;
    });

    document.querySelectorAll("[data-edit-img]").forEach(function (el) {
      var val = getPath(data, el.getAttribute("data-edit-img"));
      if (!val || !val.file) return;
      var target = el.tagName === "IMG" ? el : el.querySelector("img");
      var src = rootPath() + val.file;
      if (target) {
        if (target.getAttribute("src") !== src) {
          target.removeAttribute("srcset");
          target.removeAttribute("width");
          target.removeAttribute("height");
          target.src = src;
        }
        if (val.alt && target.alt !== val.alt) target.alt = val.alt;
      } else {
        el.style.backgroundImage = 'url("' + src + '")';
      }
    });

    var lists = Array.prototype.slice.call(document.querySelectorAll("[data-edit-list]"));
    var needsMeta = false;
    var pending = lists.map(function (el) {
      var val = getPath(data, el.getAttribute("data-edit-list"));
      var tpl = el.getAttribute("data-list-template");
      if (!Array.isArray(val) || !renderers[tpl] || !val.length) return null;
      var probe = document.createElement("div");
      probe.innerHTML = val.map(renderers[tpl]).join("");
      if (listSignature(probe) === listSignature(el)) return null;
      needsMeta = true;
      return { el: el, val: val, tpl: tpl };
    }).filter(Boolean);

    function commit() {
      pending.forEach(function (p) { p.el.innerHTML = p.val.map(renderers[p.tpl]).join(""); });
      document.dispatchEvent(new CustomEvent("content:applied", { detail: data }));
    }

    if (needsMeta && !window.GSImageMeta) {
      fetchJson(["content/image-meta.json"]).then(function (m) { if (m) window.GSImageMeta = m; commit(); });
    } else {
      commit();
    }
  }

  function loadContent() {
    return fetchJson(["api/?a=content", "content/content.json"]);
  }

  /* ---------------- Galerie ---------------- */
  var GALLERY_BATCH = 24;

  function initGalleryPage() {
    var container = document.querySelector('[data-gallery-list="gallery-public"]');
    if (!container) return;
    fetchJson(["api/?a=gallery", "content/gallery-public.json"]).then(function (items) {
      if (!items || !items.length) return;
      var shown = 0;
      var more = document.createElement("div");
      more.className = "gallery-more";
      more.innerHTML = '<button type="button" class="btn btn-primary"></button>';
      var btn = more.firstChild;
      container.innerHTML = "";
      function showMore() {
        var end = Math.min(items.length, shown + GALLERY_BATCH);
        var html = "";
        for (var i = shown; i < end; i++) html += renderers["gallery-item"](items[i], i);
        container.insertAdjacentHTML("beforeend", html);
        shown = end;
        if (shown >= items.length) more.remove();
        else btn.textContent = "Weitere Bilder laden (" + (items.length - shown) + ")";
      }
      container.parentNode.appendChild(more);
      btn.addEventListener("click", showMore);
      showMore();
      initLightbox(container, items);
    });
  }

  /* ---------------- Lightbox (Galerie) ---------------- */
  function initLightbox(container, items) {
    var lightbox = document.querySelector(".lightbox");
    if (!lightbox || lightbox.getAttribute("data-ready")) return;
    lightbox.setAttribute("data-ready", "1");
    var imgEl = lightbox.querySelector("img");
    var closeBtn = lightbox.querySelector(".lightbox__close");
    var counter = lightbox.querySelector(".lightbox__counter");
    if (!counter) {
      counter = document.createElement("div");
      counter.className = "lightbox__counter";
      counter.setAttribute("aria-live", "polite");
      lightbox.appendChild(counter);
    }
    var current = 0;
    var lastFocus = null;
    var inertEls = document.querySelectorAll(".site-header, main, .site-footer, .cta-bar, .back-to-top");
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Bildansicht");

    function preload(i) {
      var it = items[(i + items.length) % items.length];
      var p = new Image();
      p.src = rootPath() + (it.mid || it.jpg);
    }
    function show(i) {
      current = (i + items.length) % items.length;
      var it = items[current];
      imgEl.src = rootPath() + (it.mid || it.jpg);
      imgEl.alt = (it.alt || "Impression aus dem Schulleben") + ", Bild " + (current + 1) + " von " + items.length;
      counter.textContent = (current + 1) + " / " + items.length;
      if (!lightbox.classList.contains("is-open")) lastFocus = document.activeElement;
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
      document.body.classList.add("lightbox-open");
      inertEls.forEach(function (n) { n.setAttribute("inert", ""); });
      closeBtn.focus();
      preload(current + 1);
      preload(current - 1);
    }
    function close() {
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
      document.body.classList.remove("lightbox-open");
      inertEls.forEach(function (n) { n.removeAttribute("inert"); });
      imgEl.removeAttribute("src");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    lightbox.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = lightbox.querySelectorAll("button");
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    container.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-index]");
      if (btn) show(parseInt(btn.getAttribute("data-index"), 10));
    });
    closeBtn.addEventListener("click", close);
    lightbox.querySelector(".lightbox__prev").addEventListener("click", function () { show(current - 1); });
    lightbox.querySelector(".lightbox__next").addEventListener("click", function () { show(current + 1); });
    lightbox.addEventListener("click", function (e) { if (e.target === lightbox) close(); });
    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") show(current + 1);
      if (e.key === "ArrowLeft") show(current - 1);
    });

    // Wischgesten
    var startX = null, startY = null;
    lightbox.addEventListener("pointerdown", function (e) { startX = e.clientX; startY = e.clientY; });
    lightbox.addEventListener("pointerup", function (e) {
      if (startX === null) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      startX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(current + (dx < 0 ? 1 : -1));
    });
  }

  /* ---------------- Filter: Team & Aktuelles ---------------- */
  function buildFilterBar(host, groups, label, itemsSelector, matcher) {
    var old = host.previousElementSibling;
    if (old && old.classList.contains("filter-bar")) old.remove();
    var bar = document.createElement("div");
    bar.className = "filter-bar";
    var chips = groups.map(function (g, i) {
      return '<button type="button" class="chip" aria-pressed="' + (i === 0 ? "true" : "false") + '" data-group="' + esc(g) + '">' + esc(g) + "</button>";
    }).join("");
    bar.innerHTML =
      '<div class="filter-bar__chips" role="group" aria-label="' + esc(label) + '">' + chips + "</div>" +
      '<label class="filter-bar__search"><span class="visually-hidden">Suchen</span><input type="search" placeholder="Suchen …" autocomplete="off"></label>' +
      '<p class="filter-bar__count" role="status" aria-live="polite"></p>';
    host.parentNode.insertBefore(bar, host);
    var input = bar.querySelector("input");
    var count = bar.querySelector(".filter-bar__count");
    var active = groups[0];

    function apply() {
      var q = input.value.trim().toLowerCase();
      var visible = 0;
      host.querySelectorAll(itemsSelector).forEach(function (el) {
        var ok = matcher(el, active, q);
        el.hidden = !ok;
        if (ok) visible++;
      });
      count.textContent = visible + " Treffer";
    }
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      active = b.getAttribute("data-group");
      bar.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", String(c === b)); });
      apply();
    });
    input.addEventListener("input", apply);
    apply();
  }

  function teamGroup(text) {
    if (/schulleiter|vertretung der schulleitung/i.test(text)) return "Schulleitung";
    if (/schulhund/i.test(text)) return "Schulhund";
    if (/sekret|hausmeister|reinigung/i.test(text)) return "Verwaltung & Haus";
    if (/p(ä|ae)dagogische|schulbegleitung/i.test(text)) return "Pädagogische Mitarbeit";
    return "Lehrkräfte";
  }

  function initFilters() {
    var team = document.querySelector('[data-edit-list="pages.team.members"]');
    if (team && team.children.length > 6) {
      buildFilterBar(team, ["Alle", "Schulleitung", "Lehrkräfte", "Pädagogische Mitarbeit", "Verwaltung & Haus", "Schulhund"], "Team filtern", ".team-card",
        function (el, group, q) {
          var role = (el.querySelector(".team-card__role") || {}).textContent || "";
          var name = (el.querySelector(".team-card__name") || {}).textContent || "";
          return (group === "Alle" || teamGroup(role) === group) && (!q || (name + " " + role).toLowerCase().indexOf(q) !== -1);
        });
    }
    var posts = document.querySelector('[data-edit-list="pages.aktuelles.posts"]');
    if (posts && posts.children.length > 3) {
      var years = {};
      posts.querySelectorAll(".post-card__date").forEach(function (d) {
        var m = d.textContent.match(/(\d{4})\s*$/);
        if (m) years[m[1]] = true;
      });
      var list = ["Alle"].concat(Object.keys(years).sort().reverse());
      if (list.length > 2) {
        buildFilterBar(posts, list, "Beiträge nach Jahr filtern", ".post-card", function (el, group, q) {
          var date = (el.querySelector(".post-card__date") || {}).textContent || "";
          return (group === "Alle" || new RegExp(group + "\\s*$").test(date)) && (!q || el.textContent.toLowerCase().indexOf(q) !== -1);
        });
      }
    }
  }

  /* ---------------- Stundenplan: laufende Stunde markieren ---------------- */
  function initTimetable() {
    var table = document.querySelector(".timetable");
    if (!table) return;
    function mark() {
      var now = new Date();
      var day = now.getDay();
      var mins = now.getHours() * 60 + now.getMinutes();
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        tr.classList.remove("is-now");
        tr.removeAttribute("aria-current");
        var badge = tr.querySelector(".badge-now");
        if (badge) badge.remove();
        var cells = tr.querySelectorAll("td");
        if (cells.length < 2 || day < 1 || day > 5) return;
        var m = cells[1].textContent.match(/(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})/);
        if (!m) return;
        var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
        if (/mittwochs/i.test(cells[1].textContent) && day !== 3) return;
        if (mins >= a && mins < b) {
          tr.classList.add("is-now");
          tr.setAttribute("aria-current", "time");
          cells[0].insertAdjacentHTML("beforeend", ' <span class="badge-now">Jetzt</span>');
        }
      });
    }
    mark();
    if (!table.getAttribute("data-clock")) { table.setAttribute("data-clock", "1"); setInterval(mark, 60000); }
  }

  /* ---------------- Scroll-Effekte und Zähler ---------------- */
  var revealObserver = null;
  function initReveal() {
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("js-reveal");
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var t = en.target;
          t.classList.add("is-visible");
          revealObserver.unobserve(t);
          setTimeout(function () { t.classList.remove("reveal", "is-visible"); }, 1000);
          var counter = t.matches(".stat") ? t.querySelector(".stat__value") : null;
          if (counter) runCounter(counter);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    }
    var vh = window.innerHeight;
    var idx = 0;
    document.querySelectorAll(".section-head, .tile, .card, .stat, .team-card, .value-card, .post-card, .doc-item, .faq, .timeline__item, .contact-card, .banner").forEach(function (el) {
      if (el.classList.contains("reveal") || el.hidden) return;
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.9 && r.bottom > 0) { // schon im ersten Bildschirm sichtbar: nicht ausblenden
        var c0 = el.matches(".stat") ? el.querySelector(".stat__value") : null;
        if (c0) runCounter(c0);
        return;
      }
      el.classList.add("reveal");
      el.style.setProperty("--reveal-delay", Math.min(idx % 4, 3) * 70 + "ms");
      idx++;
      revealObserver.observe(el);
    });
  }

  function runCounter(el) {
    if (el.getAttribute("data-counted")) return;
    el.setAttribute("data-counted", "1");
    var m = el.textContent.trim().match(/^(\d{1,3})(\D.*)?$/);
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var end = parseInt(m[1], 10), suffix = m[2] || "", start = null;
    if (end < 2) return;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / 900);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) window.requestAnimationFrame(step);
    }
    el.textContent = "0" + suffix;
    window.requestAnimationFrame(step);
  }

  /* ---------------- FAQ: per Link-Anker öffnen ---------------- */
  function openFaqFromHash() {
    if (!location.hash) return;
    var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el && el.tagName === "DETAILS") { el.open = true; el.scrollIntoView(); }
  }

  /* ---------------- Karte: Drittanbieter erst nach Klick ---------------- */
  function initMapConsent() {
    document.querySelectorAll("[data-map-src]").forEach(function (box) {
      var src = box.getAttribute("data-map-src");
      box.innerHTML =
        '<div class="map-consent">' +
        "<p><strong>Karte von OpenStreetMap</strong><br>Beim Laden der Karte werden Daten (u. a. Ihre IP-Adresse) an die OpenStreetMap Foundation übertragen. Mehr dazu in der <a href=\"datenschutz.html\">Datenschutzerklärung</a>.</p>" +
        '<button type="button" class="btn btn-primary btn-sm">Karte laden</button></div>';
      box.querySelector("button").addEventListener("click", function () {
        var f = document.createElement("iframe");
        f.className = "map-frame";
        f.title = "Karte: Grundschule Flegessen";
        f.loading = "lazy";
        f.referrerPolicy = "no-referrer";
        f.src = src;
        box.innerHTML = "";
        box.appendChild(f);
      });
    });
  }

  /* ---------------- Kontaktformular: Validierung + mailto ---------------- */
  function initContactForm() {
    var form = document.querySelector("form[data-mailto]");
    if (!form) return;
    form.noValidate = true;
    var messages = { valueMissing: "Bitte füllen Sie dieses Feld aus.", typeMismatch: "Bitte geben Sie eine gültige E-Mail-Adresse ein." };

    function showError(field) {
      var id = field.id + "-error";
      var err = document.getElementById(id);
      if (field.validity.valid) {
        field.removeAttribute("aria-invalid");
        field.removeAttribute("aria-describedby");
        if (err) err.remove();
        return true;
      }
      if (!err) {
        err = document.createElement("p");
        err.id = id;
        err.className = "field-error";
        field.parentNode.appendChild(err);
      }
      err.textContent = field.validity.typeMismatch ? messages.typeMismatch : messages.valueMissing;
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", id);
      return false;
    }

    Array.prototype.forEach.call(form.elements, function (f) {
      if (f.tagName === "BUTTON") return;
      f.addEventListener("blur", function () { showError(f); });
      f.addEventListener("input", function () { if (f.getAttribute("aria-invalid")) showError(f); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var firstBad = null;
      Array.prototype.forEach.call(form.elements, function (f) {
        if (f.tagName === "BUTTON") return;
        if (!showError(f) && !firstBad) firstBad = f;
      });
      if (firstBad) { firstBad.focus(); return; }
      var v = function (n) { return (form.elements[n] && form.elements[n].value || "").trim(); };
      var body = "Name: " + v("name") + "\nE-Mail: " + v("email") + "\n\n" + v("message");
      window.location.href = "mailto:" + form.getAttribute("data-mailto") +
        "?subject=" + encodeURIComponent("Anfrage über die Website") +
        "&body=" + encodeURIComponent(body);
    });
  }

  /* ---------------- Sonstiges ---------------- */
  function initYear() {
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initQuickBar();
    initYear();
    initMapConsent();
    initContactForm();
    initGalleryPage();
    initTimetable();
    initFilters();
    openFaqFromHash();
    window.addEventListener("hashchange", openFaqFromHash);
    initReveal();
    loadContent().then(applyContent);
  });

  // nach dem Einspielen der Inhalte: Filter, Stundenplan, Effekte neu anwenden
  document.addEventListener("content:applied", function () {
    initFilters();
    initTimetable();
    initReveal();
    openFaqFromHash();
  });
})();
