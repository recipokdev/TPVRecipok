// run-e2e-real-demo.js
//
// A diferencia de test:e2e / test:e2e:mesas / test:e2e:tx (que corren con
// TPV_E2E=1 y una caja FICTICIA que no permite cobrar de verdad -- ver
// comentario en run-two-tpv.js), este fichero lanza el TPV REAL (sin
// TPV_E2E) contra el backend real de demo, con la sesion ya logueada de
// forma persistente en el userData por defecto de esta maquina (igual que
// hacen a mano las verificaciones manuales de este proyecto). Sirve para
// cubrir de forma PERMANENTE los escenarios que solo se pueden comprobar
// cobrando de verdad -- cosa que la suite E2E normal no puede hacer.
//
// Cada ejecucion crea un ticket aparcado y una factura REAL en demo. Se
// intenta borrar el aparcado al terminar via deleteParkedTicketByIndex
// (best-effort: su borrado remoto es fire-and-forget y a veces no llega a
// tiempo antes de cerrar la app -- no se ha perseguido el 100% porque no
// hace falta). La factura de FacturaScripts siempre se queda -- demo es una
// cuenta de pruebas. Cualquier resto (aparcado o factura) es inofensivo:
// al estar ya cobrado, el cron horario purgeExpiredPaidParkedReservationsDb
// lo borra solo pasadas 24h, igual que cualquier aparcado cobrado real (ver
// project_tpv_performance_overhaul_2026-08-25). No se ejecuta en el
// pre-push por crear datos reales en cada corrida -- se lanza a mano con
// "npm run test:e2e:real-demo" cuando se toca lógica de aparcados/cobro.
//
// Uso: npm run test:e2e:real-demo

process.env.TPV_RUN_BACKGROUND = process.env.TPV_RUN_BACKGROUND || "1";

const path = require("path");
const { _electron: electron } = require("playwright");

function ok(msg) {
  console.log(`[E2E-REAL][OK] ${msg}`);
}

let failed = false;
function fail(msg) {
  console.error(`[E2E-REAL][FAIL] ${msg}`);
  failed = true;
}

