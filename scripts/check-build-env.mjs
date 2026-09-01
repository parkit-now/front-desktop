#!/usr/bin/env node
/**
 * Preflight del entorno de build — valida que la máquina puede correr
 * `make dist-<os>` ANTES de arrancar el proceso largo (venv + PyInstaller +
 * electron-builder). Pensado para fallar rápido y con un mensaje accionable
 * en vez de reventar 10 minutos adentro del build.
 *
 * Uso:
 *   node scripts/check-build-env.mjs [mac|win|linux]
 *
 * El target NO se infiere solo de process.platform: es el SO para el que se
 * va a empaquetar (que en la práctica coincide con el host porque PyInstaller
 * no cross-compila, pero lo dejamos explícito igual que check-services.mjs).
 *
 * Salida: exit 0 si el entorno sirve (puede haber ⚠ no bloqueantes),
 * exit 1 si hay algún ✗ que hay que resolver antes de buildear.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const HOST_TO_TARGET = { win32: 'win', darwin: 'mac', linux: 'linux' };
const arg = process.argv[2];
const target = arg ?? HOST_TO_TARGET[process.platform];

if (!target || !['mac', 'win', 'linux'].includes(target)) {
  console.error(
    `Error: target desconocido "${arg ?? process.platform}". Uso: node scripts/check-build-env.mjs [mac|win|linux]`,
  );
  process.exit(1);
}

let errors = 0;
let warns = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const err = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  errors++;
};
const warn = (m) => {
  console.log(`  \x1b[33m⚠\x1b[0m ${m}`);
  warns++;
};

/**
 * Corre un comando y devuelve stdout .trim(), o null si no existe / falla.
 * `cmd` puede traer args fijos separados por espacio (p. ej. "py -3.12").
 */
