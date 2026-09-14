// run-e2e-customer-papelera.js
//
// Verifica en vivo, contra el backend real de demo (mismo patron que
// run-e2e-real-demo.js: app real, sin TPV_E2E, sesion ya logueada), la
// papelera de clientes del TPV: ocultar/reactivar/borrar definitivamente/
// fallback a "dar de baja" cuando FacturaScripts rechaza el borrado real.
//
// Uso: npm run test:e2e:customer-papelera

process.env.TPV_RUN_BACKGROUND = process.env.TPV_RUN_BACKGROUND || "1";

const path = require("path");
const { _electron: electron } = require("playwright");

function ok(msg) {
  console.log(`[E2E-PAPELERA][OK] ${msg}`);
}

let failed = false;
function fail(msg) {
  console.error(`[E2E-PAPELERA][FAIL] ${msg}`);
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
  let workDone = false;
  const hardTimeout = setTimeout(() => {
    if (!workDone) {
      console.error(`[E2E-PAPELERA][FAIL] Hard timeout -- force-killing pid=${pid}`);
    }
    try {
      if (pid) require("child_process").execSync(`taskkill /PID ${pid} /T /F`);
    } catch {}
    process.exit(workDone ? process.exitCode || 0 : 1);
  }, 150000);

  let win;
  try {
    win = await findMainWindow(electronApp);
    if (!win) throw new Error("No se encontro la ventana principal del TPV.");
    await win.waitForFunction(
      () => !!currentTerminal && typeof cashSession?.open === "boolean",
      { timeout: 20000 },
    );
    if (
      !(await win.evaluate(
        () =>
          !!getCurrentSlugForReservations &&
          getCurrentSlugForReservations() === "demo",
      ))
    ) {
      throw new Error(
        "Este TPV no esta conectado a 'demo' -- abortando para no tocar clientes reales.",
      );
    }
    await win.waitForTimeout(1000);

    // ===== Escenario 0: la misma cosa pero con clics REALES sobre el DOM
    // (no llamadas directas a metodos internos) -- prueba que el boton de
    // la papelera, el mensaje de confirmacion, la fila en la papelera y sus
    // botones de "Reactivar"/"Borrar definitivamente" existen y funcionan
    // de verdad en la interfaz, no solo en la logica interna.
    console.log("\n[E2E-PAPELERA] Escenario 0: flujo completo con clics reales en la UI\n");

    await win.evaluate(() => window.CUSTOMER_SELECTOR.open());
    await win.waitForTimeout(400);

    const trashBtnVisible = await win.evaluate(() => {
      const btn = document.querySelector("[data-csx-open-trash]");
      return !!btn && btn.offsetParent !== null;
    });
    if (trashBtnVisible) {
      ok("El boton de la papelera (🗑) es visible en el selector de clientes");
    } else {
      fail("El boton de la papelera (🗑) deberia ser visible en el selector de clientes");
    }

    await win.click("[data-csx-open-create]");
    await win.waitForTimeout(300);
    const uiTestName = `ZZZ-PAPELERA-UI-${Date.now()}`;
    await win.fill('[data-csx-field="nombre"]', uiTestName);
    await win.fill('[data-csx-field="razonsocial"]', uiTestName);
    await win.click("[data-csx-save-create]");
    await win.waitForTimeout(2500);

    const uiCod = await win.evaluate(
      (name) =>
        String(
          window.CUSTOMER_SELECTOR.listCustomers().find((c) => c.nombre === name)
            ?.codcliente || "",
        ),
      uiTestName,
    );
    if (!uiCod) throw new Error("No se pudo crear el cliente de prueba por UI.");
    console.log(`[INFO] Cliente de prueba (UI) creado: codcliente=${uiCod}`);

    // Recien creado queda seleccionado -- _canDeleteCustomer excluye siempre
    // al cliente seleccionado (misma regla de siempre), asi que no tendria
    // boton ✖ hasta que se seleccione otro.
    await win.evaluate(() => {
      const other = window.CUSTOMER_SELECTOR.listCustomers().find(
        (c) => String(c.codcliente) === "1",
      );
      if (other) window.CUSTOMER_SELECTOR.setSelected(other);
    });
    await win.evaluate(() => window.CUSTOMER_SELECTOR.open());
    await win.waitForTimeout(300);
    await win.fill(".csx-search", uiTestName);
    await win.waitForTimeout(300);

    await win.click(`[data-csx-del="${uiCod}"]`);
    await win.waitForTimeout(400);
    const confirmModalText =
      (await win
        .evaluate(() => document.querySelector("#msgOverlay")?.textContent || "")
        .catch(() => "")) || "";
    if (confirmModalText.includes("papelera")) {
      ok("El modal de confirmacion real (clic en ✖) menciona la papelera");
    } else {
      fail(`El modal de confirmacion deberia mencionar la papelera: ${confirmModalText.slice(0, 200)}`);
    }
    await win.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("#msgOverlay button"));
      const accept = buttons.find((b) => /borrar|s[ií]|aceptar|ok/i.test(b.textContent || ""));
      (accept || buttons[buttons.length - 1])?.click();
    });
    await win.waitForTimeout(800);

    const rowGoneAfterUiHide = await win.evaluate(
      (cod) => !document.querySelector(`.csx-row[data-cod="${cod}"]`),
      uiCod,
    );
    if (rowGoneAfterUiHide) {
      ok("La fila desaparece de la lista tras ocultarla con un clic real");
    } else {
      fail("La fila deberia desaparecer de la lista tras ocultarla con un clic real");
    }

    await win.click("[data-csx-open-trash]");
    await win.waitForTimeout(600);
    const trashRowVisible = await win.evaluate(
      (cod) => !!document.querySelector(`.csx-trash-row[data-cod="${cod}"]`),
      uiCod,
    );
    if (trashRowVisible) {
      ok("La fila aparece en la papelera con su nombre real, abierta con un clic real");
    } else {
      fail("La fila deberia aparecer en la papelera al abrirla con un clic real");
    }

    await win.click(`[data-csx-reactivar="${uiCod}"]`);
    await win.waitForTimeout(800);
    const trashRowGoneAfterReactivate = await win.evaluate(
      (cod) => !document.querySelector(`.csx-trash-row[data-cod="${cod}"]`),
      uiCod,
    );
    if (trashRowGoneAfterReactivate) {
      ok("El boton 'Reactivar' (clic real) quita la fila de la papelera");
    } else {
      fail("El boton 'Reactivar' deberia quitar la fila de la papelera");
    }

    await win.evaluate(() => window.CUSTOMER_SELECTOR.open());
    await win.waitForTimeout(300);
    const backInListAfterReactivate = await win.evaluate(
      (cod) =>
        window.CUSTOMER_SELECTOR.listCustomers().some(
          (c) => String(c.codcliente) === cod,
        ),
      uiCod,
    );
    if (backInListAfterReactivate) {
      ok("El cliente vuelve a aparecer en el selector tras reactivarlo con un clic real");
    } else {
      fail("El cliente deberia reaparecer en el selector tras reactivarlo con un clic real");
    }

    // Ocultarlo de nuevo y borrarlo definitivamente desde la papelera, todo
    // con clics reales.
    await win.fill(".csx-search", uiTestName);
    await win.waitForTimeout(300);
    await win.click(`[data-csx-del="${uiCod}"]`);
    await win.waitForTimeout(400);
    await win.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("#msgOverlay button"));
      const accept = buttons.find((b) => /borrar|s[ií]|aceptar|ok/i.test(b.textContent || ""));
      (accept || buttons[buttons.length - 1])?.click();
    });
    await win.waitForTimeout(800);

    await win.click("[data-csx-open-trash]");
    await win.waitForTimeout(600);
    await win.click(`[data-csx-borrar-def="${uiCod}"]`);
    await win.waitForTimeout(400);
    await win.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("#msgOverlay button"));
      const accept = buttons.find((b) =>
        /borrar|s[ií]|aceptar|ok|continuar/i.test(b.textContent || ""),
      );
      (accept || buttons[buttons.length - 1])?.click();
    });
    await win.waitForTimeout(1500);

    const uiDeletedForGood = await win.evaluate(async (cod) => {
      const cfg = window.CUSTOMER_SELECTOR._cfg;
      const res = await fetch(`${cfg.baseUrl}/clientes/${cod}`, {
        headers: { Accept: "application/json", Token: cfg.apiKey },
      });
      return res.status === 404;
    }, uiCod);
    if (uiDeletedForGood) {
      ok("'Borrar definitivamente' (clic real) borra de verdad al cliente sin facturas de FacturaScripts");
    } else {
      fail("'Borrar definitivamente' deberia haber borrado de verdad al cliente sin facturas");
    }

    await win.evaluate(() => window.CUSTOMER_SELECTOR.close());

    // ===== Escenario 1: crear un cliente desechable, ocultarlo, ver que
    // desaparece del selector, verlo en la papelera, reactivarlo, y
    // borrarlo definitivamente de verdad (sin facturas, deberia funcionar).
    console.log("\n[E2E-PAPELERA] Escenario 1: ocultar/reactivar/borrar definitivo (cliente sin facturas)\n");

    const testName = `ZZZ-PAPELERA-${Date.now()}`;
    const createdCod = await win.evaluate(async (name) => {
      const payload = window.CUSTOMER_SELECTOR._buildCreatePayload({
        nombre: name,
        razonsocial: name,
      });
      const created = await window.CUSTOMER_SELECTOR._postForm("clientes", payload);
      // La respuesta real de FacturaScripts anida el registro creado en
      // ".data" (p.ej. {ok:"...", data:{codcliente:"31", ...}}), no en la
      // raiz -- confirmado con una llamada real.
      return String(created?.data?.codcliente || created?.codcliente || "");
    }, testName);

    if (!createdCod) throw new Error("No se pudo crear el cliente de prueba.");
    console.log(`[INFO] Cliente de prueba creado: codcliente=${createdCod}`);

    await win.evaluate(async () => {
      await window.CUSTOMER_SELECTOR._refreshCustomers();
    });

    const visibleBeforeHide = await win.evaluate(
      (cod) =>
        window.CUSTOMER_SELECTOR.listCustomers().some(
          (c) => String(c.codcliente) === cod,
        ),
      createdCod,
    );
    if (visibleBeforeHide) {
      ok("El cliente de prueba aparece en el selector antes de ocultarlo");
    } else {
      fail("El cliente de prueba deberia aparecer en el selector antes de ocultarlo");
    }

    await win.evaluate(
      (cod) => window.CUSTOMER_SELECTOR._hideCustomerByCode(cod),
      createdCod,
    );
    // _hideCustomerByCode por si sola no actualiza _hiddenEntries en memoria
    // (eso lo hace el propio manejador del boton ✖ en la UI real, como
    // optimizacion) -- llamando al metodo directamente, como aqui, hay que
    // recargar la papelera antes de refrescar para ver el efecto.
    await win.evaluate(async () => {
      await window.CUSTOMER_SELECTOR._loadHiddenCustomers();
      await window.CUSTOMER_SELECTOR._refreshCustomers();
    });

    const visibleAfterHide = await win.evaluate(
      (cod) =>
        window.CUSTOMER_SELECTOR.listCustomers().some(
          (c) => String(c.codcliente) === cod,
        ),
      createdCod,
    );
    if (!visibleAfterHide) {
      ok("El cliente desaparece del selector tras ocultarlo (papelera)");
    } else {
      fail("El cliente NO deberia aparecer en el selector tras ocultarlo");
    }

    await win.evaluate(async () => {
      await window.CUSTOMER_SELECTOR._loadHiddenCustomers();
    });
    const inTrash = await win.evaluate(
      (cod) =>
        (window.CUSTOMER_SELECTOR._hiddenEntries || []).some(
          (e) => e.codcliente === cod,
        ),
      createdCod,
    );
    if (inTrash) {
      ok("El cliente aparece en la papelera (list-hidden-customers)");
    } else {
      fail("El cliente deberia aparecer en la papelera");
    }

    await win.evaluate(
      (cod) => window.CUSTOMER_SELECTOR._unhideCustomerByCode(cod),
      createdCod,
    );
    await win.evaluate(async () => {
      await window.CUSTOMER_SELECTOR._loadHiddenCustomers();
      await window.CUSTOMER_SELECTOR._refreshCustomers();
    });

    const visibleAfterUnhide = await win.evaluate(
      (cod) =>
        window.CUSTOMER_SELECTOR.listCustomers().some(
          (c) => String(c.codcliente) === cod,
        ),
      createdCod,
    );
    if (visibleAfterUnhide) {
      ok("El cliente reaparece en el selector tras reactivarlo");
    } else {
      fail("El cliente deberia reaparecer en el selector tras reactivarlo");
    }

    // Borrado definitivo real (sin facturas -> deberia funcionar de verdad).
    await win.evaluate(
      (cod) => window.CUSTOMER_SELECTOR._deleteCustomerByCode(cod),
      createdCod,
    );
    const stillExistsAfterDelete = await win.evaluate(async (cod) => {
      const cfg = window.CUSTOMER_SELECTOR._cfg;
      const res = await fetch(`${cfg.baseUrl}/clientes/${cod}`, {
        headers: { Accept: "application/json", Token: cfg.apiKey },
      });
      return res.status !== 404;
    }, createdCod);

    if (!stillExistsAfterDelete) {
      ok("El cliente de prueba (sin facturas) se ha borrado de verdad de FacturaScripts");
    } else {
      fail("El cliente de prueba deberia haberse borrado de verdad de FacturaScripts");
    }

    // ===== Escenario 2: cliente CON facturas -- ocultar, intentar borrado
    // definitivo (debe fallar), confirmar "dar de baja" como fallback.
    console.log("\n[E2E-PAPELERA] Escenario 2: fallback a 'dar de baja' cuando el cliente tiene facturas\n");

    const BAJA_TEST_COD = "9"; // CHARLOTTE BOE (GO4IT EVENTS) -- tiene facturas reales en demo, no es el cliente por defecto.

    await win.evaluate(
      (cod) => window.CUSTOMER_SELECTOR._hideCustomerByCode(cod),
      BAJA_TEST_COD,
    );

    let deleteBlocked = false;
    try {
      await win.evaluate(
        (cod) => window.CUSTOMER_SELECTOR._deleteCustomerByCode(cod),
        BAJA_TEST_COD,
      );
    } catch {
      deleteBlocked = true;
    }
    if (deleteBlocked) {
      ok("FacturaScripts rechaza el borrado definitivo de un cliente con facturas");
    } else {
      fail("El borrado definitivo de un cliente con facturas deberia haber fallado");
    }

    await win.evaluate(
      (cod) => window.CUSTOMER_SELECTOR._daBajaCustomer(cod),
      BAJA_TEST_COD,
    );

    const bajaState = await win.evaluate(async (cod) => {
      const cfg = window.CUSTOMER_SELECTOR._cfg;
      const res = await fetch(`${cfg.baseUrl}/clientes/${cod}`, {
        headers: { Accept: "application/json", Token: cfg.apiKey },
      });
      const data = await res.json().catch(() => null);
      return { debaja: data?.debaja, fechabaja: data?.fechabaja };
    }, BAJA_TEST_COD);

    if (bajaState?.debaja && bajaState?.fechabaja) {
      ok(`El fallback 'dar de baja' funciona: debaja=${bajaState.debaja} fechabaja=${bajaState.fechabaja}`);
    } else {
      fail(`El cliente deberia quedar 'de baja' en FacturaScripts tras el fallback: ${JSON.stringify(bajaState)}`);
    }

    workDone = true;
    if (failed) {
      console.error("\n[E2E-PAPELERA] FAILED\n");
      process.exitCode = 1;
    } else {
      console.log("\n[E2E-PAPELERA] All checks passed.\n");
    }
  } catch (err) {
    console.error("[E2E-PAPELERA][FAIL]", err?.message || err);
    process.exitCode = 1;
    workDone = true;
  } finally {
    // OJO (ver feedback_playwright_electron_close_hangs): nunca limpiar el
    // hardTimeout antes de close().
    try {
      await electronApp.close();
    } catch {}
    process.exit(process.exitCode || 0);
  }
})();
