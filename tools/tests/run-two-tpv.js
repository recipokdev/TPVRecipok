// run-two-tpv.js
// Lanza DOS instancias del TPV a la vez en el mismo PC para probar a mano la
// sincronizacion multi-TPV (aparcar / cobrar / borrar / cliente en aparcados)
// sin necesidad de una segunda maquina.
//
// Ambas instancias:
//   - corren en modo E2E (no imprime en fisico, no abre cajon, userData aislado)
//   - apuntan al DEMO (plus.recipok.com/demo) => comparten empresa y por tanto
//     las reservas de aparcados, igual que 2 TPV reales de la misma terminal.
//   - son ventanas visibles y NO en kiosco (main.js las deja windowed en E2E),
//     asi puedes colocarlas lado a lado. El titulo lleva "TPV A" / "TPV B".
//
// Uso:  npm run test:2tpv     (Ctrl+C para cerrar ambas y limpiar)
//
// Nota: crea/borra reservas en el DEMO, no en datos reales.

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const electronPath = require("electron"); // ruta al ejecutable de electron

const ROOT = path.resolve(__dirname, "..", "..");

const DEMO_ENV = {
  TPV_E2E: "1",
  TPV_MODE: "demo",
  TPV_E2E_BASE_URL:
    process.env.TPV_E2E_BASE_URL || "https://plus.recipok.com/demo/api/3",
  TPV_E2E_API_KEY: process.env.TPV_E2E_API_KEY || "ST5K5zJOu9r6S63xPx6L",
  TPV_E2E_REQUIRE_ONLINE: "1",
  TPV_E2E_ALLOW_WRITES: "1",
  TPV_E2E_BACKGROUND: "0", // foreground: ventanas visibles y usables
};

const instances = [
  { label: "TPV A", color: "\x1b[36m" }, // cian
  { label: "TPV B", color: "\x1b[35m" }, // magenta
];

const children = [];
const tmpDirs = [];

function launch({ label, color }, idx) {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `tpvrecipok-2tpv-${idx}-`),
  );
  tmpDirs.push(userDataDir);

  const env = {
    ...process.env,
    ...DEMO_ENV,
    TPV_E2E_USER_DATA: userDataDir,
    TPV_TEST_LABEL: label,
  };

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
  process.stdout.write(
    `${tag} lanzado (userData: ${userDataDir})\n`,
  );
}

function cleanup() {
  for (const c of children) {
    try {
      c.kill();
    } catch (_) {}
  }
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
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
  "Lanzando 2 instancias de TPV (modo pruebas, DEMO). Ctrl+C para cerrar.\n" +
    "Coloca las ventanas 'TPV A' y 'TPV B' lado a lado para probar la sincronizacion.\n",
);
instances.forEach(launch);
