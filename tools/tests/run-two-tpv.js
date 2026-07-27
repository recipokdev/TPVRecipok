// run-two-tpv.js
// Lanza DOS instancias del TPV REAL (no E2E) a la vez en el mismo PC, para
// probar a mano la sincronizacion multi-TPV "espejo" (aparcar / cobrar / borrar
// / resumen / desincronizacion de aparcados) COBRANDO DE VERDAD contra demo.
//
// A diferencia de antes (que corria en E2E con una caja ficticia 9999 y por eso
// NO dejaba cobrar), ahora cada instancia es el programa NORMAL:
//   - modo multi-instancia real (TPV_MULTI_INSTANCE=1): salta el bloqueo de
//     instancia unica y usa un userData aislado por instancia.
//   - NO activa E2E: hace login, abre caja, cobra, imprime... como el TPV real.
//   - userData PERSISTENTE por instancia: configuras el demo (empresa + login)
//     UNA vez en cada ventana y se conserva entre ejecuciones.
//
// Uso:  npm run test:2tpv     (Ctrl+C para cerrar ambas)
//
// Para probar el modelo "espejo" del cliente:
//   1) En cada ventana, conecta a la MISMA empresa demo (mismo email/API key).
//   2) Entra con el MISMO terminal / MISMA caja en las dos (caja compartida).
//   3) Aparca en la ventana 1 y comprueba que la 2 lo ve; cobra, borra, etc.
//
// Nota: crea/borra datos en DEMO, no en produccion real.

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const electronPath = require("electron"); // ruta al ejecutable de electron

const ROOT = path.resolve(__dirname, "..", "..");

const instances = [
  { label: "TPV 1", color: "\x1b[36m", dir: "tpvrecipok-2tpv-real-1" }, // cian
  { label: "TPV 2", color: "\x1b[35m", dir: "tpvrecipok-2tpv-real-2" }, // magenta
];

const children = [];

function launch({ label, color, dir }) {
  // userData PERSISTENTE (no temporal): asi la config de demo y el login se
  // conservan entre ejecuciones y no hay que reconfigurar cada vez.
  const userDataDir = path.join(os.tmpdir(), dir);
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch (_) {}

  const env = {
    ...process.env,
    TPV_MULTI_INSTANCE: "1",
    TPV_USER_DATA: userDataDir,
    TPV_TEST_LABEL: label,
  };
  // Asegurar que NO arranca en modo E2E (por si el entorno lo trae puesto).
  delete env.TPV_E2E;
  delete env.TPV_E2E_USER_DATA;
  delete env.TPV_MODE;

  const child = spawn(electronPath, ["."], { cwd: ROOT, env });
  const tag = `${color}[${label}]\x1b[0m`;

  const pipe = (stream, out) => {
    stream.on("data", (buf) => {
      String(buf)
        .split(/\r?\n/)
        .filter((l) => l.length)
        .forEach((l) => out.write(`${tag} ${l}\n`));
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code) => {
    process.stdout.write(`${tag} cerrado (code ${code}).\n`);
  });

  children.push(child);
  process.stdout.write(`${tag} lanzado (userData: ${userDataDir})\n`);
}

function cleanup() {
  for (const c of children) {
    try {
      c.kill();
    } catch (_) {}
  }
}

process.on("SIGINT", () => {
  process.stdout.write("\nCerrando ambas instancias...\n");
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

console.log(
  "Lanzando 2 instancias REALES del TPV (no E2E). Ctrl+C para cerrar.\n" +
    "Configura en cada ventana la MISMA empresa demo y la MISMA caja para\n" +
    "probar la sincronizacion 'espejo'. El userData de cada una es persistente,\n" +
    "asi que solo tienes que configurarlas la primera vez.\n",
);
instances.forEach(launch);
