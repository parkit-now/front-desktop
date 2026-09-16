import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export type ServiceName = 'lpr-service' | 'camera-service';

/** Where a launcher came from — for startup logs / debugging only. */
export type LauncherSource =
  | 'env' // PARKIT_LPR_CMD / PARKIT_CAMERA_CMD
  | 'packaged' // bundled binary in process.resourcesPath
  | 'built-binary' // services/<svc>/dist/<name> (e.g. `make prod`)
  | 'dev-source'; // services/<svc> venv `python main.py`

export interface ServiceLauncher {
  cmd: string;
  /** Args before the port, which is always appended as the final arg. */
  args: string[];
  cwd: string;
  /** Extra env baked into the launch (merged under process.env). */
  env?: Record<string, string>;
  source: LauncherSource;
}

export interface ServiceRuntime {
  /**
   * Whether this process supervises the sidecars. `false` means someone else
   * runs them (`make dev`, a debugger, a remote host) — the renderer still
   * talks to them over HTTP, it just isn't responsible for their lifecycle.
   */
  manage: boolean;
  /** Launch spec per service. A missing entry = that service is not managed. */
  launchers: Partial<Record<ServiceName, ServiceLauncher>>;
}

/** Directory under `services/` that holds each service's source, venv and dist. */
const SERVICE_SUBDIR: Record<ServiceName, string> = {
  'lpr-service': 'lpr',
  'camera-service': 'camera',
};

const ENV_CMD_VAR: Record<ServiceName, string> = {
  'lpr-service': 'PARKIT_LPR_CMD',
  'camera-service': 'PARKIT_CAMERA_CMD',
};

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null || value.trim() === '') return undefined;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

/** Repo root when running unpackaged: `dist/main/serviceRuntime.js` → `../..`. */
function repoRoot(): string {
  return path.resolve(dirname, '..', '..');
}

function servicesDir(): string {
  const override = process.env.PARKIT_SERVICES_DIR?.trim();
  return override ? path.resolve(override) : path.join(repoRoot(), 'services');
}

function exeExt(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

/**
 * Env that a service always needs on a given platform, regardless of how it is
 * launched. Kept here so "how to run the camera service" has one source of
 * truth. Runtime-dependent env (writable data dirs, etc.) is layered on later
 * by the caller.
 */
function baseEnv(name: ServiceName): Record<string, string> | undefined {
  const env: Record<string, string> = {
    // Windows child processes launched with piped stdio can default to a legacy
    // code page. The camera service prints a Unicode startup banner; forcing
    // UTF-8 prevents a UnicodeEncodeError before /health ever becomes ready.
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };

  if (name === 'camera-service' && process.platform === 'darwin') {
    // OpenCV's AVFoundation backend blocks on an auth dialog that can't be
    // shown from a background thread; this flag skips it. No-op elsewhere.
    env.OPENCV_AVFOUNDATION_SKIP_AUTH = '1';
  }

  return env;
}

function fromEnvVar(name: ServiceName): ServiceLauncher | null {
  const raw = process.env[ENV_CMD_VAR[name]]?.trim();
  if (!raw) return null;
  // Our launch commands are an absolute path plus plain flags — no shell
  // quoting to worry about, so a whitespace split is sufficient.
  const [cmd, ...args] = raw.split(/\s+/);
  return {
    cmd,
    args,
    cwd: process.env.PARKIT_SERVICES_DIR?.trim() || repoRoot(),
    env: baseEnv(name),
    source: 'env',
  };
}

function fromPackagedBinary(name: ServiceName): ServiceLauncher {
  return {
    cmd: path.join(process.resourcesPath, `${name}${exeExt()}`),
    args: [],
    cwd: process.resourcesPath,
    env: baseEnv(name),
    source: 'packaged',
  };
}

function fromUnpackagedSources(name: ServiceName): ServiceLauncher | null {
  const root = path.join(servicesDir(), SERVICE_SUBDIR[name]);

  // Source first: an unpackaged run is by definition a working tree, and the
  // source is its single source of truth. The PyInstaller binary under dist/
  // is a release artifact that is only rebuilt by hand (`make services-build`),
  // so preferring it here means a months-old build can silently shadow a
  // working `main.py`. True packaged parity comes from a real bundle
  // (`app.isPackaged` → process.resourcesPath), not from this path.
  const venvPython =
    process.platform === 'win32'
      ? path.join(root, '.venv', 'Scripts', 'python.exe')
      : path.join(root, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return {
      cmd: venvPython,
      args: ['main.py'],
      cwd: root,
      env: baseEnv(name),
      source: 'dev-source',
    };
  }

  // Fallback: no venv (deps not installed) but a binary was built/copied in.
  // Use PARKIT_<SVC>_CMD to force the binary when you want to smoke-test it.
  const binary = path.join(root, 'dist', `${name}${exeExt()}`);
  if (fs.existsSync(binary)) {
    return {
      cmd: binary,
      args: [],
      cwd: root,
      env: baseEnv(name),
      source: 'built-binary',
    };
  }

  return null;
}

function resolveLauncher(name: ServiceName): ServiceLauncher | null {
  return (
    fromEnvVar(name) ??
    (app.isPackaged ? fromPackagedBinary(name) : fromUnpackagedSources(name))
  );
}

/**
 * Decides, from configuration and environment, whether this process supervises
 * the camera / LPR sidecars and how to launch each one.
 *
 * Precedence (12-factor III — config lives in the environment):
 *   1. `PARKIT_MANAGE_SERVICES=0` → never manage; the sidecars are someone
 *      else's responsibility (`make dev`, a debugger, a remote host).
 *   2. `PARKIT_LPR_CMD` / `PARKIT_CAMERA_CMD` → explicit launch command.
 *   3. Packaged app → bundled binary in `process.resourcesPath`.
 *   4. Unpackaged → the venv `python main.py` from source, else
 *      `services/<svc>/dist/<name>` if a binary was built.
 *   5. Nothing resolvable → don't manage that service; the renderer surfaces
 *      the services-unavailable state and the user starts it by hand.
 *
 * `app.isPackaged` only selects the *default* source in step 3/4 — it is not a
 * gate on whether supervision happens at all. That keeps `make prod`, a
 * packaged build and `make dev` on the same code path (12-factor X, dev/prod
 * parity): the only thing that varies is which executable gets launched.
 */
export function resolveServiceRuntime(
  names: ServiceName[] = ['lpr-service', 'camera-service'],
): ServiceRuntime {
  if (parseBool(process.env.PARKIT_MANAGE_SERVICES) === false) {
    return { manage: false, launchers: {} };
  }

  const launchers: Partial<Record<ServiceName, ServiceLauncher>> = {};
  for (const name of names) {
    const launcher = resolveLauncher(name);
    if (launcher) launchers[name] = launcher;
  }

  return { manage: Object.keys(launchers).length > 0, launchers };
}
