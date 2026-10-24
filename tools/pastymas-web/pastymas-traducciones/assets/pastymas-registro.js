/* Pastymas – registro: calcula la respuesta de JavaScript a partir del sello de tiempo y, si hay reCAPTCHA v3, añade el token antes de enviar. */
(function () {
  'use strict';
  function pmHash(s) { var h = 7; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) % 1000000007; } return 'ok-' + h.toString(36); }
  function fillJs(form) {
    var js = form.querySelector('input[name="pm_js"]'), t = form.querySelector('input[name="pm_t"]');
    if (js && t) js.value = pmHash(t.value);
  }
  function rcReady() { return !!(window.grecaptcha && grecaptcha.execute && grecaptcha.ready); }
  function getToken(key, cb) {
    try { grecaptcha.ready(function () { grecaptcha.execute(key, { action: 'registro' }).then(cb).catch(function () { cb(''); }); }); } catch (e) { cb(''); }
  }
  function prep(form) {
    fillJs(form);
    var rc = form.querySelector('input[name="pm_rc"]'); if (!rc || !rc.getAttribute('data-sitekey')) return;
    var key = rc.getAttribute('data-sitekey');
    if (!form.dataset.pmSubmit) {
      form.dataset.pmSubmit = '1';
      form.addEventListener('submit', function (e) {
        fillJs(form);
        if (rc.value || !rcReady() || form.dataset.pmSending) return;
        e.preventDefault(); form.dataset.pmSending = '1';
        getToken(key, function (t) { rc.value = t || ''; form.submit(); });
      });
    }
    if (form.dataset.pmRc || !rcReady()) return;
    form.dataset.pmRc = '1';
    var refresh = function () { getToken(key, function (t) { if (t) rc.value = t; }); };
    refresh(); setInterval(refresh, 100000); // los tokens caducan a los 2 minutos
  }
  function forms() { return document.querySelectorAll('form.register, form.woocommerce-form-register, form.checkout'); }
  function init() { forms().forEach(prep); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // Si la librería de reCAPTCHA carga más tarde que este script, reintentar durante 20 s
  var intentos = 0, esperar = setInterval(function () { init(); if (rcReady() || ++intentos > 40) clearInterval(esperar); }, 500);
  document.addEventListener('focusin', function (e) { var f = e.target && e.target.closest && e.target.closest('form'); if (f) prep(f); }, true);
  // El checkout de WooCommerce se reconstruye por AJAX: volver a rellenar antes de enviar
  document.addEventListener('submit', function (e) { var f = e.target; if (f && f.matches && f.matches('form.checkout, form.register, form.woocommerce-form-register')) fillJs(f); }, true);
})();