function run(cmd, args) {
  const [bin, ...prefix] = cmd.trim().split(/\s+/);
  try {
    return execFileSync(bin, [...prefix, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

console.log(`\nPreflight build — target: ${target}\n`);

// ── bun ───────────────────────────────────────────────────────────────────────
const bun = run('bun', ['--version']);
if (bun) ok(`bun ${bun}`);
else err('bun no encontrado en el PATH — instalá desde https://bun.sh');

// ── node ─────────────────────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 22) ok(`node ${process.versions.node}`);
else err(`node ${process.versions.node} — el proyecto requiere >= 22`);

// ── python ───────────────────────────────────────────────────────────────────
// Mismos defaults que services/*/Makefile: en Windows `python`, en el resto
// `python3.12`. Override con PYTHON_BIN=... (make lo exporta si se pasa en CLI).
const is312 = (v) => /^Python 3\.12\./.test(v || '');
const defaultPyBin =
  process.env.PYTHON_BIN || (target === 'win' ? 'python' : 'python3.12');
// El binario que efectivamente vamos a chequear: el default, o el primer
// fallback que sea 3.12 (típico: `python3.12` no existe pero `python` sí).
let pyBin = run(defaultPyBin, ['--version']) ? defaultPyBin : null;
if (!pyBin) {
  const candidates =
    target === 'win'
      ? [defaultPyBin, 'py -3.12', 'python3.12', 'python']
      : [defaultPyBin, 'python3.12', 'python3', 'python'];
  const alt = candidates.find((c) => is312(run(c, ['--version'])));
  if (alt) {
    pyBin = alt;
    warn(
      `"${defaultPyBin}" no está en el PATH — usá:  make dist-${target} PYTHON_BIN="${alt}"`,
    );
  }
}
const pyVer = pyBin ? run(pyBin, ['--version']) : null;

if (!pyVer) {
  err(
    `Python no encontrado como "${defaultPyBin}" — instalá Python 3.12 y agregalo al PATH` +
      (target === 'win'
        ? ' (el instalador oficial NO registra `python3`/`python3.12`; usá `python` o pasá PYTHON_BIN=...)'
        : ' (o pasá PYTHON_BIN=python)'),
  );
} else {
  if (is312(pyVer)) ok(`${pyVer} (${pyBin})`);
  else {
    // No es negociable: numpy==1.26.4 solo tiene wheels hasta cp312 y opencv
    // 4.10 está atado a la ABI de numpy 1.x. Con otra minor, pip cae a
    // compilar numpy desde source (necesita MSVC/gcc) y revienta.
    err(
      `${pyVer} (${pyBin}) — el proyecto REQUIERE Python 3.12 (numpy 1.26.4 no tiene wheels para otra minor). ` +
        (target === 'win'
          ? 'Instalá 3.12 (`winget install Python.Python.3.12`) y corré:  make dist-win PYTHON_BIN="py -3.12"'
          : 'Instalá 3.12 y pasá PYTHON_BIN apuntando a ese binario.'),
    );
  }

  // venv + ensurepip: sin esto `python -m venv` no arma un venv usable.
  const venvOk = run(pyBin, ['-c', 'import venv, ensurepip']);
  if (venvOk === '') ok('módulo venv + ensurepip disponibles');
  else
    err(
      `${pyBin} no tiene venv/ensurepip — en Debian/Ubuntu: sudo apt install python3.12-venv`,
    );

  // Windows: el alias `python` puede ser el stub de Microsoft Store.
  const pyExe = run(pyBin, ['-c', 'import sys; print(sys.executable)']) || '';
  if (target === 'win' && /WindowsApps/i.test(pyExe)) {
    err(
      '`python` apunta al stub de Microsoft Store — instalá Python 3.12 desde python.org y desactivá el alias en "Configuración → Alias de ejecución de aplicaciones"',
    );
  }
}

// ── bash ─────────────────────────────────────────────────────────────────────
// services/*/Makefile tienen `SHELL := bash`; sin bash en el PATH ni arrancan.
const bash = run('bash', ['--version']);
if (bash) ok(bash.split('\n')[0]);
else
  err(
    'bash no encontrado — los Makefiles de services/* lo necesitan (en Windows: Git Bash o WSL)',
  );

// ── GNU make ─────────────────────────────────────────────────────────────────
const mk = run('make', ['--version']);
if (mk && /GNU Make/.test(mk)) ok(mk.split('\n')[0]);
else if (mk)
  warn(
    'make encontrado pero no parece GNU Make — algunos targets usan sintaxis GNU',
  );
else
  warn('no pude verificar make (raro si estás leyendo esto vía `make doctor`)');

// ── upx (opcional) ───────────────────────────────────────────────────────────
const upx = run('upx', ['--version']);
if (upx) ok(`upx ${upx.split('\n')[0].replace(/^upx\s+/i, '')}`);
else
  warn(
    'upx no encontrado — los build.spec tienen upx=True; PyInstaller lo saltea (binarios más pesados, no es fatal)',
  );

// ── git (opcional) ───────────────────────────────────────────────────────────
const git = run('git', ['--version']);
if (git) ok(git);
else warn('git no encontrado');

// ── .env ─────────────────────────────────────────────────────────────────────
if (existsSync('.env')) ok('.env presente');
else
  warn(
    '.env ausente — corré `make env-use-prod` (o `env-use-local`) antes de empaquetar',
  );

// ── Windows: Visual Studio Build Tools (heurística) ──────────────────────────
if (target === 'win') {
  const vswhere =
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (existsSync(vswhere)) {
    const vc = run(vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ]);
    if (vc) ok('Visual Studio Build Tools con workload C++');
    else
      warn(
        'VS Build Tools sin workload "Desktop development with C++" — solo hace falta si @electron/rebuild compila un módulo nativo',
      );
  } else {
    warn(
      'no detecté VS Build Tools — solo hace falta si @electron/rebuild compila un módulo nativo',
    );
  }
}

// ── Windows: permiso para crear symlinks ────────────────────────────────────
// electron-builder extrae winCodeSign (trae rcedit) con 7za, y ese archivo
// tiene symlinks. Sin "Modo de desarrollador" o consola de Administrador,
// Windows rechaza la creación de symlinks y el build aborta.
if (target === 'win' && process.platform === 'win32') {
  const reg = run('reg', [
    'query',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock',
    '/v',
    'AllowDevelopmentWithoutDevLicense',
  ]);
  const devMode = /AllowDevelopmentWithoutDevLicense\s+REG_DWORD\s+0x1/i.test(reg || '');
  const isAdmin = run('net', ['session']) !== null; // net session solo corre elevado
  if (devMode || isAdmin) {
    ok(`creación de symlinks OK (${devMode ? 'Modo de desarrollador' : 'consola de Administrador'})`);
  } else {
    err(
      'no podés crear symlinks — electron-builder falla extrayendo winCodeSign. ' +
        'Activá "Configuración → Para desarrolladores → Modo de desarrollador", ' +
        'o corré el build desde una Git Bash abierta como Administrador',
    );
  }
}

// ── resumen ──────────────────────────────────────────────────────────────────
console.log();
if (errors > 0) {
  console.error(
    `\x1b[31m✗ ${errors} problema(s) bloqueante(s)${warns ? `, ${warns} advertencia(s)` : ''}.\x1b[0m ` +
      `Resolvé lo de arriba antes de \`make dist-${target}\`.`,
  );
  process.exit(1);
}
console.log(
  `\x1b[32m✓ entorno OK para \`make dist-${target}\`\x1b[0m` +
    (warns ? ` (${warns} advertencia/s no bloqueante/s)` : ''),
);
