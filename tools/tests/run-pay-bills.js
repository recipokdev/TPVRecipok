// Billetes rapidos del modal de cobro (5/10/20/50 EUR bajo el teclado). TPV real en perfil aislado y SIN red (no toca la
// demo ni ningun servidor): se prepara el estado del modal en memoria y se pulsan los botones de verdad.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}

(async () => {
  const userData = path.join(os.tmpdir(), `tpvrecipok-paybills-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 120000);
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => !!document.getElementById("payBills"))) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await win.waitForFunction(() => typeof payKeyBill === "function" && typeof renderPayMethods === "function", null, { timeout: 30000 });
    await sleep(1500);

    // Estado del modal: efectivo + tarjeta, total 13,50 EUR. Se muestra el modal para poder pulsar de verdad.
    await win.evaluate(() => {
      bindPayKeypadOnce();
      payModalState.formas = [{ codpago: "CONT", descripcion: "Efectivo", imprimir: true }, { codpago: "TARJ", descripcion: "Tarjeta", imprimir: true }];
      payModalState.totalCents = 1350; payModalState.values = {}; payModalState.selectedCodpago = null;
      renderPayMethods();
      payOverlay.classList.remove("hidden");
    });
    const cash = () => win.evaluate(() => document.querySelector('.pay-amount[data-codpago="CONT"]').value);
    const card = () => win.evaluate(() => document.querySelector('.pay-amount[data-codpago="TARJ"]').value);
    const change = () => win.evaluate(() => document.getElementById("payChangeBig").textContent);
    const sel = () => win.evaluate(() => payModalState.selectedCodpago);
    // El teclado de cobro ignora la MISMA tecla repetida en menos de 90 ms (antirrebote, ver bindPayKeypadOnce): con la pagina animada (barra de tiempo de los avisos)
    // los clics seguidos de Playwright podian llegar mas juntos que eso, algo que una persona no puede hacer. Se deja un respiro entre billetes.
    const bill = async (n) => { await win.click(`#payBills [data-k="bill:${n}"]`); await new Promise((r) => setTimeout(r, 130)); };

    const labels = await win.evaluate(() => [...document.querySelectorAll("#payBills .pay-bill")].map((b) => b.textContent.trim()));
    check("Salen los 4 billetes: 5, 10, 20 y 50 €", JSON.stringify(labels) === JSON.stringify(["5 €", "10 €", "20 €", "50 €"]), JSON.stringify(labels));
    check("Los billetes estan dentro del teclado, debajo de la fila del 0", await win.evaluate(() => {
      const bills = document.getElementById("payBills").getBoundingClientRect();
      const zero = document.querySelector('.pay-keypad [data-k="0"]').getBoundingClientRect();
      return bills.top >= zero.bottom - 1 && bills.left >= zero.left - 1;
    }));
    check("Los billetes se ven (no estan ocultos)", await win.evaluate(() => { const r = document.getElementById("payBills").getBoundingClientRect(); return r.width > 50 && r.height > 20; }));

    await bill(20);
    check("20 € -> entregado 20 en efectivo", (await cash()) === "20", await cash());
    check("20 € con total 13,50 -> cambio 6,50", /6,50/.test(await change()), await change());

    if (process.env.PAYBILLS_SHOT) await win.screenshot({ path: process.env.PAYBILLS_SHOT });

    // los billetes SUMAN (el cliente los va dando uno a uno)
    await bill(50);
    check("50 € despues de 20 € SUMA: entregado 70", (await cash()) === "70", await cash());
    check("70 entregados -> cambio 56,50", /56,50/.test(await change()), await change());

    await win.click('.pay-keypad [data-k="clear"]');
    await bill(5); await bill(5);
    check("Dos billetes de 5 -> entregado 10 (suma, no se queda en 5)", (await cash()) === "10", await cash());
    check("10 entregados con total 13,50 -> falta 3,50 (cambio negativo)", /-/.test(await change()) && /3,50/.test(await change()), await change());
    await bill(5);
    check("Un tercer billete de 5 -> 15 y ya cubre el total, cambio 1,50", (await cash()) === "15" && /1,50/.test(await change()) && !/-/.test(await change()), `${await cash()} / ${await change()}`);

    await win.click('.pay-keypad [data-k="clear"]');
    await bill(5); await bill(10); await bill(20);
    check("5 + 10 + 20 -> entregado 35, cambio 21,50", (await cash()) === "35" && /21,50/.test(await change()), `${await cash()} / ${await change()}`);

    // suma sobre un importe tecleado a mano, con decimales, sin errores de coma flotante
    await win.click('.pay-keypad [data-k="clear"]');
    await win.click('.pay-keypad [data-k="0"]');
    await win.evaluate(() => { payModalState.values = { CONT: "0.1" }; renderPayMethods(); });
    await bill(5); await bill(5);
    check("0,10 tecleados + 5 + 5 -> 10.1 (sin 10.100000000000001)", (await cash()) === "10.1", await cash());
    await win.evaluate(() => { payModalState.values = { CONT: "1,5" }; renderPayMethods(); });
    await bill(5);
    check("Un importe con coma (1,5) + 5 -> 6.5", (await cash()) === "6.5", await cash());

    // con la tarjeta seleccionada, el billete va al efectivo y lo selecciona
    await win.evaluate(() => { payModalState.values = {}; renderPayMethods(); });
    await win.evaluate(() => { document.querySelector('.pay-amount[data-codpago="TARJ"]').click(); });
    check("Tarjeta seleccionada", (await sel()) === "TARJ");
    await bill(10);
    check("Con la tarjeta seleccionada, 10 € se pone en el efectivo", (await cash()) === "10", await cash());
    check("... y selecciona la fila de efectivo", (await sel()) === "CONT", await sel());
    check("... sin tocar la tarjeta", (await card()) === "", await card());
    await bill(10);
    check("... y el siguiente billete sigue sumando en el efectivo (20)", (await cash()) === "20", await cash());

    // tarjeta con importe + billete que cubre el total: la tarjeta se recorta (no se cobra de mas)
    await win.evaluate(() => { payModalState.values = { TARJ: "5" }; renderPayMethods(); });
    await bill(20);
    check("Tarjeta 5 + billete de 20 (cubre el total): la tarjeta se recorta a 0", Number(await card() || 0) === 0, await card());

    // la tecla C borra y el teclado normal sigue funcionando despues de usar un billete
    await win.click('.pay-keypad [data-k="clear"]');
    check("C borra los importes tras usar billetes", (await cash()) === "" && (await card()) === "");
    await win.click('.pay-keypad [data-k="1"]'); await win.click('.pay-keypad [data-k="2"]');
    check("El teclado numerico sigue escribiendo despues de usar billetes", (await cash()) === "12", await cash());

    // sin ninguna forma de efectivo, los billetes no salen
    await win.evaluate(() => { payModalState.formas = [{ codpago: "TARJ", descripcion: "Tarjeta", imprimir: true }]; payModalState.values = {}; payModalState.selectedCodpago = null; renderPayMethods(); });
    check("Sin forma de pago en efectivo, los billetes se ocultan", await win.evaluate(() => document.getElementById("payBills").classList.contains("hidden") && document.getElementById("payBills").getBoundingClientRect().width === 0));
    await win.evaluate(() => { payKeyBill(20); });
    check("... y aunque se llamara, no escribe nada", (await card()) === "", await card());

    // ticket gratuito (0 €): el teclado entero esta bloqueado, tambien los billetes
    await win.evaluate(() => { payModalState.formas = [{ codpago: "CONT", descripcion: "Efectivo", imprimir: true }]; payModalState.totalCents = 0; renderPayMethods(); document.querySelector(".pay-keypad").classList.add("pay-frozen"); });
    check("Con el cobro bloqueado (ticket a 0 €) los billetes no reciben pulsaciones", await win.evaluate(() => getComputedStyle(document.querySelector(".pay-keypad")).pointerEvents === "none"));
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    clearTimeout(hard);
    kill();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
