"use strict";
// Red de seguridad de las instalaciones del TPV en Windows (proceso main). Sin dependencias de Electron: se puede probar con Node.
//
// Caso real (Ben_Trempat, 2026-11-18): un equipo empezo a instalar la 0.2.67 y no volvio a abrir. El instalador de actualizaciones es
// SILENCIOSO y quita la version vieja antes de poner la nueva: si se interrumpe (antivirus, apagado, fichero en uso) el equipo se queda
// SIN programa, y como ya no hay programa, nada dentro de la app puede avisar ni reparar. Por eso esto vive FUERA de la app:
//   1. Un vigilante PowerShell independiente (no se borra con la carpeta de instalacion y no lo mata el instalador) que, tras lanzar la
//      instalacion, espera a que la version nueva avise de que ya se ve. Si no lo hace: lo cuenta al servidor con datos (antivirus de
//      Windows, si existe el .exe, si el instalador sigue...), intenta abrir el programa, reinstala (2 veces) y, como ultimo recurso,
//      abre el instalador con ventanas y un aviso para que la persona lo termine.
//   2. Una copia del instalador en una carpeta que el desinstalador no toca (enlace duro: no ocupa espacio ni tarda), sobre la que
//      main.js crea un acceso «REPARAR TPV Recipok» en el escritorio mientras la instalacion no se haya confirmado.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");

const DEFAULT_CACHE_DIR_NAME = "tpvrecipok-updater";
const REPAIR_DIR_NAME = "repair";
const REPAIR_INSTALLER_NAME = "TPV-Recipok-Reparar.exe";
const WATCHDOG_SCRIPT_NAME = "install-watchdog.ps1";
const WATCHDOG_CTX_NAME = "install-watchdog.json";

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

// Carpeta de descargas de electron-updater: resources/app-update.yml -> updaterCacheDirName (por defecto tpvrecipok-updater).
function getUpdaterCacheDir(resourcesPath) {
  let name = DEFAULT_CACHE_DIR_NAME;
  try {
    const raw = fs.readFileSync(path.join(String(resourcesPath || ""), "app-update.yml"), "utf8");
    const m = raw.match(/^\s*updaterCacheDirName:\s*(\S+)\s*$/m);
    if (m && m[1]) name = m[1].replace(/^["']|["']$/g, "");
  } catch (_) {}
  return path.join(localAppData(), name);
}

// El instalador ya descargado (electron-updater lo deja en <cache>/pending). Devuelve "" si no hay.
function findPendingInstaller(cacheDir) {
  try {
    const dir = path.join(cacheDir, "pending");
    let best = "", bestT = -1;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.exe$/i.test(f)) continue;
      const full = path.join(dir, f);
      const t = fs.statSync(full).mtimeMs;
      if (t > bestT) { best = full; bestT = t; }
    }
    return best;
  } catch (_) {
    return "";
  }
}

function versionFromInstallerName(installerPath) {
  const m = String(path.basename(String(installerPath || ""))).match(/(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)\.exe$/i);
  return m ? m[1] : "";
}

function repairDirOf(cacheDir) {
  return path.join(cacheDir, REPAIR_DIR_NAME);
}

