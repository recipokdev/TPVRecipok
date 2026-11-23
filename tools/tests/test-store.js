"use strict";
// Tienda sobre la que corren las pruebas «demo» (las que abren TPV reales con perfiles persistentes y escriben datos de prueba).
//   TPV_TEST_STORE no definida o «demo» -> la demo compartida y los perfiles de siempre (tpvrecipok-2tpv-real-1/2): NADA cambia.
//   TPV_TEST_STORE=zz_bateria_tpv        -> la tienda interna de la batería, con SUS PROPIOS perfiles (tpvrecipok-2tpv-zz_bateria_tpv-1/2),
//                                           que hay que activar una vez con el PIN de admin (lo teclea Sergi, nunca el asistente).
// La batería la fija con --store=<slug>; una prueba suelta acepta --store=<slug> o la variable de entorno.
const argStore = (process.argv.find((a) => a.startsWith("--store=")) || "").slice(8);
const STORE = String(argStore || process.env.TPV_TEST_STORE || "demo").trim() || "demo";
if (!/^[A-Za-z0-9_]{1,60}$/.test(STORE)) throw new Error(`TPV_TEST_STORE no válida: ${STORE}`);
const SUFFIX = STORE === "demo" ? "real" : STORE;
const profileDir = (n) => `tpvrecipok-2tpv-${SUFFIX}-${n}`;
module.exports = { STORE, IS_DEMO: STORE === "demo", profileDir, P1: profileDir(1), P2: profileDir(2) };
