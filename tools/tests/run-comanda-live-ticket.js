// Confirmar una comanda cuando el pedido de la lista ya fue sustituido (commitComandaPrintedState). TPV real en perfil aislado y SIN
// red. Real (prueba conjunta con la app de camareros, 2026-11-18): durante la espera de la impresora la sincronizacion con el
// servidor sustituye el objeto del pedido en la lista; la confirmacion (seq + sellos sentAt) se aplicaba al objeto viejo, la copia
// viva quedaba atrasada y su siguiente guardado entero pisaba en el servidor el seq y el sello de las lineas ya impresas.
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
  const userData = path.join(os.tmpdir(), `tpvrecipok-livecomanda-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 90000);
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof commitComandaPrintedState === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await sleep(2500);

    const mk = `
      const prods = (products || []).filter((p) => !p.variants && Number(p.price) > 0).slice(0, 3);
      if (prods.length < 2) return { error: "sin productos de prueba" };
      const mkLine = (p, i) => ({ ...buildCartLine(p, 1), _lineId: "Lprueba" + i, sentBatchAt: new Date().toISOString() });
      const base = () => ({ id: 987654, slug: "demo", mesaUid: "tut-room-1::m9", name: "Prueba comanda viva", paid: false, items: prods.slice(0, 2).map(mkLine), comandaState: undefined, total: 2 });
    `;

    // 1) el caso del fallo: la lista tiene OTRO objeto (version adoptada del servidor) distinto del que se confirma
    let r = await win.evaluate(async (mk) => {
      const f = new Function("return (async () => {" + mk + `
        const stale = base();                       // referencia que alguien capturo antes de esperar a la impresora
        const live = base();                        // la que la sincronizacion puso despues en la lista
        parkedTickets = [live];
        commitComandaPrintedState(stale, stale.items);
        return { mismo: stale === live,
          liveSeq: live.comandaState && live.comandaState.seq, staleSeq: stale.comandaState && stale.comandaState.seq,
          liveSellos: live.items.map((l) => !!l.sentAt), staleSellos: stale.items.map((l) => !!l.sentAt),
          liveImpresas: Object.keys((live.comandaState && live.comandaState.printedQtyByLineKey) || {}).length };
      })()`);
      return await f();
    }, mk);
    check("Pedido sustituido durante la impresion: la copia VIVA recibe el estado de comanda (seq 1)", r.liveSeq === 1 && r.staleSeq === 1, JSON.stringify(r));
    check("... y recibe el sello sentAt de todas las lineas impresas (antes se perdia)", r.liveSellos && r.liveSellos.length === 2 && r.liveSellos.every(Boolean), JSON.stringify(r.liveSellos));
    check("... y conoce las lineas impresas (printedQtyByLineKey)", r.liveImpresas === 2, String(r.liveImpresas));

    // 2) la copia viva ya tiene un estado MAS NUEVO (otro TPV confirmo antes): no se hace retroceder
    r = await win.evaluate(async (mk) => {
      const f = new Function("return (async () => {" + mk + `
        const stale = base();
        const live = base(); live.comandaState = { seq: 5, printedQtyByLineKey: { "k": 1 }, lastPrintedAt: new Date().toISOString() };
        parkedTickets = [live];
        commitComandaPrintedState(stale, stale.items);
        return { liveSeq: live.comandaState.seq, claves: Object.keys(live.comandaState.printedQtyByLineKey) };
      })()`);
      return await f();
    }, mk);
    check("Si la copia viva ya tiene un estado MAS NUEVO (seq 5), la confirmacion vieja no la hace retroceder", r.liveSeq === 5 && r.claves.length === 1 && r.claves[0] === "k", JSON.stringify(r));

    // 3) el caso normal (mismo objeto) no cambia
    r = await win.evaluate(async (mk) => {
      const f = new Function("return (async () => {" + mk + `
        const t = base(); parkedTickets = [t];
        commitComandaPrintedState(t, t.items);
        return { seq: t.comandaState.seq, sellos: t.items.map((l) => !!l.sentAt), sentPart: t.items[0].sentPart };
      })()`);
      return await f();
    }, mk);
    check("Caso normal (mismo objeto en la lista): seq 1, lineas selladas y numero de comanda 1", r.seq === 1 && r.sellos.every(Boolean) && r.sentPart === 1, JSON.stringify(r));

    // 4) un pedido que ya no esta en la lista no rompe nada
    r = await win.evaluate(async (mk) => {
      const f = new Function("return (async () => {" + mk + `
        const t = base(); parkedTickets = [];
        commitComandaPrintedState(t, t.items);
        return { seq: t.comandaState.seq };
      })()`);
      return await f();
    }, mk);
    check("Un pedido que ya no esta en la lista se confirma igual, sin error", r.seq === 1, JSON.stringify(r));
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
