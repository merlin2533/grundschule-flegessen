// Grundschule Flegessen – shared front-end logic
// - mobile navigation
// - overlays content.json onto [data-edit] / [data-edit-img] / [data-edit-list]
//   so admin edits show up without touching the baked-in HTML (which stays
//   as the SEO/no-JS fallback)
// - lightbox for the gallery

(function () {
  "use strict";

  function rootPath() {
    var el = document.querySelector('meta[name="content-root"]');
    return el ? el.getAttribute("content") : "";
  }

  /* ---------------- Navigation ---------------- */
  function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector(".main-nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
      document.body.style.overflow = !open ? "hidden" : "";
    });

    nav.querySelectorAll(".has-dropdown > a").forEach(function (link) {
      link.addEventListener("click", function (e) {
        if (window.matchMedia("(max-width: 900px)").matches) {
          var parent = link.parentElement;
          var alreadyOpen = parent.classList.contains("is-open");
          if (!alreadyOpen) {
            e.preventDefault();
            nav.querySelectorAll(".has-dropdown.is-open").forEach(function (n) {
              n.classList.remove("is-open");
            });
            parent.classList.add("is-open");
          }
        }
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        toggle.click();
      }
    });
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

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) { return w[0]; })
      .join("")
      .toUpperCase();
  }

  function imgTag(img, opts) {
    opts = opts || {};
    if (!img || !img.file) return "";
    var cls = opts.cls ? ' class="' + opts.cls + '"' : "";
    var loading = opts.eager ? "" : ' loading="lazy"';
    return '<img src="' + esc(rootPath() + img.file) + '" alt="' + esc(img.alt || "") + '"' + cls + loading + ">";
  }

  var renderers = {
    "team-member": function (m) {
      var isDog = /schulhund/i.test(m.role || "");
      var photo = m.photo && m.photo.file
        ? imgTag(m.photo)
        : '<span class="team-card__initials">' + (isDog ? "🐾" : esc(initials(m.name))) + "</span>";
      return (
        '<div class="team-card"><div class="team-card__photo">' + photo + "</div>" +
        '<h3 class="team-card__name">' + esc(m.name) + "</h3>" +
        '<p class="team-card__role">' + esc(m.role) + "</p></div>"
      );
    },
    "klasse-item": function (k) {
      return (
        '<div class="tile"><div class="tile__media">' + imgTag(k.photo) + "</div>" +
        "<h3>" + esc(k.name) + '<br><span style="font-weight:400;font-size:.85em;color:var(--color-muted)">' + esc(k.teacher) + "</span></h3></div>"
      );
    },
    "post-item": function (p) {
      var media = p.image && p.image.file ? '<div class="post-card__media">' + imgTag(p.image) + "</div>" : "";
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
        '<p class="doc-item__desc">' + esc(d.description || "") + "</div>" +
        '<a class="btn btn-ghost btn-sm" href="' + esc(rootPath() + d.file) + '" target="_blank" rel="noopener">Öffnen</a></li>'
      );
    },
    "timetable-row": function (r) {
      return (
        '<tr' + (/pause/i.test(r.label) ? ' class="is-break"' : "") + "><td>" + esc(r.label) + "</td>" +
        "<td>" + esc(r.time) + (r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</td></tr>"
      );
    },
    "gallery-item": function (g, idx) {
      return (
        '<button type="button" data-full="' + esc(rootPath() + g.jpg) + '" data-alt="' + esc(g.alt || "Impression aus dem Schulleben") + '" data-index="' + idx + '">' +
        '<img src="' + esc(rootPath() + g.thumbJpg) + '" alt="' + esc(g.alt || "Impression aus dem Schulleben") + '" loading="lazy"></button>'
      );
    }
  };

  function applyContent(data) {
    if (!data) return;

    document.querySelectorAll("[data-edit]").forEach(function (el) {
      var val = getPath(data, el.getAttribute("data-edit"));
      if (typeof val === "string" && val.trim() !== "") el.innerHTML = val;
    });

    document.querySelectorAll("[data-edit-img]").forEach(function (el) {
      var val = getPath(data, el.getAttribute("data-edit-img"));
      if (val && val.file) {
        var target = el.tagName === "IMG" ? el : el.querySelector("img");
        if (target) {
          target.src = rootPath() + val.file;
          if (val.alt) target.alt = val.alt;
        } else if (el.tagName !== "IMG") {
          el.style.backgroundImage = 'url("' + rootPath() + val.file + '")';
        }
      }
    });

    document.querySelectorAll("[data-edit-list]").forEach(function (el) {
      var val = getPath(data, el.getAttribute("data-edit-list"));
      var tpl = el.getAttribute("data-list-template");
      if (Array.isArray(val) && renderers[tpl] && val.length) {
        el.innerHTML = val.map(renderers[tpl]).join("");
        if (tpl === "gallery-item") initLightbox(el, val);
      }
    });

    document.dispatchEvent(new CustomEvent("content:applied", { detail: data }));
  }

  function loadContent() {
    return fetch(rootPath() + "content/content.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  /* ---------------- Lightbox (gallery) ---------------- */
  function initLightbox(container, items) {
    var lightbox = document.querySelector(".lightbox");
    if (!lightbox) return;
    var imgEl = lightbox.querySelector("img");
    var current = 0;

    function show(i) {
      current = (i + items.length) % items.length;
      var it = items[current];
      imgEl.src = rootPath() + it.jpg;
      imgEl.alt = it.alt || "Impression aus dem Schulleben";
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
    }
    function close() {
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
      imgEl.src = "";
    }

    container.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-index]");
      if (btn) show(parseInt(btn.getAttribute("data-index"), 10));
    });
    lightbox.querySelector(".lightbox__close").addEventListener("click", close);
    lightbox.querySelector(".lightbox__prev").addEventListener("click", function () { show(current - 1); });
    lightbox.querySelector(".lightbox__next").addEventListener("click", function () { show(current + 1); });
    lightbox.addEventListener("click", function (e) { if (e.target === lightbox) close(); });
    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") show(current + 1);
      if (e.key === "ArrowLeft") show(current - 1);
    });
  }

  /* ---------------- Misc ---------------- */
  function initYear() {
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initYear();
    loadContent().then(applyContent);
  });
})();
