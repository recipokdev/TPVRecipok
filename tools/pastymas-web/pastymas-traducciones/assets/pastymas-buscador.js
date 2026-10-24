/* Pastymas – Buscador de productos en vivo.
   Carga una vez un índice ligero de productos (JSON estático) y resuelve cada búsqueda en local al instante.
   Si el índice no está disponible, usa la API de WooCommerce como respaldo. */
(function () {
  'use strict';
  var CFG = window.pastymasBuscador || {};
  var MIN = parseInt(CFG.minChars, 10) || 3;
  var LIMIT = parseInt(CFG.limit, 10) || 8;
  var API = (CFG.api || '/wp-json/wc/store/v1/products') + '?per_page=' + LIMIT + '&search=';
  var SEARCH_URL = CFG.searchUrl || '/';
  var TXT = CFG.i18n || {};
  var index = null, indexPromise = null, apiCache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function parseLoose(text) { var i = text.search(/[\[{]/); return JSON.parse(i > 0 ? text.slice(i) : text); }

  /* ---------- Índice local ---------- */
  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = new Promise(function (resolve) {
      var urls = [];
      if (CFG.indexUrl) urls.push(CFG.indexUrl);
      if (CFG.indexApi) urls.push(CFG.indexApi);
      var key = 'pmBuscadorIndice';
      try {
        var cached = sessionStorage.getItem(key);
        if (cached) { var c = JSON.parse(cached); if (c && c.url === CFG.indexUrl && c.items) { index = prepare(c.items); resolve(index); return; } }
      } catch (e) {}
      (function next(i) {
        if (i >= urls.length) { resolve(null); return; }
        fetch(urls[i], { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then(function (t) {
            var d = parseLoose(t); var items = d && d.items ? d.items : (Array.isArray(d) ? d : null);
            if (!items || !items.length) throw new Error('vacío');
            index = prepare(items);
            try { sessionStorage.setItem(key, JSON.stringify({ url: CFG.indexUrl, items: items })); } catch (e) {}
            resolve(index);
          }).catch(function () { next(i + 1); });
      })(0);
    });
    return indexPromise;
  }
  function prepare(items) {
    return items.map(function (p) { p._n = norm(p.n); p._s = norm(p.s || ''); return p; });
  }
  function searchIndex(term) {
    var q = norm(term).trim(); var words = q.split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < index.length; i++) {
      var p = index[i], ok = true, score = 3;
      for (var w = 0; w < words.length; w++) {
        if (p._n.indexOf(words[w]) < 0 && p._s.indexOf(words[w]) < 0) { ok = false; break; }
      }
      if (!ok) continue;
      if (p._n.indexOf(q) === 0) score = 0;
      else if (p._n.indexOf(' ' + q) >= 0) score = 1;
      else if (p._n.indexOf(q) >= 0) score = 2;
      out.push({ p: p, s: score });
    }
    out.sort(function (a, b) { return a.s - b.s || a.p._n.localeCompare(b.p._n); });
    return out.slice(0, LIMIT).map(function (r) { return { name: r.p.n, permalink: r.p.u, thumb: r.p.t, price: r.p.p, regular: r.p.r || '', inStock: r.p.o !== 0 }; });
  }

  /* ---------- Respaldo: API de WooCommerce ---------- */
  function searchApi(term, cb) {
    if (apiCache[term]) { cb(apiCache[term]); return; }
    fetch(API + encodeURIComponent(term), { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var d = parseLoose(t);
        var list = (Array.isArray(d) ? d : []).map(function (p) {
          var pr = p.prices || {}; var mu = parseInt(pr.currency_minor_unit || 2, 10);
          var price = p.price_html ? p.price_html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ((parseInt(pr.price || 0, 10) / Math.pow(10, mu)).toFixed(mu).replace('.', ',') + ' ' + (pr.currency_symbol || '€'));
          return { name: p.name, permalink: p.permalink, thumb: (p.images && p.images[0]) ? (p.images[0].thumbnail || p.images[0].src) : '', price: price, inStock: p.is_in_stock !== false };
        });
        apiCache[term] = list; cb(list);
      }).catch(function () { cb([]); });
  }

  /* ---------- Interfaz ---------- */
  function build(input) {
    var form = input.closest('form') || input.parentNode;
    var box = document.createElement('div');
    box.className = 'pm-buscador'; box.setAttribute('role', 'listbox'); box.hidden = true;
    var container = input.closest('.elementor-search-form__container');
    var fullScreen = !!(input.closest('.elementor-search-form--skin-full_screen') || (container && window.getComputedStyle(container).position === 'fixed'));
    if (fullScreen && container) { box.classList.add('pm-buscador--full'); container.appendChild(box); }
    else { var host = input.parentNode; if (host && host.classList) { host.classList.add('pm-buscador-host'); } host.appendChild(box); }

    if (form && form.tagName === 'FORM' && !form.querySelector('input[name="post_type"]')) {
      var h = document.createElement('input'); h.type = 'hidden'; h.name = 'post_type'; h.value = 'product'; form.appendChild(h);
    }

    var timer = null, active = -1, items = [], seq = 0;
    function hide() { box.hidden = true; box.innerHTML = ''; active = -1; items = []; input.setAttribute('aria-expanded', 'false'); }
    function loader() { box.innerHTML = '<div class="pm-buscador__loading"><span class="pm-buscador__spinner"></span>' + esc(TXT.loading || 'Buscando…') + '</div>'; box.hidden = false; items = []; active = -1; }
    function render(term, list) {
      if (!list.length) { box.innerHTML = '<div class="pm-buscador__empty">' + esc(TXT.noResults || 'No hay productos') + '</div>'; box.hidden = false; items = []; return; }
      var html = list.map(function (p) {
        var stock = p.inStock ? '' : '<span class="pm-buscador__stock">' + esc(TXT.outOfStock || 'Agotado') + '</span>';
        return '<a class="pm-buscador__item" role="option" href="' + esc(p.permalink) + '">' +
          (p.thumb ? '<img class="pm-buscador__img" src="' + esc(p.thumb) + '" alt="" loading="lazy">' : '<span class="pm-buscador__img pm-buscador__img--empty"></span>') +
          '<span class="pm-buscador__body"><span class="pm-buscador__name">' + esc(p.name) + '</span>' +
          '<span class="pm-buscador__price">' + (p.regular ? '<del>' + esc(p.regular) + '</del> ' : '') + '<strong>' + esc(p.price) + '</strong> ' + stock + '</span></span></a>';
      }).join('');
      html += '<a class="pm-buscador__all" href="' + esc(SEARCH_URL) + '?s=' + encodeURIComponent(term) + '&post_type=product">' + esc(TXT.viewAll || 'Ver todos los resultados') + ' →</a>';
      box.innerHTML = html; box.hidden = false; input.setAttribute('aria-expanded', 'true');
      items = Array.prototype.slice.call(box.querySelectorAll('.pm-buscador__item, .pm-buscador__all')); active = -1;
    }
    function search() {
      var term = input.value.trim(); var my = ++seq;
      if (term.length < MIN) { hide(); return; }
      if (index) { render(term, searchIndex(term)); return; }
      loader();
      loadIndex().then(function (idx) {
        if (my !== seq || input.value.trim() !== term) return;
        if (idx) { render(term, searchIndex(term)); }
        else { searchApi(term, function (list) { if (my === seq && input.value.trim() === term) render(term, list); }); }
      });
    }

    input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-autocomplete', 'list');
    input._pm = {
      onInput: function () { clearTimeout(timer); timer = setTimeout(search, index ? 60 : 150); },
      onFocus: function () { loadIndex(); if (input.value.trim().length >= MIN && box.innerHTML) { box.hidden = false; } },
      onKey: function (e) {
        if (box.hidden || !items.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          active = e.key === 'ArrowDown' ? Math.min(active + 1, items.length - 1) : Math.max(active - 1, 0);
          items.forEach(function (el, i) { el.classList.toggle('is-active', i === active); });
          items[active].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); window.location.href = items[active].href; }
        else if (e.key === 'Escape') { hide(); }
      },
      hide: hide, box: box
    };
  }

  var SELECTOR = '.elementor-search-form__input, form[role="search"] input[type="search"], form.search-form input[name="s"], input.aws-search-field';
  function ensure(el) {
    if (!el || !el.matches || !el.matches(SELECTOR)) return null;
    if (!el._pm) { build(el); }
    return el._pm;
  }
  document.addEventListener('input', function (e) { var st = ensure(e.target); if (st) st.onInput(); }, true);
  document.addEventListener('focusin', function (e) { var st = ensure(e.target); if (st) st.onFocus(); }, true);
  document.addEventListener('keydown', function (e) { var st = e.target && e.target._pm; if (st) st.onKey(e); }, true);
  document.addEventListener('click', function (e) {
    Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), function (el) {
      if (el._pm && !el._pm.box.contains(e.target) && e.target !== el) el._pm.hide();
    });
    // Al abrir la lupa de la cabecera se precarga el índice para que la primera búsqueda sea inmediata
    if (e.target && e.target.closest && e.target.closest('.elementor-search-form__toggle')) { loadIndex(); }
  });
  function init() { Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), ensure); }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
  window.addEventListener('load', init);
})();