// Guarda una copia del instalador fuera de "pending" (que electron-updater vacia al bajar otra version). Enlace duro si se puede
// (instantaneo, sin espacio extra); si no, copia. Nunca lanza.
function keepRepairInstaller(cacheDir, installerPath) {
  try {
    if (!installerPath || !fs.existsSync(installerPath)) return { ok: false, error: "sin-instalador" };
    const dir = repairDirOf(cacheDir);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, REPAIR_INSTALLER_NAME);
    try { fs.rmSync(target, { force: true }); } catch (_) {}
    let method = "enlace";
    try {
      fs.linkSync(installerPath, target);
    } catch (_) {
      fs.copyFileSync(installerPath, target);
      method = "copia";
    }
    const size = fs.statSync(target).size;
    return { ok: true, path: target, method, sizeMb: Math.round(size / 1048576) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}

function removeRepairInstaller(cacheDir) {
  try { fs.rmSync(repairDirOf(cacheDir), { recursive: true, force: true }); } catch (_) {}
}

// Antivirus registrados en el Centro de seguridad de Windows (Defender incluido). Nunca rechaza ni tarda mas de ~8 s.
function queryAntivirus() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    try {
      const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      execFile(
        fs.existsSync(ps) ? ps : "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command",
          "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object { $_.displayName }"],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve([]);
          const list = String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          resolve(Array.from(new Set(list)).slice(0, 6));
        },
      );
    } catch (_) {
      resolve([]);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Script del vigilante. Solo ASCII (PowerShell 5.1 lee mal el UTF-8 sin BOM); se escribe con BOM por si acaso.
// Parametros en un JSON (nada de claves en la linea de comandos). Todos los tiempos son configurables para poder probarlo en segundos.
const WATCHDOG_SCRIPT = String.raw`param([Parameter(Mandatory = $true)][string]$CtxFile)
$ErrorActionPreference = 'Continue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$ctx = Get-Content -Raw -Encoding UTF8 -Path $CtxFile | ConvertFrom-Json

function NumOr($v, $d) { if ($null -ne $v -and "$v" -ne '') { return [int]$v } else { return $d } }
function Log($m) {
  try { Add-Content -Encoding UTF8 -Path $ctx.logFile -Value ("{0} [watchdog] {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $m) } catch {}
}
function Post($event, $extra) {
  try {
    if (-not $ctx.url -or -not $ctx.apiKey -or -not $ctx.slug) { return }
    $o = @{ slug = [string]$ctx.slug; event = [string]$event; currentVersion = [string]$ctx.fromVersion; targetVersion = [string]$ctx.targetVersion; source = 'install-watchdog' }
    if ($extra) { foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] } }
    $body = ($o | ConvertTo-Json -Depth 4 -Compress)
    Invoke-RestMethod -Method Post -Uri ([string]$ctx.url + '?action=log-update-event') -Headers @{ 'X-TPV-API-KEY' = [string]$ctx.apiKey } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 8 | Out-Null
  } catch { Log ('no se pudo avisar al servidor: ' + $_.Exception.Message) }
}
function Finish($code) {
  try { if (-not $ctx.keepCtx) { Remove-Item -LiteralPath $CtxFile -Force -ErrorAction SilentlyContinue } } catch {}
  exit $code
}

$poll = NumOr $ctx.pollSec 3
$waitSec = NumOr $ctx.waitSec 240
$slowExtraSec = NumOr $ctx.slowExtraSec 360
$retryWaitSec = NumOr $ctx.retryWaitSec 90
$maxRetries = NumOr $ctx.maxRetries 3
$retryPauseSec = NumOr $ctx.retryPauseSec 30
$relaunchWaitSec = NumOr $ctx.relaunchWaitSec 60
$earlyMinSec = NumOr $ctx.earlyMinSec 12
# Margen sin ningun TPV abierto, con el instalador ya terminado, antes de darlo por fallido:
#  - settleSec (25 s): el instalador NUNCA se vio en marcha. Windows lo bloqueo al lanzarlo (sabor_100x100, 24-nov-2026: 'Una directiva de
#    Control de aplicaciones bloqueo este archivo'); no hay nada que esperar y cuanto antes se abra el TPV de siempre, mejor.
#  - settleSeenSec (180 s): el instalador SI se vio trabajando y luego desaparecio. El TPV nuevo puede tardar en abrir (escaneo del
#    antivirus, disco lento): en Ben_Trempat y Zoen (24-nov-2026) abrio solo entre 130 y 160 s despues de lanzar la instalacion.
$settleSec = NumOr $ctx.settleSec 25
$settleSeenSec = NumOr $ctx.settleSeenSec 180
$missingNeeded = NumOr $ctx.missingStreak 3
$exeName = [IO.Path]::GetFileName([string]$ctx.exePath)
$installerName = ''
if ($ctx.installerPath) { $installerName = [IO.Path]::GetFileNameWithoutExtension([string]$ctx.installerPath) }

# un solo vigilante a la vez
$created = $false
$mutexName = 'Local\TPVRecipokInstallWatchdog'
if ($ctx.mutexName) { $mutexName = [string]$ctx.mutexName }
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created) { Log 'ya hay otro vigilante en marcha; salgo'; Finish 0 }

$start = (Get-Date).ToUniversalTime()
function Elapsed { return [int]((Get-Date).ToUniversalTime() - $start).TotalSeconds }
function Ready {
  try {
    if (-not (Test-Path -LiteralPath $ctx.markerFile)) { return $false }
    return ((Get-Item -LiteralPath $ctx.markerFile).LastWriteTimeUtc -ge $start.AddSeconds(-5))
  } catch { return $false }
}
function AppRunning {
  try {
    # solo el proceso PRINCIPAL del TPV: ni la ventanita de instalando (--post-update-splash) ni los hijos de Chromium (--type=renderer/gpu/...,
    # que incluyen los de esa ventanita y tardan en irse) cuentan como "TPV abierto"
    $p = Get-CimInstance Win32_Process -Filter ("Name='" + $exeName + "'") -ErrorAction Stop | Where-Object { $_.CommandLine -notmatch 'post-update-splash' -and $_.CommandLine -notmatch '--type=' }
    return (@($p).Count -gt 0)
  } catch { return $false }
}
# El instalador, o el desinstalador de la version vieja (NSIS lo copia a la carpeta temporal como Un_A.exe), siguen trabajando
function InstallerRunning {
  try {
    if ($installerName -and (@(Get-Process -Name $installerName -ErrorAction SilentlyContinue).Count -gt 0)) { return $true }
    if (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Un_*' -or $_.ProcessName -like 'Uninstall TPV*' }).Count -gt 0) { return $true }
  } catch {}
  return $false
}
# Restos de un TPV a medias (la ventanita de instalando, hijos de Chromium...) que pueden bloquear ficheros e impedir la instalacion
function KillLeftovers {
  try {
    Get-CimInstance Win32_Process -Filter ("Name='" + $exeName + "'") -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}
function WaitReady($sec) {
  $until = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $until) { if (Ready) { return $true }; Start-Sleep -Seconds $poll }
  return (Ready)
}
function ShortcutTarget($lnk) {
  try { $sh = New-Object -ComObject WScript.Shell; return [string]$sh.CreateShortcut($lnk).TargetPath } catch { return '' }
}
# Crea (o reapunta) un acceso directo al instalador
function PointShortcutAt($lnk, $target, $desc) {
  try {
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = $target
    $s.WorkingDirectory = (Split-Path -Parent $target)
    $s.IconLocation = ($target + ',0')
    $s.Description = $desc
    $s.Save()
    return $true
  } catch { Log ('no se pudo preparar el acceso directo: ' + $_.Exception.Message); return $false }
}
function DefenderHits {
  try {
    $since = $start.AddMinutes(-5).ToLocalTime()
    $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 1116, 1117, 1118, 1119; StartTime = $since } -MaxEvents 3 -ErrorAction Stop
    return @($ev | ForEach-Object { $t = ($_.Message -replace '\s+', ' '); if ($t.Length -gt 240) { $t = $t.Substring(0, 240) }; $t })
  } catch { return @() }
}

$desktop = [Environment]::GetFolderPath('Desktop')
if ($ctx.desktopDir) { $desktop = [string]$ctx.desktopDir }
$shortcutName = 'TPV Recipok.lnk'
if ($ctx.shortcutName) { $shortcutName = [string]$ctx.shortcutName }
$repairName = 'REPARAR TPV Recipok.lnk'
if ($ctx.repairShortcutName) { $repairName = [string]$ctx.repairShortcutName }
$repairLnk = Join-Path $desktop $repairName
function RemoveRepairIcon { try { Remove-Item -LiteralPath $repairLnk -Force -ErrorAction SilentlyContinue } catch {} }

Log ('vigilando la instalacion {0} -> {1} (exe: {2})' -f $ctx.fromVersion, $ctx.targetVersion, $ctx.exePath)

# 1) esperar a que la version nueva avise de que ya se ve. Sin esperar los 4 minutos si el fallo es evidente:
#    - el instalador ya termino y el programa NO existe (el desinstalador lo quito y el instalador no puso el nuevo), o
#    - el instalador ya termino, el programa existe, pero no hay ningun TPV abierto pasado un margen.
#    Un instalador lento (todavia en marcha) se espera mas, hasta un tope.
$extended = $false
$missingStreak = 0
$lastInstSeen = -1
$detectedBy = 'tiempo'
while ($true) {
  if (Ready) { Log ('TPV reabierto a los {0} s: instalacion correcta' -f (Elapsed)); Finish 0 }
  $el = Elapsed
  $instNow = InstallerRunning
  if ($instNow) { $lastInstSeen = $el; $missingStreak = 0 }
  elseif ($el -ge $earlyMinSec) {
    $exeNow = [bool](Test-Path -LiteralPath $ctx.exePath)
    if (-not $exeNow) { $missingStreak++ } else { $missingStreak = 0 }
    if ($missingStreak -ge $missingNeeded) { $detectedBy = 'programa-borrado'; break }
    $idle = $el
    if ($lastInstSeen -ge 0) { $idle = $el - $lastInstSeen }
    $needIdle = $settleSec
    if ($lastInstSeen -ge 0) { $needIdle = $settleSeenSec }
    if ($exeNow -and ($idle -ge $needIdle) -and (-not (AppRunning))) { $detectedBy = 'sin-tpv-abierto'; break }
  }
  if ($el -ge $waitSec) {
    if ($instNow -and ($el -lt ($waitSec + $slowExtraSec))) {
      if (-not $extended) { $extended = $true; Log 'el instalador sigue en marcha; se espera mas'; Post 'install-watchdog-slow' @{ secondsWaited = $el } }
    } else { break }
  }
  Start-Sleep -Seconds $poll
}

# 2) no ha avisado: diagnostico
$exeExists = [bool](Test-Path -LiteralPath $ctx.exePath)
$running = AppRunning
$installer = ''
if ($ctx.installerPath -and (Test-Path -LiteralPath $ctx.installerPath)) { $installer = [string]$ctx.installerPath }
elseif ($ctx.repairInstallerPath -and (Test-Path -LiteralPath $ctx.repairInstallerPath)) { $installer = [string]$ctx.repairInstallerPath }
$installerLeaf = ''
if ($installer) { $installerLeaf = Split-Path -Leaf $installer }
$lnkPath = Join-Path $desktop $shortcutName
$lnkTarget = ''
if (Test-Path -LiteralPath $lnkPath) { $lnkTarget = ShortcutTarget $lnkPath }
$lnkBroken = [bool]($lnkTarget -and -not (Test-Path -LiteralPath $lnkTarget))
$diag = @{
  secondsWaited = (Elapsed); detectedBy = $detectedBy; exeExists = $exeExists; appRunning = [bool]$running; installerRunning = [bool](InstallerRunning)
  desktopShortcut = [bool](Test-Path -LiteralPath $lnkPath); desktopShortcutBroken = $lnkBroken; installerFile = $installerLeaf
  defender = @(DefenderHits)
}
Log ('SIN confirmar a los {0} s ({1}): exe={2} app={3} instalador={4}' -f $diag.secondsWaited, $detectedBy, $exeExists, $running, $diag.installerRunning)

if ($running) {
  # el programa esta abierto pero no ha llegado a mostrarse (p. ej. esperando la comprobacion de actualizaciones): no se toca nada
  Post 'install-watchdog-app-running' $diag
  Finish 0
}
Post 'install-watchdog-failed' $diag

# 3) arreglarlo EN SILENCIO (la persona no debe enterarse). Primero, si el programa esta pero no se abrio: abrirlo
if ($exeExists) {
  Log 'el exe existe pero no hay TPV abierto: se intenta abrir'
  KillLeftovers
  try { Start-Process -FilePath $ctx.exePath -WorkingDirectory (Split-Path -Parent $ctx.exePath) } catch { Log ('no se pudo abrir: ' + $_.Exception.Message) }
  $okRelaunch = WaitReady $relaunchWaitSec
  Post 'install-watchdog-relaunched' @{ ok = [bool]$okRelaunch; secondsWaited = (Elapsed) }
  if ($okRelaunch) { Log 'TPV abierto de nuevo'; Finish 0 }
}

# 4) reinstalar con el instalador ya descargado, en modo silencioso (el mismo que usa el actualizador), con pausas crecientes
#    entre intentos (un antivirus que esta analizando el instalador suele soltarlo al cabo de un rato) y quitando antes los restos
#    de procesos que pueden bloquear ficheros
if (-not $installer) {
  Log 'no hay instalador guardado: no se puede reinstalar'
  Post 'install-watchdog-gave-up' @{ reason = 'sin-instalador'; exeExists = [bool](Test-Path -LiteralPath $ctx.exePath) }
  Finish 1
}
try { Unblock-File -LiteralPath $installer -ErrorAction SilentlyContinue } catch {}
for ($i = 1; $i -le $maxRetries; $i++) {
  if ($i -gt 1 -and $retryPauseSec -gt 0) { Start-Sleep -Seconds ($retryPauseSec * ($i - 1)) }
  if (Ready) { Post 'install-watchdog-recovered' @{ attempt = ($i - 1); secondsWaited = (Elapsed); self = $true }; Finish 0 }
  if (-not (AppRunning)) { KillLeftovers }
  $code = ''
  try {
    $p = Start-Process -FilePath $installer -ArgumentList @('--updated', '/S', '--force-run') -PassThru
    if ($p.WaitForExit(180000)) { $code = [string]$p.ExitCode } else { $code = 'sigue-en-marcha' }
  } catch { $code = ('excepcion: ' + $_.Exception.Message) }
  $okInstall = WaitReady 15
  if ((-not $okInstall) -and (Test-Path -LiteralPath $ctx.exePath) -and (-not (AppRunning))) {
    # se instalo pero no se abrio solo: se abre
    try { Start-Process -FilePath $ctx.exePath -WorkingDirectory (Split-Path -Parent $ctx.exePath) } catch {}
  }
  if (-not $okInstall) { $okInstall = WaitReady $retryWaitSec }
  Log ('reinstalacion {0}: codigo {1}, abierto={2}' -f $i, $code, $okInstall)
  Post 'install-watchdog-retry' @{ attempt = $i; exitCode = $code; ok = [bool]$okInstall; exeExists = [bool](Test-Path -LiteralPath $ctx.exePath) }
  if ($okInstall) { RemoveRepairIcon; Post 'install-watchdog-recovered' @{ attempt = $i; secondsWaited = (Elapsed) }; Finish 0 }
}

# 5) ultimo recurso (solo si NADA de lo anterior ha funcionado): el icono en blanco del escritorio y un icono REPARAR pasan a lanzar el
#    instalador, y se abre el instalador con ventanas y un aviso para que lo termine la persona
$okLnk = $false
if ((-not (Test-Path -LiteralPath $ctx.exePath)) -and $lnkBroken) {
  $okLnk = PointShortcutAt $lnkPath $installer 'Reinstalar TPV Recipok'
  Post 'install-watchdog-shortcut-retargeted' @{ ok = [bool]$okLnk }
}
$okRepairIcon = PointShortcutAt $repairLnk $installer 'Reinstalar el TPV Recipok (usar solo si el TPV no abre)'
Log 'reinstalacion silenciosa sin exito: se abre el instalador con ventanas'
Post 'install-watchdog-gave-up' @{ reason = 'reinstalacion-fallida'; attempts = $maxRetries; exeExists = [bool](Test-Path -LiteralPath $ctx.exePath); repairIcon = [bool]$okRepairIcon }
if (-not $ctx.noDialog) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show('El TPV no se ha podido actualizar. Se va a abrir el instalador: pulsa Siguiente hasta terminar. Si falla, llama a soporte.', 'TPV Recipok', 'OK', 'Warning')
  } catch {}
}
try { Start-Process -FilePath $installer } catch { Log ('no se pudo abrir el instalador: ' + $_.Exception.Message) }
Finish 1
`;

function watchdogScript() {
  return WATCHDOG_SCRIPT;
}

// Escribe el script y su JSON de parametros y lanza el vigilante (independiente, oculto). opts:
//  cacheDir, exePath, installerPath, repairInstallerPath, markerFile, logFile, fromVersion, targetVersion, url, apiKey, slug,
//  y opcionalmente los tiempos y desktopDir/shortcutName/noDialog/mutexName/keepCtx (pruebas). Devuelve {ok, pid?, error?}.
function startInstallWatchdog(opts) {
  try {
    if (process.platform !== "win32") return { ok: false, error: "no-windows" };
    const dir = String(opts.cacheDir || "");
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, WATCHDOG_SCRIPT_NAME);
    const ctxFile = path.join(dir, WATCHDOG_CTX_NAME + (opts.ctxSuffix || ""));
    fs.writeFileSync(script, "\ufeff" + WATCHDOG_SCRIPT, "utf8");
    const ctx = {};
    for (const k of ["exePath", "installerPath", "repairInstallerPath", "markerFile", "logFile", "fromVersion", "targetVersion", "url", "apiKey", "slug",
      "pollSec", "waitSec", "slowExtraSec", "retryWaitSec", "maxRetries", "retryPauseSec", "relaunchWaitSec", "earlyMinSec", "settleSec", "settleSeenSec", "missingStreak",
      "desktopDir", "shortcutName", "repairShortcutName", "noDialog", "mutexName", "keepCtx"]) {
      if (opts[k] !== undefined) ctx[k] = opts[k];
    }
    fs.writeFileSync(ctxFile, JSON.stringify(ctx), "utf8");
    const psPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const psExe = fs.existsSync(psPath) ? psPath : "powershell.exe";
    let child;
    if (opts.directSpawn) {
      // Solo pruebas: lanzamiento directo para poder leer el codigo de salida del script. Muere si muere el proceso que lo lanza.
      child = spawn(psExe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-CtxFile", ctxFile],
        { stdio: "ignore", windowsHide: true });
    } else {
      // Dos trampas de Windows (comprobadas): 1) con "detached" powershell.exe sale al instante sin ejecutar nada; 2) sin "detached" libuv mete
      // al hijo en un Job que lo mata cuando el TPV se cierra (justo lo que ocurre al instalar). Solucion: lo lanza "cmd /c start": el nieto
      // sale del Job (SILENT_BREAKAWAY) y sobrevive. Comillas a mano (rutas con espacios, p. ej. usuarios con nombre y apellido).
      const q = (x) => '"' + String(x).replace(/"/g, "") + '"';
      const line = '/c "start "" /min ' + q(psExe) + " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + q(script) + " -CtxFile " + q(ctxFile) + '"';
      child = spawn(process.env.ComSpec || "cmd.exe", [line], { stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
    }
    child.on("error", () => {});
    child.unref();
    return { ok: true, pid: child.pid, script, ctxFile, child };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  }
}

module.exports = {
  getUpdaterCacheDir,
  findPendingInstaller,
  versionFromInstallerName,
  keepRepairInstaller,
  removeRepairInstaller,
  repairDirOf,
  queryAntivirus,
  watchdogScript,
  startInstallWatchdog,
  REPAIR_INSTALLER_NAME,
};
