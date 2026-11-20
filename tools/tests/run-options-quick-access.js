// Mejoras de Opciones (2026-11-19, peticion de Sergi): grupos cerrados por defecto, favoritas, historial de cambios, buscador con
// sugerencias, recordar posicion, marca «Nuevo», filtro «solo lo cambiado», ayuda y copia entre terminales. Se va ampliando paso a paso.
// TPV real en perfil aislado y SIN red; nunca toca la demo.
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
  const userData = path.join(os.tmpdir(), `tpvrecipok-optqa-${Date.now()}`);
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
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof loadOptionsAccordionState === "function" && typeof applyOptionsAccordionState === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await sleep(1500);

    // ---------------- Paso 1: grupos cerrados por defecto ----------------
    // TPV nuevo (sin nada guardado): todos los grupos cerrados
    let r = await win.evaluate(async () => {
      try { await window.TPV_CFG.set("ui.optionsAccordion", undefined); } catch {}
      try { localStorage.removeItem("tpv_opts_acc"); } catch {}
      const st = await loadOptionsAccordionState();
      await applyOptionsAccordionState(st);
      const secs = [...document.querySelectorAll("#optionsAccordion .opt-sec[data-sec]")];
      return { state: st, total: secs.length, abiertos: secs.filter((s) => s.dataset.open === "1").map((s) => s.dataset.sec) };
    });
    check("TPV nuevo: el estado por defecto no tiene ningun grupo abierto", Object.values(r.state).filter(Boolean).length === 0, JSON.stringify(r.state));
    check("TPV nuevo: al abrir Opciones TODOS los grupos salen cerrados (antes salia «Caja» abierto)", r.total >= 10 && r.abiertos.length === 0, JSON.stringify(r));

    // un terminal que ya tenia grupos abiertos guardados los conserva
    r = await win.evaluate(async () => {
      // solo apartados que cualquiera ve (los de administrador se cierran solos si no se es administrador)
      const libres = [...document.querySelectorAll("#optionsAccordion .opt-sec[data-sec]")].filter((s) => !s.hasAttribute("data-admin-only") && s.style.display !== "none").map((s) => s.dataset.sec);
      const [a, b, c] = libres;
      await saveOptionsAccordionState({ [a]: true, [b]: true, [c]: false });
      const st = await loadOptionsAccordionState();
      await applyOptionsAccordionState(st);
      const secs = [...document.querySelectorAll("#optionsAccordion .opt-sec[data-sec]")];
      return { esperados: [a, b].sort(), abiertos: secs.filter((s) => s.dataset.open === "1").map((s) => s.dataset.sec).sort() };
    });
    check("Un terminal con grupos guardados los conserva tal cual (solo cambia el valor por defecto)", r.esperados.length === 2 && JSON.stringify(r.abiertos) === JSON.stringify(r.esperados), JSON.stringify(r));

    // ---------------- Paso 2: favoritas y bloque «Acceso rapido» ----------------
    const ev = (fn, arg) => win.evaluate(fn, arg);
    await ev(async () => { try { await window.TPV_CFG.set("ui.optionsFavorites", []); } catch {} try { localStorage.removeItem("tpv_opts_fav"); } catch {} bindOptionsAccordionOnce(); /* lo hace openOptions al abrir con sesion iniciada */ document.getElementById("optionsOverlay").classList.remove("hidden"); /* con Opciones a la vista el resumen se repinta solo */ await loadOptionsFavorites(); renderOptionsPreviews(); });
    r = await ev(() => {
      const stars = [...document.querySelectorAll("#optionsAccordion .opt-fav[data-fav-id]")];
      const rows = new Set(stars.map((b) => b.closest(".opt-row")));
      const enTitulo = stars.filter((b) => b.parentElement && b.parentElement.classList.contains("opt-row-title")).length;
      const enLabel = stars.filter((b) => b.closest("label")).length;
      return { n: stars.length, filas: rows.size, enTitulo, enLabel, catalogo: optDefIndex().size, hint: !document.getElementById("optionsFavHint").classList.contains("hidden"), chips: document.querySelectorAll("#optionsFavList .opt-fav-chip").length };
    });
    check("Cada opcion del catalogo con fila tiene su estrella (una por fila, ninguna dentro de un <label>)", r.n >= 40 && r.n === r.filas && r.enLabel === 0, JSON.stringify(r));
    check("La estrella va junto al titulo de la opcion", r.enTitulo >= r.n * 0.8, JSON.stringify(r));
    check("Sin favoritas el bloque muestra la pista y ningun chip", r.hint === true && r.chips === 0, JSON.stringify(r));

    // opciones que cualquiera puede usar
    const libres = await ev(() => {
      const out = [];
      optDefIndex().forEach((info, id) => { if (info.def.kind === "toggle" && optionAccessibleForQuick(id)) out.push(id); });
      return out;
    });
    check("Hay suficientes interruptores accesibles para probar", libres.length >= 3, JSON.stringify(libres));
    const [A, B] = libres;

    r = await ev(async (id) => {
      await toggleOptionFavorite(id);
      const chip = document.querySelector(`#optionsFavList [data-fav-id="${id}"]`);
      const star = document.querySelector(`#optionsAccordion .opt-fav[data-fav-id="${id}"]`);
      return { chip: !!chip, texto: chip && chip.textContent, accion: chip && chip.dataset.favAct, estrella: star && star.classList.contains("is-fav"), titulo: star && star.title, hint: !document.getElementById("optionsFavHint").classList.contains("hidden"), guardado: await window.TPV_CFG.get("ui.optionsFavorites") };
    }, A);
    check("Al marcar una favorita aparece en el bloque, la estrella se rellena y la pista desaparece", r.chip && r.estrella && r.hint === false && /Quitar/.test(r.titulo), JSON.stringify(r));
    check("Los interruptores favoritos se cambian desde el propio bloque (accion toggle)", r.accion === "toggle", JSON.stringify(r));
    check("Se guarda en la configuracion del terminal", Array.isArray(r.guardado) && r.guardado.includes(A), JSON.stringify(r.guardado));

    // pulsar el chip cambia el interruptor real
    r = await ev(async (id) => {
      const ctl = document.getElementById(id);
      const antes = ctl.checked;
      document.querySelector(`#optionsFavList [data-fav-id="${id}"]`).click();
      await new Promise((res) => setTimeout(res, 400));
      const chip = document.querySelector(`#optionsFavList [data-fav-id="${id}"]`);
      const despues = ctl.checked;
      return { antes, despues, claseChip: chip && chip.className };
    }, A);
    check("Pulsar la favorita activa/desactiva el interruptor de verdad (y el chip cambia de color)", r.antes !== r.despues && (r.despues ? /is-on/.test(r.claseChip) : /is-off/.test(r.claseChip)), JSON.stringify(r));

    // persistencia: se recarga igual
    r = await ev(async (ids) => {
      await toggleOptionFavorite(ids[1]);
      __optFavorites = [];
      const cargadas = await loadOptionsFavorites();
      return cargadas.slice();
    }, [A, B]);
    check("Al reabrir Opciones las favoritas se recuperan y en el mismo orden", JSON.stringify(r) === JSON.stringify([A, B]), JSON.stringify(r));

    // quitar con la X del bloque
    r = await ev(async (id) => {
      document.querySelector(`#optionsFavList [data-fav-remove="${id}"]`).click();
      await new Promise((res) => setTimeout(res, 300));
      return { chip: !!document.querySelector(`#optionsFavList [data-fav-id="${id}"]`), quedan: __optFavorites.slice(), guardado: await window.TPV_CFG.get("ui.optionsFavorites") };
    }, A);
    check("La X del bloque quita la favorita (y se guarda)", r.chip === false && !r.quedan.includes(A) && !r.guardado.includes(A), JSON.stringify(r));

    // una favorita de un apartado de administrador no se ve sin ser administrador
    r = await ev(async () => {
      const admin = [];
      optDefIndex().forEach((info, id) => { const sec = document.getElementById(id)?.closest(".opt-sec"); if (sec && sec.hasAttribute("data-admin-only") && info.def.kind === "toggle") admin.push(id); });
      const id = admin[0];
      const eraAdmin = !!window.TPV_STATE.isAdmin;
      window.TPV_STATE.isAdmin = false;
      __optFavorites = [id];
      renderOptionsQuickAccess();
      const sinAdmin = { accesible: optionAccessibleForQuick(id), chip: !!document.querySelector(`#optionsFavList [data-fav-id="${id}"]`), pista: !document.getElementById("optionsFavHint").classList.contains("hidden") };
      window.TPV_STATE.isAdmin = eraAdmin;
      return { id, sinAdmin };
    });
    check("Una favorita de un apartado de administrador NO se muestra ni se puede usar sin ser administrador", r.id && r.sinAdmin.accesible === false && r.sinAdmin.chip === false && r.sinAdmin.pista === true, JSON.stringify(r));

    // opciones que no son interruptores: te llevan a la fila
    r = await ev(async () => {
      let sel = null;
      optDefIndex().forEach((info, id) => { if (!sel && (info.def.kind === "value") && optionAccessibleForQuick(id)) sel = id; });
      if (!sel) return { sinValor: true };
      __optFavorites = [sel];
      renderOptionsQuickAccess();
      const chip = document.querySelector(`#optionsFavList [data-fav-id="${sel}"]`);
      return { id: sel, accion: chip && chip.dataset.favAct };
    });
    check("Las opciones que no son interruptores (valores, listas, botones) se abren con «jump»: te llevan a su fila", r.sinValor || r.accion === "jump", JSON.stringify(r));

    // maximo
    r = await ev(async () => {
      __optFavorites = [];
      const ids = [...optDefIndex().keys()];
      for (const id of ids.slice(0, 12)) await toggleOptionFavorite(id);
      const en12 = __optFavorites.length;
      await toggleOptionFavorite(ids[12]);
      return { en12, trasMax: __optFavorites.length };
    });
    check("Hay un maximo de 12 favoritas (la 13 se rechaza con aviso)", r.en12 === 12 && r.trasMax === 12, JSON.stringify(r));

    // el bloque se oculta mientras se busca
    r = await ev(async () => {
      __optFavorites = [];
      renderOptionsQuickAccess();
      const input = document.getElementById("optionsSearchInput");
      const visibleAntes = getComputedStyle(document.getElementById("optionsQuick")).display !== "none";
      input.value = "cajon";
      applyOptionsSearch();
      const visibleBuscando = getComputedStyle(document.getElementById("optionsQuick")).display !== "none";
      const estrellasEnResultados = document.querySelectorAll("#optionsAccordion .opt-sec:not(.opt-search-hide) .opt-row:not(.opt-search-hide) .opt-fav").length;
      input.value = "";
      applyOptionsSearch();
      const visibleDespues = getComputedStyle(document.getElementById("optionsQuick")).display !== "none";
      return { visibleAntes, visibleBuscando, visibleDespues, estrellasEnResultados };
    });
    check("Mientras se busca el bloque se oculta (los resultados mandan) y vuelve al borrar la busqueda", r.visibleAntes && !r.visibleBuscando && r.visibleDespues, JSON.stringify(r));
    check("En los resultados de la busqueda se puede marcar una favorita desde su estrella", r.estrellasEnResultados >= 1, JSON.stringify(r));

    // ---------------- Paso 3: historial «Ultimos cambios» ----------------
    await ev(async () => {
      try { await window.TPV_CFG.set("ui.optionsHistory", []); } catch {}
      try { localStorage.removeItem("tpv_opts_hist"); } catch {}
      __optHistory = [];
      optHistOpen = false;
      await loadOptionsHistory();
      renderOptionsQuickAccess();
      // una «sesion» de Opciones: foto inicial -> cambios -> cerrar (como hace el TPV al abrir y cerrar Opciones)
      window.__sesion = async (fn) => {
        document.getElementById("optionsOverlay").classList.remove("hidden");
        markOptionsAuditBaseline();
        fn();
        closeOptions();
        await new Promise((res) => setTimeout(res, 120));
      };
      window.__flip = (id) => { const c = document.getElementById(id); c.checked = !c.checked; return c.checked; };
    });
    const tg3 = await ev(() => { const out = []; optDefIndex().forEach((info, id) => { if (info.def.kind === "toggle" && optionAccessibleForQuick(id)) out.push(id); }); return out; });
    const [T1, T2, T3] = tg3;
    check("Hay interruptores accesibles para probar el historial", tg3.length >= 3, JSON.stringify(tg3));

    r = await ev(async (id) => {
      await window.__sesion(() => { window.__flip(id); window.__flip(id); }); // activar y volver a desactivar: sin cambio neto
      return { n: __optHistory.length, oculto: document.getElementById("optionsHistWrap").classList.contains("hidden") };
    }, T1);
    check("Activar y volver a desactivar una opcion NO deja rastro (solo cuentan los cambios netos)", r.n === 0 && r.oculto === true, JSON.stringify(r));

    r = await ev(async (id) => {
      const antes = document.getElementById(id).checked;
      await window.__sesion(() => { window.__flip(id); });
      const h = __optHistory[0];
      return { n: __optHistory.length, id: h && h.id, v: h && h.v, esperado: antes ? "off" : "on", visible: !document.getElementById("optionsHistWrap").classList.contains("hidden"), cuenta: document.getElementById("optionsHistCount").textContent, plegado: document.getElementById("optionsHistList").classList.contains("hidden"), claves: Object.keys(h || {}).sort().join(",") };
    }, T1);
    check("Un cambio real queda en el historial (opcion, hora y si quedo activada o desactivada) y aparece el bloque", r.n === 1 && r.id === T1 && r.v === r.esperado && r.visible && r.cuenta === "(1)", JSON.stringify(r));
    check("El historial arranca plegado y solo guarda id, hora y estado (nada mas)", r.plegado === true && r.claves === "at,id,v", JSON.stringify(r));

    r = await ev(async (ids) => {
      await window.__sesion(() => { window.__flip(ids[1]); });
      const orden1 = __optHistory.map((h) => h.id);
      const atA = __optHistory.find((h) => h.id === ids[0]).at;
      await new Promise((res) => setTimeout(res, 30));
      await window.__sesion(() => { window.__flip(ids[0]); });
      const orden2 = __optHistory.map((h) => h.id);
      const atA2 = __optHistory[0].at;
      return { orden1, orden2, n: __optHistory.length, actualizaHora: atA2 > atA };
    }, [T1, T2]);
    check("La ultima opcion tocada va arriba", JSON.stringify(r.orden1) === JSON.stringify([T2, T1]), JSON.stringify(r));
    check("Si se cambia otra vez una opcion que ya estaba, NO se repite: sube arriba y actualiza su hora", JSON.stringify(r.orden2) === JSON.stringify([T1, T2]) && r.n === 2 && r.actualizaHora, JSON.stringify(r));

    r = await ev(async () => {
      __optHistory = [];
      const ids = [...optDefIndex().keys()].filter((id) => id !== "scalePortSelect").slice(0, 10);
      for (const id of ids) recordOptionsHistory([{ id, label: id, before: "no", after: "sí" }]);
      return { n: __optHistory.length, primero: __optHistory[0].id === ids[9], ultimo: __optHistory[7].id === ids[2], sinLosViejos: !__optHistory.some((h) => h.id === ids[0] || h.id === ids[1]) };
    });
    check("El historial guarda como maximo 8 y descarta las mas antiguas", r.n === 8 && r.primero && r.ultimo && r.sinLosViejos, JSON.stringify(r));

    r = await ev(async () => {
      __optHistory = [];
      recordOptionsHistory([{ id: "scalePortSelect", label: "Puerto", before: "a", after: "b" }, { id: "terminalDefaultCustomerSelect", label: "Cliente por defecto", before: "Juan", after: "Ana" }, { id: "no-existe-esta-opcion", label: "x", before: "a", after: "b" }]);
      const cliente = __optHistory.find((h) => h.id === "terminalDefaultCustomerSelect");
      return { ids: __optHistory.map((h) => h.id), clienteV: cliente && cliente.v, texto: JSON.stringify(__optHistory) };
    });
    check("No se apuntan el puerto de la bascula (carga solo) ni opciones que no existen", !r.ids.includes("scalePortSelect") && !r.ids.includes("no-existe-esta-opcion"), JSON.stringify(r));
    check("El cliente por defecto aparece como «cambiada» y NUNCA con su valor (dato personal)", r.clienteV === "" && !/Juan|Ana/.test(r.texto), JSON.stringify(r));

    r = await ev(async (ids) => {
      __optHistory = [];
      recordOptionsHistory([{ id: ids[0], label: "a", before: "no", after: "sí" }]);
      recordOptionsHistory([{ id: ids[1], label: "b", before: "sí", after: "no" }]);
      await saveOptionsHistory();
      const guardado = await window.TPV_CFG.get("ui.optionsHistory");
      __optHistory = [];
      await loadOptionsHistory();
      return { guardado: guardado.map((h) => h.id), cargado: __optHistory.map((h) => h.id) };
    }, [T1, T2]);
    check("El historial se guarda en el terminal y se recupera igual al reabrir (mismo orden)", JSON.stringify(r.cargado) === JSON.stringify([T2, T1]) && JSON.stringify(r.guardado) === JSON.stringify([T2, T1]), JSON.stringify(r));

    r = await ev(async (ids) => {
      await window.TPV_CFG.set("ui.optionsHistory", [{ id: "opcion-que-ya-no-existe", at: 1, v: "on" }, { id: ids[0], at: Date.now(), v: "on" }, { id: ids[0], at: 5, v: "off" }]);
      __optHistory = [];
      await loadOptionsHistory();
      return __optHistory.map((h) => h.id);
    }, [T1]);
    check("Al cargar se descartan las opciones que ya no existen y los duplicados", JSON.stringify(r) === JSON.stringify([T1]), JSON.stringify(r));

    // pantalla: plegado/desplegado, contenido y pulsar una entrada
    r = await ev(async (ids) => {
      __optHistory = [];
      recordOptionsHistory([{ id: ids[0], label: "a", before: "no", after: "sí" }]);
      recordOptionsHistory([{ id: ids[1], label: "b", before: "sí", after: "no" }]);
      document.getElementById("optionsOverlay").classList.remove("hidden");
      renderOptionsQuickAccess();
      const plegado = document.getElementById("optionsHistList").classList.contains("hidden");
      document.getElementById("optionsHistToggle").click();
      const abierto = !document.getElementById("optionsHistList").classList.contains("hidden");
      const items = [...document.querySelectorAll("#optionsHistList .opt-hist-item")];
      const textos = items.map((i) => i.textContent);
      window.__jumped = null;
      const original = jumpToOption;
      jumpToOption = async (id) => { window.__jumped = id; };
      items[0].click();
      jumpToOption = original;
      document.getElementById("optionsHistToggle").click();
      const otraVezPlegado = document.getElementById("optionsHistList").classList.contains("hidden");
      return { plegado, abierto, n: items.length, primero: items[0] && items[0].dataset.histId, esperadoPrimero: ids[1], textos, saltoA: window.__jumped, otraVezPlegado };
    }, [T1, T2]);
    check("Pulsar «Ultimos cambios» despliega la lista y volver a pulsar la pliega", r.plegado && r.abierto && r.otraVezPlegado, JSON.stringify(r));
    check("La lista enseña cada opcion con su estado (activada/desactivada) y la hora, la mas reciente primero", r.n === 2 && r.primero === r.esperadoPrimero && /desactivada|activada/.test(r.textos[0]) && /(hoy|ayer|\d+\/\d+) \d\d:\d\d/.test(r.textos[0]), JSON.stringify(r));
    check("Pulsar una entrada te lleva a esa opcion", r.saltoA === r.primero, JSON.stringify(r));

    r = await ev(async () => {
      let adminId = null;
      optDefIndex().forEach((info, id) => { const sec = document.getElementById(id)?.closest(".opt-sec"); if (!adminId && sec && sec.hasAttribute("data-admin-only") && info.def.kind === "toggle") adminId = id; });
      const eraAdmin = !!window.TPV_STATE.isAdmin;
      window.TPV_STATE.isAdmin = false;
      __optHistory = [{ id: adminId, at: Date.now(), v: "on" }];
      renderOptionsHistory();
      const visible = !document.getElementById("optionsHistWrap").classList.contains("hidden");
      const guardada = __optHistory.length;
      window.TPV_STATE.isAdmin = eraAdmin;
      return { adminId, visible, guardada };
    });
    check("Una entrada de una opcion de administrador NO se muestra sin ser administrador (y se conserva guardada)", r.adminId && r.visible === false && r.guardada === 1, JSON.stringify(r));

    r = await ev(async (id) => {
      __optHistory = [];
      window.__sesion(() => { window.__flip(id); });
      await new Promise((res) => setTimeout(res, 300));
      const ring = recentClientEventsForDiag();
      return ring.filter((l) => /other\/options-changed: Opciones cambiadas: /.test(l) && /→/.test(l)).length;
    }, T3);
    check("El rastro al servidor sigue funcionando igual (el aviso «Opciones cambiadas: opcion: antes → despues» se genera)", r >= 1, String(r));

    // ---------------- Paso 4: buscador (palabras parecidas y busquedas recientes) ----------------
    r = await ev(() => ({
      monedero: optSearchTerms("monedero"), cajonTilde: optSearchTerms(normalizeOptSearch("cajón")), cajon: optSearchTerms("cajon"),
      frase: optSearchTerms("abrir cajon"), corta: optSearchTerms("ca"), parcial: optSearchTerms("impres"), rara: optSearchTerms("xyzqq"), vacia: optSearchTerms(""),
    }));
    check("Palabras parecidas: «monedero» busca tambien «cajon» (y la busqueda propia va la primera)", r.monedero[0] === "monedero" && r.monedero.includes("cajon") && r.monedero.length === 2, JSON.stringify(r.monedero));
    check("... da igual la tilde o las mayusculas («cajón» = «cajon»)", JSON.stringify(r.cajonTilde) === JSON.stringify(r.cajon) && r.cajon.includes("monedero"), JSON.stringify(r));
    check("... una frase no se amplia, ni una palabra de menos de 3 letras, ni una palabra que no esta en los grupos", r.frase.length === 1 && r.corta.length === 1 && r.rara.length === 1 && r.vacia.length === 1, JSON.stringify(r));
    check("... y al escribir el comienzo de una palabra («impres») ya se amplia a impresora, ticket...", r.parcial.includes("impresora") && r.parcial.includes("ticket"), JSON.stringify(r.parcial));

    r = await ev(async () => {
      document.getElementById("optionsOverlay").classList.remove("hidden");
      const input = document.getElementById("optionsSearchInput");
      input.value = "monedero";
      applyOptionsSearch();
      const row = document.getElementById("openDrawerAlwaysToggle").closest(".opt-row");
      const sec = row.closest(".opt-sec");
      const note = document.getElementById("optionsSearchNote");
      const res = { fila: !row.classList.contains("opt-search-hide"), seccion: !sec.classList.contains("opt-search-hide"), vacio: !document.getElementById("optionsSearchEmpty").classList.contains("hidden"), nota: note.textContent, notaVisible: !note.classList.contains("hidden") };
      input.value = "xyzqq";
      applyOptionsSearch();
      res.sinResultados = !document.getElementById("optionsSearchEmpty").classList.contains("hidden");
      res.notaTrasNada = !note.classList.contains("hidden");
      input.value = "cajon";
      applyOptionsSearch();
      res.directa = !row.classList.contains("opt-search-hide") && note.classList.contains("hidden") === false;
      input.value = "";
      applyOptionsSearch();
      res.notaAlBorrar = !note.classList.contains("hidden");
      return res;
    });
    check("Buscar «monedero» encuentra la opcion «Abrir cajón…» (antes no salia nada)", r.fila && r.seccion && !r.vacio, JSON.stringify(r));
    check("Cuando se han buscado palabras parecidas se avisa debajo del buscador («También se ha buscado: cajon…»)", r.notaVisible && /También se ha buscado: .*cajon/.test(r.nota), JSON.stringify(r));
    check("Sin resultados sale el mensaje de siempre y el aviso desaparece; al borrar la busqueda tambien", r.sinResultados && r.notaTrasNada === false && r.notaAlBorrar === false, JSON.stringify(r));

    // busquedas recientes
    await ev(async () => { try { await window.TPV_CFG.set("ui.optionsSearchHistory", []); } catch {} try { localStorage.removeItem("tpv_opts_search"); } catch {} __optSearchHistory = []; optSearchRecentOpen = false; await loadOptionsSearchHistory(); });
    r = await ev(async () => {
      recordOptionsSearch("Cajón");
      recordOptionsSearch("cajon"); // misma busqueda (tilde y mayuscula): no se repite, queda la mas reciente
      const uno = __optSearchHistory.slice();
      recordOptionsSearch("a"); // demasiado corta
      for (const t of ["impresora", "stock", "kiosco", "letra", "familias", "correo"]) recordOptionsSearch(t);
      return { uno, n: __optSearchHistory.length, lista: __optSearchHistory.slice() };
    });
    check("Una busqueda repetida (aunque cambie la tilde o la mayuscula) no se duplica: queda una con el texto mas reciente", JSON.stringify(r.uno) === JSON.stringify(["cajon"]), JSON.stringify(r.uno));
    check("Las busquedas recientes son como maximo 5, la mas nueva primera, y una de 1 letra no se apunta", r.n === 5 && r.lista[0] === "correo" && r.lista[4] === "stock" && !r.lista.includes("a") && !r.lista.includes("cajon"), JSON.stringify(r.lista));

    r = await ev(async () => {
      await saveOptionsSearchHistory();
      const guardado = await window.TPV_CFG.get("ui.optionsSearchHistory");
      const antes = __optSearchHistory.slice();
      __optSearchHistory = [];
      await loadOptionsSearchHistory();
      return { guardado, antes, cargado: __optSearchHistory.slice() };
    });
    check("Se guardan en el terminal y se recuperan igual", JSON.stringify(r.guardado) === JSON.stringify(r.antes) && JSON.stringify(r.cargado) === JSON.stringify(r.antes), JSON.stringify(r));

    r = await ev(async () => {
      const input = document.getElementById("optionsSearchInput");
      const box = document.getElementById("optionsSearchRecent");
      input.value = "";
      applyOptionsSearch();
      showOptionsSearchRecent();
      const chips = [...box.querySelectorAll(".opt-recent-chip")].map((c) => c.textContent);
      const visible = !box.classList.contains("hidden");
      input.value = "k";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const alEscribir = box.classList.contains("hidden");
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const alVaciar = !box.classList.contains("hidden");
      return { chips, visible, alEscribir, alVaciar, tieneBorrar: !!box.querySelector("[data-recent-clear]") };
    });
    check("Al pulsar el buscador vacio salen las ultimas busquedas (maximo 5) con «Borrar»", r.visible && r.chips.length === 5 && r.chips[0] === "correo" && r.tieneBorrar, JSON.stringify(r));
    check("Al escribir se esconden las sugerencias y al vaciar el cuadro vuelven", r.alEscribir && r.alVaciar, JSON.stringify(r));

    r = await ev(async () => {
      const input = document.getElementById("optionsSearchInput");
      const box = document.getElementById("optionsSearchRecent");
      showOptionsSearchRecent();
      box.querySelector('[data-recent-q="stock"]').click();
      return { valor: input.value, buscando: document.getElementById("optionsAccordion").classList.contains("opt-searching"), oculto: box.classList.contains("hidden") };
    });
    check("Pulsar una busqueda reciente la repite (rellena el buscador y filtra) y esconde las sugerencias", r.valor === "stock" && r.buscando && r.oculto, JSON.stringify(r));

    r = await ev(async () => {
      const input = document.getElementById("optionsSearchInput");
      __optSearchHistory = ["viejo"];
      input.value = "cajon";
      applyOptionsSearch();
      const antes = __optSearchHistory.slice();
      await new Promise((res) => setTimeout(res, 300)); // solo escribir NO la apunta
      const soloEscribir = __optSearchHistory.slice();
      document.getElementById("openDrawerAlwaysToggle").closest(".opt-row").querySelector(".opt-row-title").click(); // elegir un resultado
      const alElegir = __optSearchHistory.slice();
      input.value = "impresora";
      applyOptionsSearch();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const conIntro = __optSearchHistory.slice();
      input.value = "zzzqqq";
      applyOptionsSearch();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const introSinResultados = __optSearchHistory.slice();
      return { antes, soloEscribir, alElegir, conIntro, introSinResultados };
    });
    check("Escribir en el buscador NO apunta la busqueda (solo se apunta al elegir un resultado)", JSON.stringify(r.soloEscribir) === JSON.stringify(["viejo"]), JSON.stringify(r));
    check("Al pulsar algo de una fila encontrada se apunta la busqueda («cajon») arriba del todo", r.alElegir[0] === "cajon" && r.alElegir[1] === "viejo", JSON.stringify(r.alElegir));
    check("Intro con resultados apunta la busqueda; Intro sin resultados no", r.conIntro[0] === "impresora" && JSON.stringify(r.introSinResultados) === JSON.stringify(r.conIntro), JSON.stringify(r));

    r = await ev(async () => {
      const input = document.getElementById("optionsSearchInput");
      const box = document.getElementById("optionsSearchRecent");
      input.value = "";
      applyOptionsSearch();
      showOptionsSearchRecent();
      const abierto = !box.classList.contains("hidden");
      document.getElementById("optionsHistToggle").click(); // pulsar fuera del buscador
      const trasPulsarFuera = box.classList.contains("hidden");
      showOptionsSearchRecent();
      box.querySelector("[data-recent-clear]").click();
      await new Promise((res) => setTimeout(res, 200));
      return { abierto, trasPulsarFuera, vacia: __optSearchHistory.length === 0, guardada: await window.TPV_CFG.get("ui.optionsSearchHistory") };
    });
    check("Pulsar fuera del buscador cierra las sugerencias", r.abierto && r.trasPulsarFuera, JSON.stringify(r));
    check("«Borrar» vacia las busquedas recientes (tambien en lo guardado)", r.vacia && Array.isArray(r.guardada) && r.guardada.length === 0, JSON.stringify(r));

    // ---------------- Paso 5: recordar donde te quedaste ----------------
    await win.setViewportSize({ width: 1200, height: 900 }).catch(() => {});
    await sleep(300);
    r = await ev(async () => {
      document.getElementById("optionsOverlay").classList.remove("hidden");
      const all = {};
      document.querySelectorAll("#optionsAccordion .opt-sec[data-sec]").forEach((sec) => { all[sec.dataset.sec] = true; });
      await applyOptionsAccordionState(all);
      const acc = document.getElementById("optionsAccordion");
      await new Promise((res) => setTimeout(res, 200));
      const scrollable = acc.scrollHeight - acc.clientHeight;
      acc.scrollTop = 260;
      await new Promise((res) => setTimeout(res, 100));
      const puesto = acc.scrollTop;
      closeOptions();
      return { scrollable, puesto, guardado: __optLastScroll && __optLastScroll.top, oculto: document.getElementById("optionsOverlay").classList.contains("hidden") };
    });
    check("La lista de Opciones tiene recorrido suficiente para probar la posicion", r.scrollable > 400 && r.puesto >= 250, JSON.stringify(r));
    check("Al cerrar Opciones se recuerda en que punto de la lista estabas", r.oculto && r.guardado >= 250, JSON.stringify(r));

    r = await ev(async () => {
      const acc = document.getElementById("optionsAccordion");
      const esperado = __optLastScroll.top;
      document.getElementById("optionsOverlay").classList.remove("hidden"); // reabrir
      acc.scrollTop = 0;
      const devuelve = restoreOptionsScrollIfRecent();
      await new Promise((res) => setTimeout(res, 400));
      return { devuelve, esperado, actual: acc.scrollTop };
    });
    check("Al reabrir en menos de 10 minutos se vuelve al mismo punto de la lista", r.devuelve === true && Math.abs(r.actual - r.esperado) <= 3, JSON.stringify(r));

    r = await ev(async () => {
      const acc = document.getElementById("optionsAccordion");
      __optLastScroll = { top: 260, at: Date.now() - 11 * 60 * 1000 }; // hace 11 minutos
      acc.scrollTop = 0;
      const devuelve = restoreOptionsScrollIfRecent();
      await new Promise((res) => setTimeout(res, 300));
      return { devuelve, actual: acc.scrollTop, olvidada: __optLastScroll === null };
    });
    check("Pasados 10 minutos NO se recuerda: se empieza arriba como siempre", r.devuelve === false && r.actual === 0 && r.olvidada, JSON.stringify(r));

    r = await ev(async () => {
      const acc = document.getElementById("optionsAccordion");
      document.getElementById("optionsOverlay").classList.remove("hidden");
      acc.scrollTop = 3; // practicamente arriba
      closeOptions();
      return { guardado: __optLastScroll };
    });
    check("Si la lista estaba arriba del todo no se guarda nada", r.guardado === null, JSON.stringify(r));

    r = await ev(async () => {
      const acc = document.getElementById("optionsAccordion");
      document.getElementById("optionsOverlay").classList.remove("hidden");
      __optLastScroll = { top: 500, at: Date.now() };
      const input = document.getElementById("optionsSearchInput");
      input.value = "cajon";
      applyOptionsSearch();
      closeOptions(); // cerrar con una busqueda activa: la lista estaba filtrada
      return { guardado: __optLastScroll, buscadorVacio: input.value === "" };
    });
    check("Si se cierra con una busqueda activa NO se recuerda (esa posicion era de una lista filtrada) y el buscador queda vacio", r.guardado === null && r.buscadorVacio, JSON.stringify(r));

    r = await ev(async () => {
      __optLastScroll = { top: 321, at: Date.now() };
      document.getElementById("optionsOverlay").classList.add("hidden");
      rememberOptionsScroll(); // con Opciones ocultas la lista no tiene posicion: no pisa lo guardado
      return { guardado: __optLastScroll && __optLastScroll.top };
    });
    check("Con Opciones ocultas no se pisa lo ya guardado", r.guardado === 321, JSON.stringify(r));
    await ev(() => { __optLastScroll = null; });

    // ---------------- Paso 6: marca «Nuevo» ----------------
    const nuevo = (extra) => ev(async (extra) => {
      try { await window.TPV_CFG.set("ui.optionsNew", {}); localStorage.removeItem("tpv_opts_new"); } catch {}
      __optNewState = { lastVersion: "", seen: {} };
      document.getElementById("optionsOverlay").classList.remove("hidden");
      renderOptionsPreviews();
      const q = (sel, attr) => [...document.querySelectorAll(sel)].map((n) => (attr === "sec" ? n.closest(".opt-sec").dataset.sec : attr === "opt" ? n.dataset.optTarget : n.dataset.newId)).sort();
      return { cur: optCurrentVersion(), pills: q("#optionsAccordion .opt-new[data-new-id]"), secs: q("#optionsAccordion .opt-new-sec", "sec"), chips: q("#optionsAccordion .opt-pv.is-new", "opt"), seen: Object.keys(__optNewState.seen).sort(), last: __optNewState.lastVersion };
    }, extra);
    r = await nuevo();
    check("Las opciones recientes llevan la marca «Nuevo» en su fila (solo las de las ultimas versiones: no las antiguas)", JSON.stringify(r.pills) === JSON.stringify(["optionsSendDiagBtn", "splitTpvToggle", "thermalLogoToggle"]), JSON.stringify(r));
    check("... tambien en la cabecera de su grupo (los grupos arrancan cerrados: asi se sabe donde mirar) y como puntito en su etiqueta de resumen", JSON.stringify(r.secs) === JSON.stringify(["actualizacion", "carrito", "impresora"]) && JSON.stringify(r.chips) === JSON.stringify(["optionsExportBtn", "optionsImportBtn", "optionsSendDiagBtn", "splitTpvToggle", "thermalLogoToggle"]), JSON.stringify(r));
    check("Al enseñarlas por primera vez se apunta la fecha (empieza su plazo) y la version con la que se miraron las Opciones", JSON.stringify(r.seen) === JSON.stringify(["optionsExportBtn", "optionsImportBtn", "optionsSendDiagBtn", "splitTpvToggle", "thermalLogoToggle"]) && (!r.cur || r.last === r.cur), JSON.stringify(r));

    r = await ev(async () => {
      renderOptionsPreviews(); renderOptionsPreviews();
      const n = document.querySelectorAll("#optionsAccordion .opt-new[data-new-id]").length;
      const nsec = document.querySelectorAll("#optionsAccordion .opt-new-sec").length;
      await saveOptionsNewState();
      const guardado = await window.TPV_CFG.get("ui.optionsNew");
      const antes = JSON.stringify(Object.keys(__optNewState.seen).sort());
      __optNewState = { lastVersion: "", seen: {} };
      await loadOptionsNewState();
      return { n, nsec, guardadoClaves: Object.keys(guardado.seen).sort(), recargado: JSON.stringify(Object.keys(__optNewState.seen).sort()) === antes };
    });
    check("Repintar no duplica marcas (una por opcion y una por grupo)", r.n === 3 && r.nsec === 3, JSON.stringify(r));
    check("El estado se guarda en el terminal y se recupera igual", r.guardadoClaves.length === 5 && r.recargado, JSON.stringify(r));

    r = await ev(async () => {
      document.querySelector('#optionsAccordion .opt-new[data-new-id="splitTpvToggle"]').click();
      await new Promise((res) => setTimeout(res, 300));
      const pill = !!document.querySelector('#optionsAccordion .opt-new[data-new-id="splitTpvToggle"]');
      const chip = document.querySelector('#optionsAccordion .opt-pv[data-opt-target="splitTpvToggle"]');
      const secCarrito = !!document.querySelector('#optionsAccordion .opt-sec[data-sec="carrito"] .opt-new-sec');
      const guardado = await window.TPV_CFG.get("ui.optionsNew");
      return { pill, chipNuevo: chip && chip.classList.contains("is-new"), secCarrito, marca: __optNewState.seen.splitTpvToggle, guardada: guardado.seen.splitTpvToggle, otras: document.querySelectorAll("#optionsAccordion .opt-new[data-new-id]").length };
    });
    check("Pulsar «Nuevo» quita la marca de esa opcion (fila, puntito y la del grupo si ya no queda ninguna) y se guarda", r.pill === false && r.chipNuevo === false && r.secCarrito === false && r.marca === 0 && r.guardada === 0 && r.otras === 2, JSON.stringify(r));

    r = await ev(async () => {
      const dia = 86400000;
      __optNewState.seen.thermalLogoToggle = Date.now() - 15 * dia; // lleva 15 dias enseñada
      decorateOptionsNew();
      const caducada = !document.querySelector('#optionsAccordion .opt-new[data-new-id="thermalLogoToggle"]');
      __optNewState.seen.thermalLogoToggle = Date.now() - 5 * dia; // 5 dias
      decorateOptionsNew();
      const vigente = !!document.querySelector('#optionsAccordion .opt-new[data-new-id="thermalLogoToggle"]');
      return { caducada, vigente };
    });
    check("La marca dura 14 dias desde que se enseño por primera vez: a los 15 desaparece, a los 5 sigue", r.caducada && r.vigente, JSON.stringify(r));

    r = await ev(async () => {
      __optNewState.seen.thermalLogoToggle = Date.now();
      decorateOptionsNew();
      recordOptionsHistory([{ id: "thermalLogoToggle", label: "Logo", before: "sí", after: "no" }]); // el cajero la cambia
      await new Promise((res) => setTimeout(res, 200));
      return { marca: __optNewState.seen.thermalLogoToggle, pill: !!document.querySelector('#optionsAccordion .opt-new[data-new-id="thermalLogoToggle"]') };
    });
    check("Cambiar la opcion tambien quita la marca (ya la ha visto y tocado)", r.marca === 0 && r.pill === false, JSON.stringify(r));

    r = await ev(async () => {
      __optNewState = { lastVersion: "", seen: {} };
      document.getElementById("optionsOverlay").classList.add("hidden");
      renderOptionsPreviews();
      const sinFecha = Object.keys(__optNewState.seen).length === 0;
      document.getElementById("optionsOverlay").classList.remove("hidden");
      return { sinFecha };
    });
    check("Con Opciones cerradas no se empieza a contar el plazo (solo cuando se enseñan)", r.sinFecha === true, JSON.stringify(r));

    r = await ev(async () => {
      const eraAdmin = !!window.TPV_STATE.isAdmin;
      window.TPV_STATE.isAdmin = false;
      OPT_SINCE.priceEditModeToggle = "0.2.69"; // opcion de un grupo de administrador
      OPT_SINCE.groupLinesToggle = "0.2.50";    // mas antigua que la base
      OPT_SINCE.autoPrintToggle = "0.2.66";     // reciente
      __optNewState = { lastVersion: "", seen: {} };
      renderOptionsPreviews();
      const res = {
        admin: !!document.querySelector('#optionsAccordion .opt-new[data-new-id="priceEditModeToggle"]'),
        antigua: !!document.querySelector('#optionsAccordion .opt-new[data-new-id="groupLinesToggle"]'),
        reciente: !!document.querySelector('#optionsAccordion .opt-new[data-new-id="autoPrintToggle"]'),
      };
      delete OPT_SINCE.priceEditModeToggle; delete OPT_SINCE.groupLinesToggle; delete OPT_SINCE.autoPrintToggle;
      window.TPV_STATE.isAdmin = eraAdmin;
      __optNewState = { lastVersion: "", seen: {} };
      renderOptionsPreviews();
      return res;
    });
    check("Una opcion de un grupo de administrador NO se marca a quien no lo es", r.admin === false, JSON.stringify(r));
    check("Una opcion mas antigua que la version base no se marca; una reciente si", r.antigua === false && r.reciente === true, JSON.stringify(r));

    r = await ev(async () => {
      __optNewState = { lastVersion: "0.2.69", seen: {} }; // Opciones ya miradas con la 0.2.69
      const yaVista = optIsNew("optionsSendDiagBtn");
      __optNewState = { lastVersion: "0.2.68", seen: {} };
      const llegaDespues = optIsNew("optionsSendDiagBtn");
      await window.TPV_CFG.set("ui.optionsNew", { lastVersion: "0.2.68", seen: { "opcion-que-ya-no-existe": 123, thermalLogoToggle: Date.now() } });
      await loadOptionsNewState();
      return { yaVista, llegaDespues, claves: Object.keys(__optNewState.seen) };
    });
    check("Una opcion que llego ANTES de la ultima vez que se miraron las Opciones no se marca; una posterior si", r.yaVista === false && r.llegaDespues === true, JSON.stringify(r));
    check("Al cargar se descartan las opciones que ya no existen", JSON.stringify(r.claves) === JSON.stringify(["thermalLogoToggle"]), JSON.stringify(r));
    await ev(async () => { try { await window.TPV_CFG.set("ui.optionsNew", {}); } catch {} __optNewState = { lastVersion: "", seen: {} }; renderOptionsPreviews(); });

    // ---------------- Paso 7: valores de fabrica y filtro «Cambiadas» ----------------
    r = await ev(() => {
      const faltan = [], ambos = [], sobran = [], malTipo = [];
      optDefIndex().forEach((info, id) => {
        const k = info.def.kind;
        if (k !== "toggle" && k !== "value" && k !== "count") return;
        const enStd = OPT_STD[id] !== undefined, enNone = OPT_STD_NONE.has(id);
        if (!enStd && !enNone) faltan.push(id);
        if (enStd && enNone) ambos.push(id);
        if (enStd && ((k === "toggle" && typeof OPT_STD[id] !== "boolean") || (k === "count" && typeof OPT_STD[id] !== "number") || (k === "value" && typeof OPT_STD[id] !== "string"))) malTipo.push(id);
      });
      Object.keys(OPT_STD).forEach((id) => { if (!optDefIndex().has(id)) sobran.push(id); });
      OPT_STD_NONE.forEach((id) => { if (!optDefIndex().has(id)) sobran.push(id); });
      return { faltan, ambos, sobran, malTipo, n: Object.keys(OPT_STD).length };
    });
    check("Toda opcion del catalogo (interruptor, valor o lista) tiene su valor de fabrica o esta marcada «sin estandar» (al añadir una nueva hay que decidirlo)", r.faltan.length === 0, JSON.stringify(r));
    check("... sin ids repetidos en las dos listas, sin ids que ya no existen y con el tipo correcto (si/no, texto, numero)", r.ambos.length === 0 && r.sobran.length === 0 && r.malTipo.length === 0 && r.n >= 45, JSON.stringify(r));

    await ev(() => {
      window.__aEstandar = () => {
        optDefIndex().forEach((info, id) => {
          const std = OPT_STD[id];
          if (std === undefined) return;
          const el = document.getElementById(id);
          if (!el) return;
          if (info.def.kind === "toggle") el.checked = !!std;
          else if (info.def.kind === "value") { if (el.tagName === "SELECT") { if ([...el.options].some((o) => o.value === String(std))) el.value = String(std); } else el.value = String(std); }
          else if (info.def.kind === "count") el.querySelectorAll(info.def.selector).forEach((n) => n.remove());
        });
        optChangedOnly = false;
        applyOptionsSearch();
        renderOptionsPreviews();
      };
      window.__aEstandar();
    });
    r = await ev(async () => {
      document.getElementById("optionsOverlay").classList.remove("hidden");
      const antes = countChangedOptions();
      setOptionsChangedOnly(true);
      const btn = document.getElementById("optionsChangedBtn");
      const vacio = document.getElementById("optionsSearchEmpty");
      const filasVisibles = [...document.querySelectorAll("#optionsAccordion .opt-sec:not(.opt-search-hide) .opt-row:not(.opt-search-hide)")].filter((r) => r.closest(".opt-sec").style.display !== "none").length; // las secciones ocultas por el servidor (Encargos) no cuentan
      const res = { antes, texto: btn.textContent, activo: btn.classList.contains("is-on"), pressed: btn.getAttribute("aria-pressed"), mensaje: vacio.textContent, mensajeVisible: !vacio.classList.contains("hidden"), filasVisibles, quickOculto: getComputedStyle(document.getElementById("optionsQuick")).display === "none" };
      setOptionsChangedOnly(false);
      res.tras = { vacioOculto: document.getElementById("optionsSearchEmpty").classList.contains("hidden"), buscando: document.getElementById("optionsAccordion").classList.contains("opt-searching"), activo: btn.classList.contains("is-on"), quick: getComputedStyle(document.getElementById("optionsQuick")).display !== "none" };
      return res;
    });
    check("Con todo como de fabrica el boton dice «Cambiadas (0)»", r.antes === 0 && r.texto === "Cambiadas (0)", JSON.stringify(r));
    check("... al pulsarlo se enciende, no queda ninguna fila y avisa «Todo está como de fábrica»; el bloque de acceso rapido se oculta", r.activo && r.pressed === "true" && r.filasVisibles === 0 && r.mensajeVisible && /como de fábrica/.test(r.mensaje) && r.quickOculto, JSON.stringify(r));
    check("... y al volver a pulsarlo todo vuelve a su sitio", r.tras.vacioOculto && !r.tras.buscando && !r.tras.activo && r.tras.quick, JSON.stringify(r.tras));

    r = await ev(async () => {
      window.__aEstandar();
      document.getElementById("thermalLogoToggle").checked = false;                       // de fabrica: activado
      const sel = document.getElementById("updateNoticeIntervalSelect");
      const otra = [...sel.options].find((o) => o.value !== "3600000" && o.value !== "");
      sel.value = otra.value;                                                             // de fabrica: cada 1 hora
      document.getElementById("encargosEnabledToggle").checked = true;                    // sin estandar (lo concede el servidor): no cuenta
      document.getElementById("priceEditModeToggle").checked = true;                      // de un grupo de administrador: no cuenta sin serlo
      const eraAdmin = !!window.TPV_STATE.isAdmin;
      window.TPV_STATE.isAdmin = false;
      renderOptionsPreviews();
      const n = countChangedOptions();
      const kiosco = (() => { const k = document.getElementById("kioskToggle"); const antes = k.checked; k.checked = true; const c = optIsChanged("kioskToggle"); k.checked = antes; return c; })();
      const vacioNoCuenta = (() => { const prev = sel.value; sel.selectedIndex = -1; const c = optIsChanged("updateNoticeIntervalSelect"); sel.value = prev; return c; })();
      setOptionsChangedOnly(true);
      const visible = (id) => { const row = document.getElementById(id).closest(".opt-row"); const sec = row.closest(".opt-sec"); return !row.classList.contains("opt-search-hide") && !sec.classList.contains("opt-search-hide") && sec.style.display !== "none"; };
      const res = {
        n, boton: document.getElementById("optionsChangedBtn").textContent, kiosco, vacioNoCuenta,
        logo: visible("thermalLogoToggle"), intervalo: visible("updateNoticeIntervalSelect"),
        sinCambio: visible("groupLinesToggle"), encargos: visible("encargosEnabledToggle"), precio: visible("priceEditModeToggle"),
        notaLogo: document.getElementById("thermalLogoToggle").closest(".opt-row").querySelector(".opt-row-title").getAttribute("data-std"),
        notaIntervalo: document.getElementById("updateNoticeIntervalSelect").closest(".opt-row").querySelector(".opt-row-title").getAttribute("data-std"),
        seccionCarritoOculta: document.querySelector('#optionsAccordion .opt-sec[data-sec="carrito"]').classList.contains("opt-search-hide"),
      };
      setOptionsChangedOnly(false);
      res.notasTras = document.querySelectorAll("#optionsAccordion .opt-row-title[data-std]").length;
      window.TPV_STATE.isAdmin = eraAdmin;
      return res;
    });
    check("La cuenta solo incluye lo cambiado respecto a fabrica y que este usuario puede ver (2): no cuentan las opciones sin estandar ni las de administrador", r.n === 2 && r.boton === "Cambiadas (2)", JSON.stringify(r));
    check("El modo kiosco tiene como valor de fabrica «apagado» (una instalacion nueva lo deja apagado): encendido cuenta como cambiado", r.kiosco === true, JSON.stringify(r));
    check("Un control sin cargar (valor vacio) no se da por cambiado", r.vacioNoCuenta === false, JSON.stringify(r));
    check("El filtro enseña solo las filas cambiadas (y sus grupos); oculta las que estan como de fabrica, las sin estandar y las de administrador", r.logo && r.intervalo && !r.sinCambio && !r.encargos && !r.precio && r.seccionCarritoOculta, JSON.stringify(r));
    check("Cada fila cambiada dice cual es su valor de fabrica («de fábrica: activada», «de fábrica: Cada 1 hora») y las notas desaparecen al apagar el filtro", r.notaLogo === "de fábrica: activada" && /de fábrica: .*1 hora/i.test(r.notaIntervalo) && r.notasTras === 0, JSON.stringify(r));

    r = await ev(async () => {
      document.getElementById("thermalLogoToggle").checked = false;
      const input = document.getElementById("optionsSearchInput");
      const rowLogo = document.getElementById("thermalLogoToggle").closest(".opt-row");
      const abiertoAntes = document.querySelector('#optionsAccordion .opt-sec[data-sec="carrito"]').dataset.open;
      setOptionsChangedOnly(true);
      input.value = "logo";
      applyOptionsSearch();
      const conLogo = !rowLogo.classList.contains("opt-search-hide");
      input.value = "cajon";
      applyOptionsSearch();
      const mensaje = document.getElementById("optionsSearchEmpty").textContent;
      const sinResultados = !document.getElementById("optionsSearchEmpty").classList.contains("hidden");
      input.value = "";
      setOptionsChangedOnly(false);
      const abiertoDespues = document.querySelector('#optionsAccordion .opt-sec[data-sec="carrito"]').dataset.open;
      return { conLogo, sinResultados, mensaje, abiertoAntes, abiertoDespues };
    });
    check("El filtro se combina con la busqueda: «logo» + cambiadas encuentra su fila; «cajon» + cambiadas no encuentra nada y lo dice", r.conLogo && r.sinResultados && /cambiada coincide/.test(r.mensaje), JSON.stringify(r));
    check("Al apagar el filtro los grupos vuelven a estar abiertos o cerrados como estaban", r.abiertoAntes === r.abiertoDespues, JSON.stringify(r));

    r = await ev(async () => {
      document.getElementById("thermalLogoToggle").checked = false;
      document.getElementById("optionsOverlay").classList.remove("hidden");
      setOptionsChangedOnly(true);
      closeOptions();
      const res = { filtro: optChangedOnly, boton: document.getElementById("optionsChangedBtn").classList.contains("is-on"), notas: document.querySelectorAll("#optionsAccordion .opt-row-title[data-std]").length };
      window.__aEstandar();
      return res;
    });
    check("Al cerrar Opciones el filtro se apaga (se abren siempre sin filtrar)", r.filtro === false && r.boton === false && r.notas === 0, JSON.stringify(r));

    // ---------------- Paso 8: ayuda «?» ----------------
    r = await ev(() => {
      const ids = Object.keys(OPT_HELP);
      const sinCatalogo = ids.filter((id) => !optDefIndex().has(id));
      const sinFila = ids.filter((id) => !document.getElementById(id)?.closest(".opt-row"));
      const textos = ids.map((id) => OPT_HELP[id]);
      const malTexto = ids.filter((id) => { const t = OPT_HELP[id]; return typeof t !== "string" || t.trim().length < 20 || t.length > 320 || !/[.»)]$/.test(t) || /  /.test(t); });
      return { n: ids.length, sinCatalogo, sinFila, malTexto, repetidos: textos.length - new Set(textos).size };
    });
    check("Cada ayuda es de una opcion que existe en el catalogo y en pantalla, y son frases cortas (20-320 caracteres) sin repetir", r.n >= 30 && r.sinCatalogo.length === 0 && r.sinFila.length === 0 && r.malTexto.length === 0 && r.repetidos === 0, JSON.stringify(r));

    r = await ev(async () => {
      document.getElementById("optionsOverlay").classList.remove("hidden");
      renderOptionsPreviews(); renderOptionsPreviews();
      const btns = [...document.querySelectorAll("#optionsAccordion .opt-help[data-help-id]")];
      const filas = new Set(btns.map((b) => b.closest(".opt-row")));
      const enLabel = btns.filter((b) => b.closest("label")).length;
      const enTitulo = btns.filter((b) => b.parentElement && b.parentElement.classList.contains("opt-row-title")).length;
      const conTexto = btns.filter((b) => b.textContent.trim() !== "").length;
      return { botones: btns.length, esperados: Object.keys(OPT_HELP).length, filas: filas.size, enLabel, enTitulo, conTexto };
    });
    check("Cada opcion con ayuda tiene su boton «?» (uno por fila, repintar no lo duplica, ninguno dentro de un <label>)", r.botones === r.esperados && r.filas === r.botones && r.enLabel === 0, JSON.stringify(r));
    check("El «?» va junto al nombre y no mete texto en el titulo (la busqueda no se ensucia: su signo sale por CSS)", r.enTitulo >= r.botones * 0.8 && r.conTexto === 0, JSON.stringify(r));

    r = await ev(async () => {
      const id = "askStockBulkDeletePendingToggle";
      const ctl = document.getElementById(id);
      const row = ctl.closest(".opt-row");
      const btn = row.querySelector(".opt-help");
      const antes = ctl.checked;
      const ordenAntes = [...row.parentElement.children].indexOf(row);
      btn.click();
      const abierta = row.querySelector(".opt-help-box");
      const textoAbierta = abierta && abierta.textContent;
      const ariaAbierta = btn.getAttribute("aria-expanded");
      const dentroDeTxt = !!abierta && abierta.parentElement.classList.contains("opt-row-txt");
      const noEnTitulo = !row.querySelector(".opt-row-title .opt-help-box, .opt-row-sub .opt-help-box");
      const estrellaConviveConAyuda = !!row.querySelector(".opt-row-title .opt-fav") && !!row.querySelector(".opt-row-title .opt-help");
      btn.click();
      return { textoAbierta, esperado: OPT_HELP[id], ariaAbierta, cerrada: !row.querySelector(".opt-help-box"), ariaCerrada: btn.getAttribute("aria-expanded"), igual: ctl.checked === antes, mismoOrden: [...row.parentElement.children].indexOf(row) === ordenAntes, dentroDeTxt, noEnTitulo, estrellaConviveConAyuda };
    });
    check("Pulsar «?» abre la explicacion dentro de la propia fila (con el texto exacto) y volver a pulsar la cierra", r.textoAbierta === r.esperado && r.ariaAbierta === "true" && r.cerrada && r.ariaCerrada === "false" && r.dentroDeTxt, JSON.stringify(r));
    check("... sin tocar la opcion (el interruptor no cambia), sin mover filas y sin meter la ayuda en el titulo ni en el subtitulo (no se busca)", r.igual && r.mismoOrden && r.noEnTitulo, JSON.stringify(r));
    check("... y la estrella de favoritas sigue en la misma fila junto al «?»", r.estrellaConviveConAyuda, JSON.stringify(r));

    r = await ev(async () => {
      const id = "kioskToggle";
      const row = document.getElementById(id).closest(".opt-row");
      row.querySelector(".opt-help").click();
      const abierta = !!row.querySelector(".opt-help-box");
      renderOptionsPreviews(); // repintar (cualquier cambio de Opciones lo hace) no debe cerrarla ni duplicarla
      const sigue = row.querySelectorAll(".opt-help-box").length;
      row.querySelector(".opt-help").click();
      return { abierta, sigue };
    });
    check("Repintar el resumen de Opciones con una ayuda abierta no la cierra ni la duplica", r.abierta && r.sigue === 1, JSON.stringify(r));

    // ---------------- Paso 9: copiar opciones a otro terminal ----------------
    // Opciones abiertas como en el TPV real (sesion iniciada y administrador): enlaza los manejadores y carga los ajustes
    await ev(async () => {
      hasActiveLoginSession = () => true;
      try { await Promise.race([openOptions(), new Promise((r) => setTimeout(r, 25000))]); } catch {}
      await new Promise((r) => setTimeout(r, 800));
      window.TPV_STATE.isAdmin = true;
      MESAS_MODULE_ENABLED = true; // el modo mesas encendido (si no, sus opciones no se ven y no se copian)
      applyAdminOnlyUI();
      optCopyClearUndo();
    });
    r = await ev(() => {
      const sec = document.querySelector('#optionsAccordion .opt-sec[data-sec="copiar"]');
      return { sec: !!sec, admin: !!sec && sec.hasAttribute("data-admin-only"), exp: !!document.getElementById("optionsExportBtn"), imp: !!document.getElementById("optionsImportBtn"), undo: !!document.getElementById("optionsImportUndoBtn"), undoOculto: document.getElementById("optionsImportUndoBtn").classList.contains("hidden"), catalogo: !!OPT_PREVIEW_DEFS.copiar, api: !!(window.TPV_OPTCOPY && window.TPV_OPTCOPY.exportFile && window.TPV_OPTCOPY.importFile) };
    });
    check("Existe el apartado «Copiar opciones a otro terminal» (solo administrador) con Exportar, Importar y Deshacer (oculto al principio), y el puente con el proceso principal", r.sec && r.admin && r.exp && r.imp && r.undo && r.undoOculto && r.catalogo && r.api, JSON.stringify(r));

    r = await ev(() => {
      const prohibidas = ["currentPrinterName", "currentComandaPrinterName", "scalePortSelect", "kioskToggle", "autostartToggle", "virtualKeyboardToggle", "customerDisplayToggle", "safeTrainingModeToggle", "terminalDefaultCustomerSelect", "priceEditModeToggle", "updateNoticeEnabledToggle", "updateOfferOnCloseToggle", "updateNoticeIntervalSelect", "productsStockOnlyToggle", "agentAdminPinModeToggle"];
      const sinControl = OPT_COPY_IDS.filter((id) => !document.getElementById(id));
      const sinCatalogo = OPT_COPY_IDS.filter((id) => !optDefIndex().has(id));
      const cuelan = OPT_COPY_IDS.filter((id) => prohibidas.includes(id));
      return { n: OPT_COPY_IDS.length, sinControl, sinCatalogo, cuelan, repetidas: OPT_COPY_IDS.length - new Set(OPT_COPY_IDS).size };
    });
    check("La lista blanca: cada opcion existe en pantalla y en el catalogo, sin repetir, y no cuela ninguna de las excluidas (impresoras, bascula, kiosco, teclado, actualizacion...)", r.n >= 25 && !r.sinControl.length && !r.sinCatalogo.length && !r.cuelan.length && r.repetidas === 0, JSON.stringify(r));

    const exp = await ev(() => optCopyBuildExport());
    check("Exportar: trae el tipo y la version, la fecha, solo ids de la lista blanca y los descuentos rapidos", exp.kind === "tpv-recipok-options" && exp.version === 1 && !Number.isNaN(Date.parse(exp.exportedAt)) && Object.keys(exp.values).length >= 20 && Object.keys(exp.values).every((k) => k !== "" && !/printer|scale|kiosk|pin|password|key/i.test(k)) && Array.isArray(exp.discountQuickPcts) && exp.discountQuickPcts.length === 5, JSON.stringify(exp).slice(0, 300));
    check("Exportar: los valores son del tipo del control (interruptor = true/false, lista/numero = texto)", Object.entries(exp.values).every(([k, v]) => (k.endsWith("Toggle") ? typeof v === "boolean" : typeof v === "string")), JSON.stringify(exp.values).slice(0, 300));

    r = await ev(() => {
      const ids = (x) => JSON.stringify(x);
      return {
        noObj: optCopyPlanImport(null).error, array: optCopyPlanImport([]).error, otroTipo: optCopyPlanImport({ kind: "otra-cosa", version: 1, values: {} }).error,
        nueva: optCopyPlanImport({ kind: "tpv-recipok-options", version: 99, values: {} }).error, sinVersion: optCopyPlanImport({ kind: "tpv-recipok-options", values: {} }).error,
        sinValores: optCopyPlanImport({ kind: "tpv-recipok-options", version: 1 }).error, valoresArray: optCopyPlanImport({ kind: "tpv-recipok-options", version: 1, values: [] }).error,
      };
    });
    check("Importar: rechaza lo que no es un archivo de opciones (nulo, lista, otro tipo, sin version, sin valores) y avisa si es de una version mas nueva",
      r.noObj && r.array && r.otroTipo && r.sinVersion && r.sinValores && r.valoresArray && r.nueva === "version-nueva", JSON.stringify(r));

    r = await ev(() => {
      const base = { kind: "tpv-recipok-options", version: 1 };
      const cur = optCopyControlValue(document.getElementById("groupLinesToggle"));
      const p = optCopyPlanImport({ ...base, values: {
        groupLinesToggle: "si", // texto en un interruptor
        productSortModeSelect: "no-existe", // valor que la lista no tiene
        autoComandaDelayInput: 99999, // fuera de rango
        comandaCompactToggle: 1, // numero en un interruptor
        currentPrinterName: "HACKED", kioskToggle: true, "__proto__": { x: 1 }, // fuera de la lista
      } });
      const p2 = optCopyPlanImport({ ...base, values: { autoComandaDelayInput: 1.5 } });
      const p3 = optCopyPlanImport({ ...base, values: { autoComandaDelayInput: "abc" } });
      const p4 = optCopyPlanImport({ ...base, values: {}, discountQuickPcts: "mal" });
      return { cambios: p.changes.length, skipped: p.skipped, unknown: p.unknown, dec: p2.changes.length + p2.skipped, txt: p3.changes.length + p3.skipped, dto: p4.skipped, intacto: optCopyControlValue(document.getElementById("groupLinesToggle")) === cur };
    });
    check("Importar: los valores que no valen (tipo equivocado, fuera de la lista, fuera de rango, decimal, texto, descuentos mal formados) se descartan y no cambian nada", r.cambios === 0 && r.skipped >= 4 && r.dec === 1 && r.txt === 1 && r.dto === 1 && r.intacto, JSON.stringify(r));
    check("Importar: lo que no esta en la lista blanca (impresora, kiosco...) se ignora aunque venga en el archivo", r.unknown >= 2, JSON.stringify(r));

    // El mismo archivo que se acaba de exportar no cambia nada
    r = await ev(() => { const p = optCopyPlanImport(optCopyBuildExport()); return { cambios: p.changes.length, same: p.same }; });
    check("Exportar y volver a importar en el mismo terminal: no hay nada que cambiar", r.cambios === 0 && r.same >= 20, JSON.stringify(r));

    // Flujo completo con confirmacion: se cambian varias opciones a la vez
    r = await ev(async () => {
      const ids = ["groupLinesToggle", "askStockBulkDeletePendingToggle", "comandaCompactToggle"];
      const antes = Object.fromEntries(ids.map((id) => [id, document.getElementById(id).checked]));
      const datos = optCopyBuildExport();
      ids.forEach((id) => { datos.values[id] = !antes[id]; });
      datos.values.productSortModeSelect = [...document.getElementById("productSortModeSelect").options].map((o) => o.value).find((v) => v !== document.getElementById("productSortModeSelect").value);
      datos.values.autoComandaDelayInput = "77";
      datos.discountQuickPcts = ["15", "25", "", "", ""];
      const sortAntes = document.getElementById("productSortModeSelect").value;
      const retraso = document.getElementById("autoComandaDelayInput").value;
      const dtoAntes = JSON.stringify(optCopyDiscountSlots());
      const p = optCopyRunImport(datos);
      await new Promise((r) => setTimeout(r, 300));
      const modalVisible = !document.getElementById("msgOverlay").classList.contains("hidden");
      const texto = document.getElementById("msgText").textContent;
      const botonOk = document.getElementById("msgOkBtn").textContent;
      const aunSinCambiar = ids.every((id) => document.getElementById(id).checked === antes[id]);
      document.getElementById("msgOkBtn").click();
      const res = await p;
      await new Promise((r) => setTimeout(r, 400));
      const despues = Object.fromEntries(ids.map((id) => [id, document.getElementById(id).checked]));
      return { res, modalVisible, texto, botonOk, aunSinCambiar, antes, despues, sortAntes, sortDespues: document.getElementById("productSortModeSelect").value, retraso, retrasoDespues: document.getElementById("autoComandaDelayInput").value, dtoAntes, dtoDespues: JSON.stringify(optCopyDiscountSlots()), undoVisible: !document.getElementById("optionsImportUndoBtn").classList.contains("hidden") };
    });
    check("Importar: antes de aplicar enseña un cuadro con «Opcion: antes → despues» y no cambia nada hasta que se acepta", r.modalVisible && r.aunSinCambiar && r.botonOk === "Aplicar" && /→/.test(r.texto) && /Descuentos rápidos/.test(r.texto) && /Espera/.test(r.texto), JSON.stringify({ t: r.texto.slice(0, 400), b: r.botonOk, v: r.modalVisible, s: r.aunSinCambiar }));
    check("Importar: al aceptar se aplican todos los cambios (interruptores, lista, numero y descuentos rapidos) y devuelve cuantos", r.res.applied === 6 && ["groupLinesToggle", "askStockBulkDeletePendingToggle", "comandaCompactToggle"].every((id) => r.despues[id] === !r.antes[id]) && r.sortDespues !== r.sortAntes && r.retrasoDespues === "77" && r.dtoDespues === JSON.stringify([15, 25, null, null, null]), JSON.stringify(r));
    check("Importar: aparece el boton «Deshacer ultima importacion»", r.undoVisible, JSON.stringify(r));

    // Lo importado se GUARDA de verdad (sobrevive a volver a cargar los ajustes)
    r = await ev(async () => {
      const dto = async () => { await loadDiscountQuickPercentsSetting(); return JSON.stringify(optCopyDiscountSlots()); };
      const el = document.getElementById("askStockBulkDeletePendingToggle");
      const esperado = el.checked;
      el.checked = !esperado; await loadAskStockBulkDeletePendingToggle(); const tras = el.checked;
      const el2 = document.getElementById("autoComandaDelayInput");
      el2.value = "5"; // (solo para comprobar que no cambia lo guardado; se devuelve a lo importado para el siguiente paso)
      const delay = (await new Promise((res) => { try { res(localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY)); } catch { res(null); } }));
      el2.value = "77";
      return { esperado, tras, dto: await dto(), delay };
    });
    check("Lo importado se guarda de verdad: al recargar los ajustes el interruptor y los descuentos rapidos siguen como se importaron", r.tras === r.esperado && r.dto === JSON.stringify([15, 25, null, null, null]) && r.delay === "77", JSON.stringify(r));

    // Deshacer: devuelve lo importado, pero respeta lo que se cambio a mano despues
    r = await ev(async () => {
      const mano = document.getElementById("comandaCompactToggle");
      const valorImportado = mano.checked;
      mano.checked = !valorImportado; mano.dispatchEvent(new Event("change", { bubbles: true })); // se cambia a mano despues de importar
      await new Promise((r) => setTimeout(r, 100));
      const u = await optCopyUndoLastImport();
      await new Promise((r) => setTimeout(r, 300));
      return { u, compactToggle: mano.checked, manoEsperado: !valorImportado, dto: JSON.stringify(optCopyDiscountSlots()), delay: document.getElementById("autoComandaDelayInput").value, oculto: document.getElementById("optionsImportUndoBtn").classList.contains("hidden") };
    });
    check("Deshacer: devuelve las opciones importadas (descuentos, retraso...) y deja como esta la que se cambio a mano despues", r.u.reverted === 5 && r.u.kept === 1 && r.compactToggle === r.manoEsperado && r.dto !== JSON.stringify([15, 25, null, null, null]) && r.delay !== "77" && r.oculto, JSON.stringify(r));

    // Cancelar no cambia nada ni deja nada para deshacer
    r = await ev(async () => {
      const el = document.getElementById("groupLinesToggle");
      const antes = el.checked;
      const datos = optCopyBuildExport();
      datos.values.groupLinesToggle = !antes;
      const p = optCopyRunImport(datos);
      await new Promise((r) => setTimeout(r, 300));
      document.getElementById("msgCancelBtn").click();
      const res = await p;
      return { res, igual: el.checked === antes, sinUndo: document.getElementById("optionsImportUndoBtn").classList.contains("hidden") };
    });
    check("Cancelar el cuadro de importar no cambia nada ni deja nada que deshacer", r.res.reason === "cancelado" && r.igual && r.sinUndo, JSON.stringify(r));

    // Un archivo caducado (mas de 24 h) ya no se puede deshacer
    r = await ev(async () => {
      __optCopyUndo = { at: Date.now() - 25 * 3600 * 1000, changes: [{ id: "groupLinesToggle", before: true, after: false }] };
      refreshOptionsImportUndoBtn();
      return { oculto: document.getElementById("optionsImportUndoBtn").classList.contains("hidden"), limpio: optCopyLoadUndo() === null };
    });
    check("La opcion de deshacer caduca a las 24 horas", r.oculto && r.limpio, JSON.stringify(r));

    // Opciones que aqui no se ven (solo Mesas) no se aplican
    r = await ev(() => {
      const el = document.getElementById("autoComandaOnSaveToggle");
      const gate = el.closest("[data-mesas-only]");
      if (!gate) return { sinGate: true };
      const prev = gate.style.display; gate.style.display = "none";
      const p = optCopyPlanImport({ kind: "tpv-recipok-options", version: 1, values: { autoComandaOnSaveToggle: !el.checked } });
      gate.style.display = prev;
      return { cambios: p.changes.length, skipped: p.skipped };
    });
    check("Una opcion que este terminal no ve (solo Modo Mesas apagado) no se aplica: se cuenta como no aplicable", r.sinGate || (r.cambios === 0 && r.skipped === 1), JSON.stringify(r));

    // ---------------- Rediseño compacto: pestañas Todas / Favoritas / Recientes ----------------
    await ev(() => {
      __optFavorites = ["groupLinesToggle", "autoPrintToggle"];
      __optHistory = [{ id: "autoPrintToggle", at: Date.now(), v: "on" }, { id: "groupLinesToggle", at: Date.now() - 1000, v: "off" }];
      try { localStorage.removeItem("tpv_opts_qtab"); } catch {}
      setOptionsQuickTab("all");
      renderOptionsQuickAccess();
    });
    const tabs = () => ev(() => {
      const vis = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none"; };
      const act = [...document.querySelectorAll("#optionsQuick .opt-qtab.is-active")].map((x) => x.dataset.qtab);
      const q = document.getElementById("optionsQuick").getBoundingClientRect();
      return { act, favPane: vis("optionsFavPane"), histList: vis("optionsHistList"), histWrap: vis("optionsHistWrap"), histTab: vis("optionsHistToggle"), favN: document.getElementById("optionsFavCount").textContent, histN: document.getElementById("optionsHistCount").textContent, alto: Math.round(q.height), sel: [...document.querySelectorAll("#optionsQuick .opt-qtab")].map((x) => x.getAttribute("aria-selected")) };
    });
    let t = await tabs();
    check("Pestañas: al abrir solo hay una linea («Todas» activa), sin favoritas ni recientes desplegadas (alto del bloque <= 45 px)", JSON.stringify(t.act) === '["all"]' && !t.favPane && !t.histList && t.alto <= 45 && t.sel.join() === "true,false,false", JSON.stringify(t));
    check("Pestañas: cada pestaña lleva su cuenta («Favoritas (2)», «Recientes (2)»)", t.favN === "(2)" && t.histN === "(2)" && t.histTab, JSON.stringify(t));
    await ev(() => document.getElementById("optionsFavToggle").click());
    t = await tabs();
    check("Pestañas: pulsar «Favoritas» enseña sus chips y marca solo esa pestaña", JSON.stringify(t.act) === '["fav"]' && t.favPane && !t.histList && t.sel.join() === "false,true,false", JSON.stringify(t));
    await ev(() => document.getElementById("optionsHistToggle").click());
    t = await tabs();
    check("Pestañas: pulsar «Recientes» cierra Favoritas y enseña la lista (solo una abierta a la vez)", JSON.stringify(t.act) === '["hist"]' && !t.favPane && t.histList && t.histWrap, JSON.stringify(t));
    await ev(() => document.getElementById("optionsHistToggle").click());
    t = await tabs();
    check("Pestañas: pulsar la pestaña abierta la cierra y vuelve a «Todas»", JSON.stringify(t.act) === '["all"]' && !t.favPane && !t.histList, JSON.stringify(t));
    await ev(() => { document.getElementById("optionsFavToggle").click(); document.getElementById("optionsTabAll").click(); });
    t = await tabs();
    check("Pestañas: «Todas» cierra lo que hubiera abierto", JSON.stringify(t.act) === '["all"]' && !t.favPane, JSON.stringify(t));
    r = await ev(() => { document.getElementById("optionsFavToggle").click(); return localStorage.getItem("tpv_opts_qtab"); });
    check("Pestañas: la ultima elegida se recuerda en este equipo", r === "fav", String(r));
    r = await ev(() => {
      __optQuickTabRestored = false; optFavOpen = false; optHistOpen = false; renderOptionsHistory();
      const antes = optQuickActiveTab();
      restoreOptionsQuickTabOnce();
      return { antes, despues: optQuickActiveTab(), favPane: !document.getElementById("optionsFavPane").classList.contains("hidden") };
    });
    check("Pestañas: al volver a abrir Opciones sale la pestaña que se dejo", r.antes === "all" && r.despues === "fav" && r.favPane, JSON.stringify(r));
    r = await ev(() => {
      setOptionsQuickTab("hist");
      const guardado = __optHistory;
      __optHistory = []; // sin cambios recientes no hay pestaña ni lista, aunque se hubiera dejado abierta
      renderOptionsHistory();
      const out = { tab: !document.getElementById("optionsHistToggle").classList.contains("hidden"), activa: optQuickActiveTab(), lista: !document.getElementById("optionsHistList").classList.contains("hidden"), wrap: !document.getElementById("optionsHistWrap").classList.contains("hidden") };
      __optHistory = guardado; setOptionsQuickTab("all");
      return out;
    });
    check("Pestañas: sin cambios recientes la pestaña «Recientes» desaparece y no queda nada abierto", !r.tab && r.activa === "all" && !r.lista && !r.wrap, JSON.stringify(r));
    r = await ev(() => {
      setOptionsQuickTab("fav");
      const input = document.getElementById("optionsSearchInput");
      input.value = "stock"; input.dispatchEvent(new Event("input", { bubbles: true }));
      const buscando = getComputedStyle(document.getElementById("optionsQuick")).display;
      input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
      const tras = getComputedStyle(document.getElementById("optionsQuick")).display;
      setOptionsQuickTab("all");
      return { buscando, tras };
    });
    check("Pestañas: mientras se busca el bloque se oculta entero y al borrar la busqueda vuelve igual", r.buscando === "none" && r.tras !== "none", JSON.stringify(r));

    // Camino real por el proceso principal (los cuadros de «guardar»/«abrir» de Windows se sustituyen por rutas fijas)
    const fileOk = path.join(os.tmpdir(), `opciones-test-${Date.now()}.json`);
    const fileMal = path.join(os.tmpdir(), `opciones-test-mal-${Date.now()}.json`);
    const fileGrande = path.join(os.tmpdir(), `opciones-test-grande-${Date.now()}.json`);
    fs.writeFileSync(fileMal, "esto no es json {");
    fs.writeFileSync(fileGrande, JSON.stringify({ kind: "tpv-recipok-options", version: 1, values: {}, relleno: "x".repeat(250 * 1024) }));
    const dialogs = async (save, open) => app.evaluate(({ dialog }, a) => {
      dialog.showSaveDialog = async () => (a.save ? { canceled: false, filePath: a.save } : { canceled: true });
      dialog.showOpenDialog = async () => (a.open ? { canceled: false, filePaths: [a.open] } : { canceled: true });
    }, { save, open });
    await dialogs(fileOk, fileOk);
    const exportado = await ev(() => window.TPV_OPTCOPY.exportFile(optCopyBuildExport()));
    const enDisco = fs.existsSync(fileOk) ? JSON.parse(fs.readFileSync(fileOk, "utf8")) : null;
    check("Exportar por el proceso principal: guarda el archivo en la ruta elegida con el JSON de las opciones", exportado.ok && exportado.path === fileOk && enDisco && enDisco.kind === "tpv-recipok-options" && Object.keys(enDisco.values).length >= 20, JSON.stringify({ exportado, claves: enDisco && Object.keys(enDisco.values).length }));
    const leido = await ev(() => window.TPV_OPTCOPY.importFile());
    check("Importar por el proceso principal: lee el archivo y devuelve su contenido y su nombre", leido.ok && leido.data.kind === "tpv-recipok-options" && /^opciones-test-/.test(leido.name) && JSON.stringify(leido.data.values) === JSON.stringify(enDisco.values), JSON.stringify(leido).slice(0, 200));
    await dialogs(fileOk, fileMal);
    let l = await ev(() => window.TPV_OPTCOPY.importFile());
    check("Importar un archivo que no es JSON: lo rechaza con motivo claro y sin romper nada", l.ok === false && l.reason === "no-es-json", JSON.stringify(l));
    await dialogs(fileOk, fileGrande);
    l = await ev(() => window.TPV_OPTCOPY.importFile());
    check("Importar un archivo enorme (mas de 200 KB): lo rechaza sin leerlo entero", l.ok === false && l.reason === "archivo-no-valido", JSON.stringify(l));
    await dialogs(null, null);
    l = await ev(async () => ({ imp: await window.TPV_OPTCOPY.importFile(), exp: await window.TPV_OPTCOPY.exportFile({ a: 1 }) }));
    check("Cancelar los cuadros de Windows no da error ni escribe nada", l.imp.ok === false && l.imp.canceled === true && l.exp.ok === false && l.exp.canceled === true, JSON.stringify(l));
    try { fs.rmSync(fileOk, { force: true }); fs.rmSync(fileMal, { force: true }); fs.rmSync(fileGrande, { force: true }); } catch {}
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    clearTimeout(hard);
    kill();
    await sleep(800);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
