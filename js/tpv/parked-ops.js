// Guardado de pedidos aparcados por OPERACIONES -- parte pura (sin red ni DOM).
// Diseno: docs/guardado-por-partes-diseno.md. El servidor aplica las operaciones
// (paraPlesk/tpv/api/lib/parked_reservations_ops_db.php); esto calcula, en el TPV:
//   - diffToOps(base, cur): las operaciones que convierten la ultima version
//     confirmada por el servidor (base) en lo que hay ahora en este TPV (cur);
//   - applyOpsToDoc(doc, ops): lo mismo que hace el servidor, para saber como
//     queda la "base" tras un guardado correcto sin esperar a releerla;
//   - reconcileItems/reconcileHeader: integra un documento remoto nuevo en lo que
//     el usuario tiene en pantalla SIN perder sus cambios aun no enviados.
// Un "documento" es { items: [...], header: {...} }. Cada linea lleva _lineId estable.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TPV_PARKED_OPS = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Campos de cabecera que el servidor sabe cambiar por operacion.
  const HEADER_OP_KEYS = ["ticketName", "obs", "clientName", "codcliente"];
  // Cualquier otro campo de cabecera que cambie obliga al guardado entero.
  const HEADER_UNSUPPORTED_KEYS = [
    "docType",
    "pedidoStatus",
    "collectedAt",
    "splitGroupId",
    "splitPart",
    "splitTotal",
    "displayNo",
    "paid",
    "paidAt",
    "paidTicketCode",
    "paidTicketId",
    "closingInProgress",
    "mesaUid",
    "mesaRoomId",
    "mesaRoomName",
    "mesaTableId",
    "mesaTableName",
    "fs",
  ];
  const QTY_KEYS = ["qty", "cantidad"];
  // Campos de linea que salen del catalogo / de la representacion (no son una edicion del
  // usuario): una linea creada por otro dispositivo con menos campos se completa aqui desde
  // el catalogo, y eso NO debe viajar como cambio.
  const LINE_SET_IGNORE_KEYS = [
    "id",
    "baseProductId",
    "idproducto",
    "name",
    "secondaryName",
    "descripcion",
    "descripcion2",
    "referencia",
    "codimpuesto",
    "imageUrl",
  ];

  function stable(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x === undefined ? null : x);
    if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(x[k]))
        .join(",") +
      "}"
    );
  }

  function same(a, b) {
    return stable(a) === stable(b);
  }

  function qtyOf(line) {
    const v = Number(line?.qty ?? line?.cantidad ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function clone(x) {
    return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  }

  function lineId(line) {
    return String(line?._lineId || "").trim();
  }

  function allHaveIds(items) {
    return (items || []).every((l) => !!lineId(l));
  }

  function hasDuplicateIds(items) {
    const seen = new Set();
    for (const l of items || []) {
      const id = lineId(l);
      if (seen.has(id)) return true;
      seen.add(id);
    }
    return false;
  }

  // ---- diff -> operaciones ----------------------------------------------------

  /**
   * @returns {{ ops: object[], unsupported: string[] }}
   * unsupported no vacio = hay que usar el guardado entero de siempre.
   */
  function diffToOps(base, cur) {
    const unsupported = [];
    const ops = [];
    const bItems = Array.isArray(base?.items) ? base.items : [];
    const cItems = Array.isArray(cur?.items) ? cur.items : [];

    if (!allHaveIds(bItems) || !allHaveIds(cItems)) unsupported.push("lineas-sin-id");
    if (hasDuplicateIds(bItems) || hasDuplicateIds(cItems)) unsupported.push("ids-repetidos");

    const bh = base?.header || {};
    const ch = cur?.header || {};
    for (const k of HEADER_UNSUPPORTED_KEYS) {
      if (!same(bh[k] ?? null, ch[k] ?? null)) unsupported.push("cabecera:" + k);
    }
    if (unsupported.length) return { ops: [], unsupported };

    const bById = new Map(bItems.map((l) => [lineId(l), l]));
    const cById = new Map(cItems.map((l) => [lineId(l), l]));

    // quitadas
    for (const l of bItems) {
      if (!cById.has(lineId(l))) ops.push({ type: "line-remove", lineId: lineId(l) });
    }

    // nuevas y modificadas, en el orden actual
    let prevId = null;
    for (const l of cItems) {
      const id = lineId(l);
      const b = bById.get(id);
      if (!b) {
        const op = { type: "line-add", line: clone(l) };
        if (prevId) op.afterLineId = prevId;
        ops.push(op);
      } else {
        const delta = round3(qtyOf(l) - qtyOf(b));
        if (delta !== 0) ops.push({ type: "line-qty-delta", lineId: id, delta });
        const fields = {};
        const keys = new Set([...Object.keys(l), ...Object.keys(b)]);
        for (const k of keys) {
          if (k === "_lineId" || QTY_KEYS.includes(k) || LINE_SET_IGNORE_KEYS.includes(k)) continue;
          if (!same(l[k] ?? null, b[k] ?? null)) fields[k] = l[k] === undefined ? null : clone(l[k]);
        }
        if (Object.keys(fields).length) ops.push({ type: "line-set", lineId: id, fields });
      }
      prevId = id;
    }

    // cabecera
    const hf = {};
    for (const k of HEADER_OP_KEYS) {
      if (!same(bh[k] ?? "", ch[k] ?? "")) hf[k] = ch[k] ?? "";
    }
    if (!same(bh.mesaAlerts ?? [], ch.mesaAlerts ?? [])) hf.mesaAlerts = clone(ch.mesaAlerts ?? []);
    if (Object.keys(hf).length) ops.push({ type: "header-set", fields: hf });

    if (!same(bh.comandaState ?? null, ch.comandaState ?? null) && ch.comandaState) {
      ops.push({ type: "comanda-commit", comandaState: clone(ch.comandaState) });
    }

    return { ops, unsupported };
  }

  // ---- aplicar operaciones a un documento (espejo del servidor) -------------------

  function applyOpsToDoc(doc, ops) {
    const out = { items: clone(doc?.items) || [], header: clone(doc?.header) || {} };
    const find = (id) => out.items.findIndex((l) => lineId(l) === id);

    for (const op of ops || []) {
      const type = op?.type;
      const id = String(op?.lineId || "").trim();
      if (type === "line-add") {
        const line = clone(op.line);
        if (!line || !lineId(line)) continue;
        if (find(lineId(line)) >= 0) continue;
        const after = op.afterLineId ? find(String(op.afterLineId)) : -1;
        if (after >= 0) out.items.splice(after + 1, 0, line);
        else out.items.push(line);
      } else if (type === "line-qty-delta") {
        const pos = find(id);
        if (pos < 0) continue;
        const next = round3(qtyOf(out.items[pos]) + Number(op.delta || 0));
        if (next <= 0.0001) out.items.splice(pos, 1);
        else {
          out.items[pos].qty = next;
          if ("cantidad" in out.items[pos]) out.items[pos].cantidad = next;
        }
      } else if (type === "line-set") {
        const pos = find(id);
        if (pos < 0) continue;
        for (const [k, v] of Object.entries(op.fields || {})) {
          if (k !== "_lineId") out.items[pos][k] = clone(v);
        }
      } else if (type === "line-remove") {
        const pos = find(id);
        if (pos >= 0) out.items.splice(pos, 1);
      } else if (type === "header-set") {
        for (const [k, v] of Object.entries(op.fields || {})) out.header[k] = clone(v);
      } else if (type === "comanda-commit") {
        if (op.comandaState) out.header.comandaState = clone(op.comandaState);
      }
    }
    return out;
  }

  // ---- reconciliar un documento remoto con lo local -----------------------------

  /**
   * @param baseItems  ultima version del servidor con la que ya estabamos al dia
   * @param remoteItems version nueva del servidor
   * @param localItems  lo que el usuario tiene ahora (con cambios aun no enviados)
   * @returns lineas locales nuevas: los cambios locales pendientes se conservan,
   *          los remotos se incorporan.
   */
  function reconcileItems(baseItems, remoteItems, localItems) {
    const base = Array.isArray(baseItems) ? baseItems : [];
    const remote = Array.isArray(remoteItems) ? remoteItems : [];
    const local = Array.isArray(localItems) ? localItems : [];

    const bById = new Map(base.map((l) => [lineId(l), l]));
    const rById = new Map(remote.map((l) => [lineId(l), l]));
    const lIds = new Set(local.map(lineId));

    const result = [];
    for (const l of local) {
      const id = lineId(l);
      const b = bById.get(id);
      const r = rById.get(id);

      if (b && !r) continue; // lo quitaron en otro sitio: gana quitar

      if (b && r) {
        const merged = clone(l);
        const nextQty = round3(qtyOf(l) + (qtyOf(r) - qtyOf(b)));
        if (nextQty <= 0.0001) continue;
        merged.qty = nextQty;
        if ("cantidad" in merged || "cantidad" in r) merged.cantidad = nextQty;
        const keys = new Set([...Object.keys(r), ...Object.keys(b)]);
        for (const k of keys) {
          if (k === "_lineId" || QTY_KEYS.includes(k)) continue;
          // lo que yo no he tocado lo toma del servidor; lo que he tocado, se queda
          if (same(l[k] ?? null, b[k] ?? null)) {
            if (k in r) merged[k] = clone(r[k]);
            else delete merged[k];
          }
        }
        result.push(merged);
        continue;
      }

      result.push(clone(l)); // linea nueva local aun no confirmada
    }

    // lineas nuevas del servidor que aqui no estan
    remote.forEach((r, idx) => {
      const id = lineId(r);
      if (lIds.has(id)) return;
      if (bById.has(id)) return; // yo la quite (pendiente de enviar): sigue quitada
      const prev = idx > 0 ? lineId(remote[idx - 1]) : "";
      const at = prev ? result.findIndex((x) => lineId(x) === prev) : -1;
      if (at >= 0) result.splice(at + 1, 0, clone(r));
      else result.push(clone(r));
    });

    return result;
  }

  function reconcileHeader(baseHeader, remoteHeader, localHeader) {
    const base = baseHeader || {};
    const remote = remoteHeader || {};
    const local = localHeader || {};
    const out = { ...local };
    const keys = new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)]);
    for (const k of keys) {
      if (same(local[k] ?? null, base[k] ?? null)) {
        if (k in remote) out[k] = clone(remote[k]);
        else delete out[k];
      }
    }
    return out;
  }

  // ---- identificador de peticion (idempotencia) --------------------------------

  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  /**
   * Mismo dispositivo + mismo pedido + misma base + mismas operaciones => mismo id
   * (un reintento tras perder la respuesta no se aplica dos veces). Otro dispositivo
   * u otra base => id distinto.
   */
  function makeClientOpId(deviceKey, ticketKey, baseVersion, ops) {
    return "c-" + hash32(String(deviceKey)) + "-" + hash32(String(ticketKey)) + "-" + hash32(String(baseVersion)) + "-" + hash32(stable(ops));
  }

  return {
    HEADER_OP_KEYS,
    HEADER_UNSUPPORTED_KEYS,
    diffToOps,
    applyOpsToDoc,
    reconcileItems,
    reconcileHeader,
    makeClientOpId,
    stable,
  };
});
