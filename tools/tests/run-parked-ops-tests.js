// Pruebas de la parte pura del guardado por operaciones (js/tpv/parked-ops.js).
// Incluye una simulacion de dos dispositivos contra un "servidor" en memoria que
// aplica las operaciones con las mismas reglas que parked_reservations_ops_db.php.
const assert = require("assert");
const OPS = require("../../js/tpv/parked-ops.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[OK] ${name}`);
  } catch (e) {
    failed++;
    console.error(`[FAIL] ${name}\n   ${e.message}`);
  }
}

const L = (id, name, qty, extra = {}) => ({
  _lineId: id,
  name,
  qty,
  cantidad: qty,
  price: 1,
  grossPrice: 1,
  ...extra,
});
const doc = (items, header = {}) => ({ items, header: { ticketName: "T", obs: "", clientName: "", codcliente: "1", mesaAlerts: [], comandaState: null, ...header } });
const qtyOfId = (d, id) => d.items.find((l) => l._lineId === id)?.qty;
const ids = (d) => d.items.map((l) => l._lineId).join(",");

// Servidor en memoria: aplica operaciones (idempotente por clientOpId).
function makeServer(initial) {
  const state = { doc: JSON.parse(JSON.stringify(initial)), version: 1, seen: new Set() };
  return {
    state,
    send(clientOpId, ops) {
      if (state.seen.has(clientOpId)) return { duplicate: true, doc: state.doc, version: state.version };
      state.seen.add(clientOpId);
      state.doc = OPS.applyOpsToDoc(state.doc, ops);
      state.version++;
      return { doc: state.doc, version: state.version };
    },
  };
}

// Dispositivo: guarda "base" (ultima version confirmada con la que esta al dia) y "local".
function makeDevice(name, server) {
  const dev = {
    name,
    base: JSON.parse(JSON.stringify(server.state.doc)),
    baseVersion: server.state.version,
    local: JSON.parse(JSON.stringify(server.state.doc)),
    save() {
      const { ops, unsupported } = OPS.diffToOps(dev.base, dev.local);
      assert.deepStrictEqual(unsupported, [], "no deberia ser no soportado");
      if (!ops.length) return null;
      const id = OPS.makeClientOpId(dev.name, "T1", dev.baseVersion, ops);
      const res = server.send(id, ops);
      if (!res.duplicate) {
        dev.base = OPS.applyOpsToDoc(dev.base, ops); // base' = base + mis operaciones (no la respuesta)
      }
      return { id, ops, res };
    },
    pull() {
      // llega la version del servidor: se integra sin perder lo local
      const remote = JSON.parse(JSON.stringify(server.state.doc));
      dev.local = {
        items: OPS.reconcileItems(dev.base.items, remote.items, dev.local.items),
        header: OPS.reconcileHeader(dev.base.header, remote.header, dev.local.header),
      };
      dev.base = remote;
      dev.baseVersion = server.state.version;
    },
  };
  return dev;
}

test("diff: añadir, quitar, cambiar cantidad, campo de linea, cabecera y comanda", () => {
  const base = doc([L("A", "Agua", 2), L("B", "Pan", 1), L("C", "Vino", 1)]);
  const cur = doc(
    [L("A", "Agua", 3), L("C", "Vino", 1, { price: 5 }), L("D", "Cafe", 1)],
    { obs: "sin sal", comandaState: { seq: 1, printedQtyByLineKey: { k: 1 } } },
  );
  const { ops, unsupported } = OPS.diffToOps(base, cur);
  assert.deepStrictEqual(unsupported, []);
  const types = ops.map((o) => o.type).sort();
  assert.deepStrictEqual(types, ["comanda-commit", "header-set", "line-add", "line-qty-delta", "line-remove", "line-set"].sort());
  const q = ops.find((o) => o.type === "line-qty-delta");
  assert.strictEqual(q.delta, 1);
  const add = ops.find((o) => o.type === "line-add");
  assert.strictEqual(add.afterLineId, "C");
  assert.deepStrictEqual(ops.find((o) => o.type === "line-set").fields, { price: 5 });
});

test("diff: los campos que salen del catalogo no viajan como cambio", () => {
  const base = doc([L("A", "Agua", 1)]);
  const cur = doc([L("A", "Agua", 1, { id: 542, imageUrl: "x.png", referencia: "R", codimpuesto: "IVA10", descripcion: "Agua 33" })]);
  assert.deepStrictEqual(OPS.diffToOps(base, cur).ops, []);
});