async function findMainWindow(electronApp) {
  const timeoutMs = 30000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const w of electronApp.windows()) {
      try {
        await w.waitForLoadState("domcontentloaded", { timeout: 5000 });
        const hasRoot = await w.evaluate(
          () => !!document.getElementById("cashHeaderBtn"),
        );
        if (hasRoot) return w;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

(async () => {
  const root = process.cwd();
  const electronApp = await electron.launch({
    args: [path.join(root, ".")],
    cwd: root,
    env: { ...process.env },
  });

  const pid = electronApp.process()?.pid;
  // electronApp.close() colgandose al final es un artefacto conocido e
  // inofensivo (ver feedback_playwright_electron_close_hangs) -- si ya
  // terminamos el trabajo real (workDone), este timeout solo debe forzar el
  // cierre del proceso con el resultado YA determinado, no marcar fallo.
  let workDone = false;
  const hardTimeout = setTimeout(() => {
    if (!workDone) {
      console.error(`[E2E-REAL][FAIL] Hard timeout -- force-killing pid=${pid}`);
    }
    try {
      if (pid) require("child_process").execSync(`taskkill /PID ${pid} /T /F`);
    } catch {}
    process.exit(workDone ? process.exitCode || 0 : 1);
  }, 150000);

  let win;
  const createdTicketNames = [];

  try {
    win = await findMainWindow(electronApp);
    if (!win) throw new Error("No se encontro la ventana principal del TPV.");
    await win.waitForFunction(
      () => !!currentTerminal && typeof cashSession?.open === "boolean",
      { timeout: 20000 },
    );
    if (!(await win.evaluate(() => !!getCurrentSlugForReservations && getCurrentSlugForReservations() === "demo"))) {
      throw new Error(
        "Este TPV no esta conectado a 'demo' -- abortando para no cobrar contra un cliente real.",
      );
    }
    await win.waitForTimeout(1000);

    const dismissOverlay = async () => {
      const visible = await win.evaluate(() => {
        const el = document.getElementById("msgOverlay");
        return !!el && !el.classList.contains("hidden");
      });
      if (visible) {
        await win.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("#msgOverlay button"));
          const accept = buttons.find((b) => /aceptar|ok|s[ií]/i.test(b.textContent || ""));
          (accept || buttons[buttons.length - 1])?.click();
        });
        await win.waitForTimeout(300);
      }
    };

    const resetCart = () =>
      win.evaluate(() => {
        cart = [];
        setCurrentParkedTicketIndex(null);
        PENDING_RUNTIME_PARKED_SYNC_KEY = "";
        PENDING_RUNTIME_PARKED_TICKET_ID = 0;
        renderCart();
      });
    await resetCart();
    await win.waitForTimeout(1500);
    await resetCart();
    for (let i = 0; i < 5; i++) { await dismissOverlay(); await win.waitForTimeout(150); }

    const reIdx = (name) => win.evaluate((n) => parkedTickets.findIndex((t) => t.name === n), name);

    async function parkThenPay(itemId, custLabel, namePrefix) {
      await win.evaluate((xId) => {
        const x = products.find((p) => getProductBaseId(p) === xId);
        if (!x) throw new Error(`Producto ${xId} no encontrado en demo`);
        cart = [{ ...buildCartLine(x, 1) }];
        renderCart();
      }, itemId);
      const name = `${namePrefix}-${custLabel.replace(/\s/g, "")}-${Date.now()}`;
      createdTicketNames.push(name);
      await win.evaluate(async (n) => { await parkCurrentCart(n, ""); }, name);
      await win.waitForTimeout(500);
      const idx = await reIdx(name);
      if (idx < 0) throw new Error(`No se pudo aparcar el pedido de ${custLabel}`);
      const ticketId = await win.evaluate((i) => String(parkedTickets[i]?.id || ""), idx);
      await win.evaluate((i) => restoreParkedCartByIndex(i), idx);
      await win.waitForTimeout(300);

      for (let i = 0; i < 5; i++) { await dismissOverlay(); await win.waitForTimeout(150); }
      await win.evaluate(() => document.querySelector("#payBtn, #cobrarBtn, [data-action='pay']")?.click());
      await win.waitForSelector("#payModal:not(.hidden), .pay-modal:not(.hidden)", { timeout: 15000 }).catch(() => {});
      await win.waitForTimeout(300);
      const codpagoAttr = await win.evaluate(() => document.querySelector("input.pay-amount")?.getAttribute("data-codpago") || null);
      if (!codpagoAttr) throw new Error(`No se encontro forma de pago para ${custLabel}`);
      await win.evaluate((codpago) => {
        document.querySelector(`input.pay-amount[data-codpago="${codpago}"]`)?.parentElement?.querySelector("button.pay-max")?.click();
      }, codpagoAttr);
      await win.waitForTimeout(200);
      for (let i = 0; i < 5; i++) { await dismissOverlay(); await win.waitForTimeout(150); }
      await win.evaluate(() => document.getElementById("paySaveBtn")?.click());
      await win.waitForFunction(() => Array.isArray(cart) && cart.length === 0, { timeout: 20000 });
      return ticketId;
    }

    console.log(
      "\n[E2E-REAL] Escenario 2026-09-14: el pedido del siguiente cliente no debe fusionarse con el que se acaba de cobrar (mismo TPV/mesa, cobro real seguido)\n",
    );

    const ITEM_A = 468; // Magdalena
    const ITEM_B = 504; // Barra Pan Normal
    const ticketId1 = await parkThenPay(ITEM_A, "Cliente1", "E2EREAL-NEXTSALE");
    const ticketId2 = await parkThenPay(ITEM_B, "Cliente2", "E2EREAL-NEXTSALE");
    const currentIdxAfter = await win.evaluate(() => currentParkedTicketIndex);

    if (ticketId1 && ticketId2 && ticketId1 !== ticketId2) {
      ok("Dos cobros reales seguidos en el mismo TPV generan tickets independientes (no se fusiona el segundo con el primero)");
    } else {
      fail(`El segundo pedido comparte ticket con el primero (ticketId1=${ticketId1} ticketId2=${ticketId2})`);
    }

    if (currentIdxAfter === null) {
      ok("currentParkedTicketIndex queda limpio tras cobrar ambos pedidos");
    } else {
      fail(`currentParkedTicketIndex deberia ser null tras cobrar ambos, pero es ${currentIdxAfter}`);
    }

    // Limpieza best-effort: borrar el aparcado local/remoto via la propia
    // app (sin credenciales de BD). El borrado remoto es fire-and-forget
    // (deleteParkedTicketByIndex no espera a que termine), y lanzar los dos
    // borrados espalda con espalda puede perder uno (posible colision de
    // peticiones en vuelo) -- de ahi la pausa entre cada uno. Si aun asi
    // queda algun resto, no es un fallo del test: al estar ya cobrado
    // (paid=1), el cron horario de purgeExpiredPaidParkedReservationsDb lo
    // borra solo pasadas 24h, igual que cualquier aparcado cobrado real.
    for (const name of createdTicketNames) {
      const idx = await reIdx(name);
      if (idx >= 0) {
        await win.evaluate((i) => deleteParkedTicketByIndex(i, { confirm: false }), idx);
        await win.waitForTimeout(2500);
      }
    }

    if (failed) {
      console.error("\n[E2E-REAL] FAILED\n");
      process.exitCode = 1;
    } else {
      console.log("\n[E2E-REAL] All real-demo checks passed.\n");
    }
    workDone = true;
  } catch (err) {
    console.error("[E2E-REAL][FAIL]", err?.message || err);
    process.exitCode = 1;
  } finally {
    // OJO (ver feedback_playwright_electron_close_hangs): nunca limpiar el
    // hardTimeout antes de close() -- es el safety-net para cuando
    // electronApp.close() se cuelga (artefacto conocido e inofensivo).
    try {
      await electronApp.close();
    } catch {}
    process.exit(process.exitCode || 0);
  }
})();
