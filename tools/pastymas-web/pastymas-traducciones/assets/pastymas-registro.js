/* Pastymas – registro: rellena el campo de JavaScript y, si hay reCAPTCHA v3, añade el token antes de enviar. */
(function () {
  'use strict';
  function prep(form) {
    var js = form.querySelector('input[name="pm_js"]'); if (js) js.value = 'ok-' + Date.now();
    var rc = form.querySelector('input[name="pm_rc"]'); if (!rc || !rc.getAttribute('data-sitekey') || !window.grecaptcha || !grecaptcha.execute) return;
    if (form.dataset.pmRc) return; form.dataset.pmRc = '1';
    var key = rc.getAttribute('data-sitekey');
    var refresh = function () { try { grecaptcha.ready(function () { grecaptcha.execute(key, { action: 'registro' }).then(function (t) { rc.value = t; }); }); } catch (e) {} };
    refresh(); setInterval(refresh, 100000); // los tokens caducan a los 2 minutos
    form.addEventListener('submit', function (e) {
      if (rc.value) return;
      e.preventDefault();
      try { grecaptcha.ready(function () { grecaptcha.execute(key, { action: 'registro' }).then(function (t) { rc.value = t; form.submit(); }).catch(function () { form.submit(); }); }); } catch (err) { form.submit(); }
    });
  }
  function init() { document.querySelectorAll('form.register, form.woocommerce-form-register, form.checkout').forEach(prep); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('focusin', function (e) { var f = e.target && e.target.closest && e.target.closest('form'); if (f) prep(f); }, true);
  // El checkout de WooCommerce se reconstruye por AJAX: volver a rellenar antes de enviar
  document.addEventListener('submit', function (e) { var f = e.target; if (f && f.matches && f.matches('form.checkout, form.register')) { var js = f.querySelector('input[name="pm_js"]'); if (js && !js.value) js.value = 'ok-' + Date.now(); } }, true);
})();