test("diff: sin cambios -> sin operaciones", () => {
  const d = doc([L("A", "Agua", 2)]);
  assert.deepStrictEqual(OPS.diffToOps(d, JSON.parse(JSON.stringify(d))).ops, []);
});

test("diff: campos de cabecera no soportados o lineas sin id obligan al guardado entero", () => {
  const base = doc([L("A", "Agua", 1)]);
  assert.ok(OPS.diffToOps(base, { ...base, header: { ...base.header, paid: true } }).unsupported.length);
  assert.ok(OPS.diffToOps(base, { ...base, header: { ...base.header, mesaUid: "x" } }).unsupported.length);
  assert.ok(OPS.diffToOps(base, doc([{ name: "sin id", qty: 1 }])).unsupported.includes("lineas-sin-id"));
  assert.ok(OPS.diffToOps(base, doc([L("A", "a", 1), L("A", "b", 1)])).unsupported.includes("ids-repetidos"));
});

test("aplicar las operaciones de un diff a la base reproduce lo actual (ida y vuelta)", () => {
  const base = doc([L("A", "Agua", 2), L("B", "Pan", 1), L("C", "Vino", 4)]);
  const cur = doc([L("D", "Cafe", 1), L("A", "Agua", 1), L("C", "Vino", 4, { price: 9 }), L("E", "Te", 2)], { clientName: "Ana" });
  const { ops } = OPS.diffToOps(base, cur);
  const out = OPS.applyOpsToDoc(base, ops);
  // mismo contenido (el orden de lineas nuevas depende de afterLineId; comparamos por id y por contenido)
  assert.deepStrictEqual(new Set(out.items.map((l) => l._lineId)), new Set(cur.items.map((l) => l._lineId)));
  for (const l of cur.items) assert.deepStrictEqual(out.items.find((x) => x._lineId === l._lineId), l);
  assert.strictEqual(out.header.clientName, "Ana");
});

test("ida y vuelta aleatoria (300 casos)", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < 300; n++) {
    const count = 1 + Math.floor(rnd() * 5);
    const base = doc(Array.from({ length: count }, (_, i) => L("B" + i, "P" + i, 1 + Math.floor(rnd() * 4))));
    const cur = JSON.parse(JSON.stringify(base));
    cur.items = cur.items.filter(() => rnd() > 0.25);
    cur.items.forEach((l) => {
      if (rnd() > 0.5) { l.qty = l.cantidad = 1 + Math.floor(rnd() * 6); }
      if (rnd() > 0.7) l.price = Math.round(rnd() * 100) / 10;
    });
    const extra = Math.floor(rnd() * 3);
    for (let i = 0; i < extra; i++) cur.items.splice(Math.floor(rnd() * (cur.items.length + 1)), 0, L("N" + n + "_" + i, "N", 1 + Math.floor(rnd() * 3)));
    const { ops } = OPS.diffToOps(base, cur);
    const out = OPS.applyOpsToDoc(base, ops);
    assert.deepStrictEqual(new Set(out.items.map((l) => l._lineId)), new Set(cur.items.map((l) => l._lineId)), "caso " + n);
    for (const l of cur.items) assert.deepStrictEqual(out.items.find((x) => x._lineId === l._lineId), l, "caso " + n);
  }
});

