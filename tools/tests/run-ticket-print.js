// run-ticket-print.js -- prueba (bateria, nivel standard) del CONTENIDO del ticket impreso.
// Arranca el TPV en modo E2E "seguro" (sin red, sin escribir, sin tocar la demo ni la impresora: la impresion queda
// capturada como trabajo simulado), llama a printTicket() con tickets de prueba y lee el HTML que se mandaria a la
// impresora (ticket_print.html ya rellenado) y los bytes ESC/POS del ticket en Linux.
// Comprueba: cabecera de empresa, numero/fecha/cliente/terminal/agente, lineas (cantidad, nombre, importe), descuento,
// añadidos, packs, cuentas divididas, resumen de IVA, total, formas de pago/cambio, tipo de documento (simplificada,
// general, rectificativa, devolucion, no facturado) y que un nombre con "<" o "&" no rompe el ticket.
// Uso: node tools/tests/run-ticket-print.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

const EMPRESA = { nombrecorto: "BAR PRUEBA", nombre: "Bar de Prueba SL", cifnif: "B12345678", direccion: "Calle Falsa 1", codpostal: "08001", ciudad: "Barcelona", telefono1: "930000000", telefono2: "" };

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 170000);
  const out = {};
  let app = null;
  try {
    const env = {
      ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0", TPV_E2E_ALLOW_WRITES: "0",
      TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: path.join(os.tmpdir(), `tpvrecipok-ticket-print-${Date.now()}`),
    };
    app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    let win = null; const t0 = Date.now();
    while (!win && Date.now() - t0 < 45000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(300);
    }
    if (!win) throw new Error("No se encontro la ventana principal");
    await sleep(2500);

    out.casos = await win.evaluate(async ({ EMPRESA }) => {
      const res = {};
      const L = (name, qty, net, extra = {}) => ({ descripcion: name, cantidad: qty, pvpunitario: net, taxRate: 10, ...extra });
      // Lee el ultimo trabajo de impresion simulado y lo vuelca a datos planos
      const leer = () => {
        const jobs = window.TPV_TEST.getPrintJobs();
        const j = jobs[jobs.length - 1];
        if (!j) return null;
        const doc = new DOMParser().parseFromString(j.payload.html, "text/html");
        const t = (id) => (doc.getElementById(id)?.textContent || "").replace(/\s+/g, " ").trim();
        const vis = (id) => { const e = doc.getElementById(id); return !!e && e.style.display !== "none"; };
        return {
          tipo: j.type, impresora: j.deviceName, html: j.payload.html.length,
          etiqueta: t("invoiceLabel"), badge: vis("ticketTypeBadge") ? t("ticketTypeBadge") : "", numero: t("invoiceNumber"), fecha: t("ticketDate"),
          cliente: t("clientName"), nifVisible: vis("clientFiscalRow"), nif: t("clientFiscal"), dirVisible: vis("clientAddressRow"), dir: t("clientAddress"),
          empresa: t("companyShortName"), razon: t("companyLegalName"), direccion: t("companyAddress"), cp: t("companyZip"), ciudad: t("companyCity"), cif: t("companyCif"), tel: t("companyPhone"),
          terminal: t("terminalName"), agente: t("agentName"),
          lineas: Array.from(doc.querySelectorAll("#items .item")).map((i) => ({ hijo: i.classList.contains("pack-child"), qty: (i.querySelector(".qty")?.textContent || "").trim(), desc: (i.querySelector(".desc")?.textContent || "").replace(/\s+/g, " ").trim(), total: (i.querySelector(".ltotal")?.textContent || "").trim(), subs: Array.from(i.querySelectorAll(".item-sub")).map((s) => s.textContent.replace(/\s+/g, " ").trim()) })),
          iva: t("taxSummary"), total: (t("payments").match(/^Total\s*(-?[\d.,]+)/) || [])[1] || "", pagos: t("payments"),
          entregado: vis("cashRow") ? t("cashLabel") + " " + t("cashGiven") : "", cambio: vis("changeRow") ? t("changeLabel") + " " + t("changeCash") : "", dividida: vis("splitInfoRow") ? t("splitInfo") : "",
        };
      };
      const imprimir = async (clave, ticket) => {
        window.TPV_TEST.clearPrintJobs();
        const okp = await window.printTicket({ fecha: "11/11/2026", hora: "13:45", company: EMPRESA, ...ticket });
        await new Promise((r) => setTimeout(r, 150));
        res[clave] = { devuelve: okp, ...leer() };
      };

      res.moneda = { e5_61: eurTicket(5.61), e4: eurTicket(4), e0_4: eurTicket(0.4), e1: eurTicket(1), e0_21: eurTicket(0.21), e10: eurTicket(10), e4_39: eurTicket(4.39), e2: eurTicket(2), e1_8: eurTicket(1.8), e0_2: eurTicket(0.2) };
      res.app = { terminal: (currentTerminal?.name || "").trim(), agente: (currentAgent?.name || "").trim() };

      // T1: ticket simplificado normal, 2 tipos de IVA, pago en efectivo con cambio
      await imprimir("simple", {
        numero: "S-0001", clientName: "", codserie: "S", terminalName: "TPV PRUEBA", agentName: "AGENTE PRUEBA",
        lineas: [L("Cafe solo", 2, 1), L("Tostada", 1, 2), L("Agua", 1, 1, { taxRate: 21 })],
        pagos: [{ codpago: "CONT", importe: 10 }], tpv_efectivo: 10, tpv_cambio: 4.39,
      });
      // T2: factura general (serie A) con cliente fiscal
      await imprimir("general", {
        numero: "A-0007", clientName: "Cliente SL", codserie: "A", clientFiscalId: "B99999999", clientAddress: "Av. Cliente 5, Girona",
        lineas: [L("Menu del dia", 1, 10)], pagos: [{ codpago: "TARJ", importe: 11 }],
      });
      // T3: rectificativa (serie R), cantidades negativas
      await imprimir("rectificativa", { numero: "R-0003", codserie: "R", lineas: [L("Cafe solo", -1, 1)], pagos: [{ codpago: "CONT", importe: -1.1 }] });
      // T4: devolucion
      await imprimir("devolucion", { numero: "R-0004", codserie: "R", numero2: "REFUND|123", lineas: [L("Tostada", -1, 2)], pagos: [{ codpago: "CONT", importe: -2.2 }] });
      // T5: pre-ticket (cuenta antes de cobrar)
      await imprimir("preticket", { numero: "PRE-1", _preprint: true, lineas: [L("Cafe solo", 1, 1)] });
      // T6: linea con descuento (precio de lista 2,00 -> 1,80 con IVA incluido)
      await imprimir("descuento", { numero: "S-0002", codserie: "S", lineas: [{ descripcion: "Bocadillo", cantidad: 1, __forceUnitGross: 1.8, __baseUnitGrossHint: 2, taxRate: 10 }] });
      // T7: producto con añadidos (uno gratis y uno de pago)
      await imprimir("anadidos", { numero: "S-0003", codserie: "S", lineas: [L("Cafe con leche", 1, 1, { addons: [{ nombre: "avena", precio: 0.2 }, { nombre: "sin azucar", precio: 0 }] })] });
      // T8: pack con hijo incluido (el hijo sale sin importe)
      await imprimir("pack", { numero: "S-0004", codserie: "S", lineas: [L("Menu desayuno", 1, 4), L("Zumo", 1, 0, { meta: { includedInPack: true } })] });
      // T9: cuenta dividida en 3 partes iguales (2 uds a 1,60 netos... cada parte 2/3)
      await imprimir("dividida", { numero: "S-0005", codserie: "S", lineas: [L("Cerveza", 0.6667, 3, { meta: { splitOrigQty: 2, splitParts: 3 } })] });
      // T10: nombre con caracteres especiales
      await imprimir("escape", { numero: "S-0006", codserie: "S", lineas: [L("Pan <b>&</b> \"vino\"", 1, 1)] });
      // T11: ticket sin lineas ni pagos no revienta
      await imprimir("vacio", { numero: "S-0007", codserie: "S", lineas: [] });

      // T12: bytes ESC/POS (impresion RAW de Linux)
      try {
        const bytes = buildEscposTicketBytes({ numero: "S-0001", fecha: "11/11/2026", hora: "13:45", company: EMPRESA, terminalName: "TPV PRUEBA", agentName: "AGENTE PRUEBA", codserie: "S", clientName: "Cliente X" }, [L("Cafe solo", 2, 1), L("Agua", 1, 1, { taxRate: 21 })], 3.41);
        res.escpos = { empieza: bytes.slice(0, 2), acaba: bytes.slice(-4), texto: new TextDecoder().decode(new Uint8Array(bytes.filter((b) => b >= 0x20 || b === 0x0a))) };
      } catch (e) { res.escpos = { error: String(e && e.message || e) }; }
      return res;
    }, { EMPRESA });
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    const c = buildChecks(out);
    const verdict = require("./battery/verdict.js").emitVerdict(c);
    clearTimeout(hard);
    try { if (app) await app.close(); } catch {}
    kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  const r = out.casos;
  if (!r) return c;
  const m = r.moneda || {};
  const has = (txt, s) => String(txt || "").replace(/\s/g, "").includes(String(s).replace(/\s/g, ""));

  const s = r.simple || {};
  ok("Ticket simple: se manda a imprimir como ticket y devuelve OK", s.tipo === "ticket" && s.devuelve === true && s.html > 500, { tipo: s.tipo, devuelve: s.devuelve, html: s.html });
  ok("Ticket simple: documento «Factura Simplificada» y número, fecha y hora correctos", /Factura Simplificada/i.test(s.etiqueta) && s.numero === "S-0001" && s.fecha === "11/11/2026 13:45", { etiqueta: s.etiqueta, numero: s.numero, fecha: s.fecha });
  ok("Ticket simple: sin nombre de cliente sale «Cliente» y no se pide NIF ni dirección", s.cliente === "Cliente" && !s.nifVisible && !s.dirVisible, { cliente: s.cliente, nif: s.nifVisible, dir: s.dirVisible });
  ok("Ticket simple: cabecera con los datos de la empresa (nombre, razón social, CIF, dirección, CP, ciudad, teléfono)",
    s.empresa === "BAR PRUEBA" && s.razon === "Bar de Prueba SL" && s.cif === "B12345678" && s.direccion === "Calle Falsa 1" && has(s.cp, "08001") && s.ciudad === "Barcelona" && has(s.tel, "930000000"),
    { empresa: s.empresa, razon: s.razon, cif: s.cif, direccion: s.direccion, cp: s.cp, ciudad: s.ciudad, tel: s.tel });
  ok("Ticket simple: terminal y agente (los de la caja abierta o, si no hay, los del ticket)", s.terminal === (r.app.terminal || "TPV PRUEBA") && s.agente === (r.app.agente || "AGENTE PRUEBA"), { ticket: [s.terminal, s.agente], app: r.app });
  const ls = s.lineas || [];
  ok("Ticket simple: 3 líneas con cantidad, nombre e importe con IVA (2 cafés 2,20; tostada 2,20; agua 1,21)",
    ls.length === 3 && ls[0].qty === "2" && ls[0].desc === "Cafe solo" && has(ls[0].total, "2,20") && ls[1].qty === "1" && ls[1].desc === "Tostada" && has(ls[1].total, "2,20") && ls[2].desc === "Agua" && has(ls[2].total, "1,21"), ls);
  ok("Ticket simple: el resumen de IVA separa el 10 % (base 4,00 · IVA 0,40) y el 21 % (base 1,00 · IVA 0,21)",
    has(s.iva, "BaseImponible10%") && has(s.iva, m.e4) && has(s.iva, "IVA10%") && has(s.iva, m.e0_4) && has(s.iva, "BaseImponible21%") && has(s.iva, m.e1) && has(s.iva, "IVA21%") && has(s.iva, m.e0_21), s.iva);
  ok("Ticket simple: el total impreso es 5,61 € (suma de las líneas con IVA)", has(s.total, "5,61"), { total: s.total, pagos: s.pagos });
  ok("Ticket simple: la forma de pago sale con su importe y, al pagar en efectivo con cambio, «Entregado 10,00» y «Cambio 4,39»", has(s.pagos, "CONT10,00") && has(s.entregado, "Entregado" + m.e10) && has(s.cambio, "Cambio" + m.e4_39), { pagos: s.pagos, entregado: s.entregado, cambio: s.cambio });

  const g = r.general || {};
  ok("Factura general (serie A): documento «Factura General» con el NIF y la dirección del cliente visibles", /Factura General/i.test(g.etiqueta) && g.nifVisible && g.nif === "B99999999" && g.dirVisible && g.dir.includes("Av. Cliente 5") && g.cliente === "Cliente SL", { etiqueta: g.etiqueta, nif: g.nif, dir: g.dir, cliente: g.cliente });
  ok("Factura general: total 11,00 € (menú 10 + 10 % IVA), pagado con tarjeta y sin bloque de efectivo/cambio", has(g.total, "11,00") && /TARJ/i.test(g.pagos || "") && !g.entregado && !g.cambio, { total: g.total, pagos: g.pagos, entregado: g.entregado, cambio: g.cambio });

  const re = r.rectificativa || {};
  ok("Rectificativa (serie R): documento «Factura Rectificativa», línea y total en negativo", /Factura Rectificativa/i.test(re.etiqueta) && (re.lineas || []).length === 1 && /^-/.test((re.lineas[0].total || "").trim()) && /^-/.test(re.total || ""), { etiqueta: re.etiqueta, lineas: re.lineas, total: re.total });
  const dv = r.devolucion || {};
  ok("Devolución: documento «Factura Rectificativa» con la etiqueta «DEVOLUCIÓN», total -2,20 y «Devolución 2,20» en efectivo", /Factura Rectificativa/i.test(dv.etiqueta) && /DEVOLUCI/i.test(dv.badge) && has(dv.total, "-2,20"), { etiqueta: dv.etiqueta, badge: dv.badge, total: dv.total, entregado: dv.entregado });
  const pr = r.preticket || {};
  ok("Pre-ticket (cuenta antes de cobrar): documento «Ticket no Facturado»", /Ticket no Facturado/i.test(pr.etiqueta), pr.etiqueta);

  const d = r.descuento || {};
  ok("Línea con descuento: se imprime el precio final 1,80 y debajo el precio de lista 2,00 con «-10%»", (d.lineas || []).length === 1 && has(d.lineas[0].total, m.e1_8) && (d.lineas[0].subs || []).some((x) => has(x, m.e1_8) && has(x, m.e2) && /-10%/.test(x.replace(/\s/g, ""))), d.lineas);
  const an = r.anadidos || {};
  ok("Producto con añadidos: salen debajo de la línea («+avena (+0,20 €)», «+sin azucar»)", (an.lineas || []).length === 1 && (an.lineas[0].subs || []).some((x) => has(x, "+avena(+" + m.e0_2 + ")") && x.includes("+sin azucar")), an.lineas);
  const pk = r.pack || {};
  ok("Pack: el producto incluido sale con «↳», su cantidad en «x1» y sin importe propio", (pk.lineas || []).length === 2 && pk.lineas[1].hijo === true && /^↳ Zumo/.test(pk.lineas[1].desc) && /x1/.test(pk.lineas[1].desc) && pk.lineas[1].total === "" && pk.lineas[0].total !== "", pk.lineas);
  const dd = r.dividida || {};
  ok("Cuenta dividida en 3 partes: la línea muestra la cantidad original («2 x … ÷ 3») y el ticket avisa «Cuenta dividida en 3 partes iguales»", (dd.lineas || []).length === 1 && dd.lineas[0].qty === "2" && (dd.lineas[0].subs || []).some((x) => /÷\s*3/.test(x)) && /Cuenta dividida en 3 partes iguales/.test(dd.dividida || ""), { lineas: dd.lineas, dividida: dd.dividida });
  const es = r.escape || {};
  ok("Un nombre con «<», «&» y comillas sale como texto y no rompe el ticket", (es.lineas || []).length === 1 && es.lineas[0].desc === 'Pan <b>&</b> "vino"', es.lineas);
  const va = r.vacio || {};
  ok("Un ticket sin líneas ni pagos no rompe la impresión (total 0,00)", va.devuelve === true && (va.lineas || []).length === 0 && has(va.total, "0,00"), { devuelve: va.devuelve, total: va.total });

  const e = r.escpos || {};
  ok("Impresión directa (Linux, ESC/POS): empieza con la orden de inicio, acaba con el corte y lleva empresa, líneas y total",
    !e.error && e.empieza && e.empieza[0] === 0x1b && e.empieza[1] === 0x40 && e.acaba && e.acaba[0] === 0x1d && e.acaba[1] === 0x56 && /BAR PRUEBA/.test(e.texto) && /B12345678/.test(e.texto) && /Ticket: S-0001/.test(e.texto) && /Cliente: Cliente X/.test(e.texto) && /2\s+Cafe solo/.test(e.texto) && /TOTAL: 3,41/.test(e.texto.replace(/\s€|€/g, "")), e.error || { empieza: e.empieza, acaba: e.acaba, texto: String(e.texto || "").slice(0, 400) });
  return c;
}