test("dos dispositivos suman +1 a la misma linea: no se pierde ninguno ni se cuenta doble", () => {
  const server = makeServer(doc([L("A", "Agua", 1)]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  A.local.items[0].qty = A.local.items[0].cantidad = 2;
  B.local.items[0].qty = B.local.items[0].cantidad = 2; // mismo diff exacto
  A.save();
  B.save();
  assert.strictEqual(qtyOfId(server.state.doc, "A"), 3);
  A.pull();
  B.pull();
  assert.strictEqual(qtyOfId(A.local, "A"), 3);
  assert.strictEqual(qtyOfId(B.local, "A"), 3);
  // tras integrar lo del otro, el diff de cada uno vs su base debe estar vacio (no re-envia lo ajeno)
  assert.deepStrictEqual(OPS.diffToOps(A.base, A.local).ops, []);
  assert.deepStrictEqual(OPS.diffToOps(B.base, B.local).ops, []);
});

test("cambios en lineas distintas de la misma mesa no se pisan", () => {
  const server = makeServer(doc([L("A", "Agua", 1), L("B", "Pan", 1)]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  A.local.items = A.local.items.filter((l) => l._lineId !== "B"); // A quita el pan
  A.local.items.push(L("N1", "Cafe", 2)); // y añade cafe
  B.local.items[0].qty = B.local.items[0].cantidad = 4; // B sube el agua
  B.local.header.obs = "alergia";
  A.save();
  B.save();
  const s = server.state.doc;
  assert.strictEqual(ids(s), "A,N1");
  assert.strictEqual(qtyOfId(s, "A"), 4);
  assert.strictEqual(s.header.obs, "alergia");
});

test("A tiene cambios sin enviar y le llega lo de B: se integra sin perder lo de A", () => {
  const server = makeServer(doc([L("A", "Agua", 1)]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  B.local.items.push(L("NB", "Pan", 1));
  B.local.items[0].qty = B.local.items[0].cantidad = 3;
  B.save();
  A.local.items[0].qty = A.local.items[0].cantidad = 2; // A sube 1, sin enviar aun
  A.local.items.push(L("NA", "Vino", 1));
  A.pull(); // llega lo de B
  assert.strictEqual(qtyOfId(A.local, "A"), 4); // 1 + (+1 mio) + (+2 de B)
  assert.ok(A.local.items.some((l) => l._lineId === "NB"));
  assert.ok(A.local.items.some((l) => l._lineId === "NA"));
  A.save();
  assert.strictEqual(qtyOfId(server.state.doc, "A"), 4);
  assert.strictEqual(ids(server.state.doc).split(",").sort().join(","), "A,NA,NB");
});

test("quitar gana: B quita una linea que A habia subido", () => {
  const server = makeServer(doc([L("A", "Agua", 1), L("B", "Pan", 1)]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  B.local.items = B.local.items.filter((l) => l._lineId !== "B");
  B.save();
  A.local.items[1].qty = A.local.items[1].cantidad = 5; // A sube el pan que ya no existe
  A.save(); // line-qty-delta sobre linea inexistente: el servidor lo ignora
  assert.strictEqual(ids(server.state.doc), "A");
  A.pull();
  assert.strictEqual(ids(A.local), "A");
});

test("A quita una linea (sin enviar) y llega un cambio de B sobre ella: sigue quitada", () => {
  const server = makeServer(doc([L("A", "Agua", 1), L("B", "Pan", 1)]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  B.local.items[1].qty = B.local.items[1].cantidad = 2;
  B.save();
  A.local.items = A.local.items.filter((l) => l._lineId !== "B");
  A.pull();
  assert.strictEqual(ids(A.local), "A");
  A.save();
  assert.strictEqual(ids(server.state.doc), "A");
});

test("reintento: misma peticion (mismo id) no se aplica dos veces; otro dispositivo con el mismo diff si", () => {
  const server = makeServer(doc([L("A", "Agua", 1)]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  A.local.items[0].qty = A.local.items[0].cantidad = 2;
  const first = A.save();
  // la respuesta "se perdio": A reintenta lo mismo con su base anterior
  const retry = server.send(first.id, first.ops);
  assert.ok(retry.duplicate);
  assert.strictEqual(qtyOfId(server.state.doc, "A"), 2);
  B.local.items[0].qty = B.local.items[0].cantidad = 2;
  B.save();
  assert.strictEqual(qtyOfId(server.state.doc, "A"), 3); // el +1 de B SI cuenta
  assert.notStrictEqual(OPS.makeClientOpId("A", "T1", 1, first.ops), OPS.makeClientOpId("B", "T1", 1, first.ops));
});

test("campos de linea: lo que no he tocado lo toma del servidor; lo que he tocado se queda", () => {
  const server = makeServer(doc([L("A", "Agua", 1, { price: 1, comandaHeld: false })]));
  const A = makeDevice("A", server);
  const B = makeDevice("B", server);
  B.local.items[0].price = 3;
  B.local.items[0].comandaHeld = true;
  B.save();
  A.local.items[0].price = 7; // A cambia el precio tambien
  A.pull();
  assert.strictEqual(A.local.items[0].price, 7); // lo mio se queda
  assert.strictEqual(A.local.items[0].comandaHeld, true); // lo que no toque, del servidor
  A.save();
  assert.strictEqual(server.state.doc.items[0].price, 7); // ultimo en llegar
});

test("cabecera: reconcileHeader conserva lo local cambiado y adopta lo remoto no tocado", () => {
  const base = { obs: "", clientName: "" };
  const out = OPS.reconcileHeader(base, { obs: "remoto", clientName: "Remoto" }, { obs: "", clientName: "Mio" });
  assert.strictEqual(out.obs, "remoto");
  assert.strictEqual(out.clientName, "Mio");
});

if (failed) {
  console.error(`\n${failed} prueba(s) de operaciones fallaron.`);
  process.exit(1);
}
console.log("\nPruebas de operaciones OK.");
