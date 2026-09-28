import { BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ServiceLauncher } from './serviceRuntime.js';

export interface ServiceConfig {
  name: string;
  port: number;
  /** How to launch the process — resolved by `resolveServiceRuntime`. */
  launcher: ServiceLauncher;
  /**
   * Runtime-dependent env merged on top of `launcher.env` (e.g. writable data
   * dirs that are only known after `app.whenReady`).
   */
  env?: Record<string, string>;
  /** Optional persistent log file for packaged troubleshooting. */
  logPath?: string;
}

export type ManagedServiceState =
  | 'managed'
  | 'adopted'
  | 'unavailable'
  | 'running'
  | 'stopped'
  | 'failed';

export interface ManagedServiceStatus {
  name: string;
  state: ManagedServiceState;
  healthy: boolean;
  pid: number | null;
  lastError?: string;
}

// A PyInstaller onefile binary (numpy + opencv + onnxruntime, ~100 MB)
// unpacks to a temp dir on first launch — cold start can take a minute. Give
// startup a long grace window (like a k8s startupProbe) and never kill a
// process that is merely slow; only respawn one that actually exited.
const STARTUP_GRACE_MS = 90_000;
const RESPAWN_DELAY_MS = 2_000;
const MAX_RESPAWNS = 2;
const HEALTH_POLL_MS = 500;
// Budget: PROCESS_LOOP_SHUTDOWN_TIMEOUT (3s, camera main.py) + watchdog.stop()
// join (2s) + capture.stop() join (2s) + storage.close()'s WAL checkpoint,
// bounded by sqlite3's default 5s busy_timeout if the db is briefly locked.
const SHUTDOWN_TIMEOUT_MS = 12_000;
const SHUTDOWN_TOKEN_ENV = 'PARKIT_SHUTDOWN_TOKEN';
const SHUTDOWN_TOKEN_HEADER = 'X-Parkit-Shutdown-Token';

/**
 * Supervises the lifecycle of the camera / LPR sidecar processes.
 *
 * The manager is deliberately dumb about *where* a service comes from: it is
 * handed a fully-resolved `launcher` per service (see `serviceRuntime.ts`) and
 * only owns spawning, health-checking with retry, and cooperative shutdown.
 * Whether supervision happens at all is decided by the caller (an empty
 * service list = nothing to manage).
 */
export class ServiceManager {
  private readonly processes = new Map<string, ChildProcess>();
  private readonly failed = new Set<string>();
  private readonly healthy = new Set<string>();
  private readonly spawnErrors = new Set<string>();
  private readonly lastErrors = new Map<string, string>();
  /** Services already listening when we started — not ours to spawn or stop. */
  private readonly adopted = new Set<string>();
  private readonly shutdownToken: string;

  constructor(
    private readonly services: ServiceConfig[],
    shutdownToken = randomBytes(32).toString('hex'),
  ) {
    this.shutdownToken = shutdownToken;
  }

  /**
   * Starts every service, or adopts one that is already healthy on its port.
   *
   * Idempotent supervision (crash-only): a port answering `/health` is a
   * healthy service no matter who started it — a leftover from a `kill -9`ed
   * run, a manual `make *-dev`, a debugger. Spawning over it would just hit
   * EADDRINUSE and get marked failed. We adopt it instead (and leave it be on
   * shutdown, since its lifecycle isn't ours). Same idea as a kubelet picking
   * up already-running containers after a restart.
   */
  async spawnAll(): Promise<void> {
    await Promise.all(
      this.services.map(async (svc) => {
        if (await this.pingHealth(svc.port)) {
          this.adopted.add(svc.name);
          this.healthy.add(svc.name);
          console.warn(
            `[main] adopted an already-running ${svc.name} on :${svc.port} ` +
              `— started externally, will not be stopped on quit`,
          );
          return;
        }
        this.spawnOne(svc);
      }),
    );
  }

  getServiceStatus(name: string): ManagedServiceStatus {
    const svc = this.serviceByName(name);
    if (!svc) {
      return {
        name,
        state: 'unavailable',
        healthy: false,
        pid: null,
        lastError: 'service_not_configured',
      };
    }

    const proc = this.processes.get(name);
    const alive = Boolean(proc && proc.exitCode === null && !proc.killed);
    const healthy = this.healthy.has(name);

    if (this.adopted.has(name)) {
      return {
        name,
        state: 'adopted',
        healthy,
        pid: null,
        lastError: this.lastErrors.get(name),
      };
    }

    if (alive) {
      return {
        name,
        state: this.failed.has(name)
          ? 'failed'
          : healthy
            ? 'running'
            : 'managed',
        healthy,
        pid: proc?.pid ?? null,
        lastError: this.lastErrors.get(name),
      };
    }

    return {
      name,
      state: this.failed.has(name) ? 'failed' : 'stopped',
      healthy: false,
      pid: null,
      lastError: this.lastErrors.get(name),
    };
  }

  async startService(name: string): Promise<ManagedServiceStatus> {
    const svc = this.serviceByName(name);
    if (!svc) return this.getServiceStatus(name);
    if (this.adopted.has(name)) return this.getServiceStatus(name);

    const proc = this.processes.get(name);
    if (proc && proc.exitCode === null && !proc.killed) {
      await this.awaitHealthy(svc, { allowRespawn: false });
      return this.getServiceStatus(name);
    }

    this.clearRuntimeState(name);
    if (await this.pingHealth(svc.port)) {
      this.adopted.add(name);
      this.healthy.add(name);
      return this.getServiceStatus(name);
    }

    this.spawnOne(svc);
    await this.awaitHealthy(svc, { allowRespawn: false });
    return this.getServiceStatus(name);
  }

  async restartService(name: string): Promise<ManagedServiceStatus> {
    const svc = this.serviceByName(name);
    if (!svc) return this.getServiceStatus(name);
    if (this.adopted.has(name)) return this.getServiceStatus(name);

    const proc = this.processes.get(name);
    if (proc && proc.exitCode === null && !proc.killed) {
      await this.stopOne(svc, proc);
    }

    this.processes.delete(name);
    this.clearRuntimeState(name);
    this.spawnOne(svc);
    await this.awaitHealthy(svc, { allowRespawn: false });
    return this.getServiceStatus(name);
  }

  private serviceByName(name: string): ServiceConfig | undefined {
    return this.services.find((svc) => svc.name === name);
  }

  private clearRuntimeState(name: string): void {
    this.failed.delete(name);
    this.healthy.delete(name);
    this.spawnErrors.delete(name);
    this.lastErrors.delete(name);
  }

  private async pingHealth(port: number): Promise<boolean> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1_500);
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: ac.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  private spawnOne(svc: ServiceConfig): void {
    // Kill any previous instance before respawning (used on retry).
    const existing = this.processes.get(svc.name);
    if (existing && !existing.killed) existing.kill();

    const { launcher } = svc;
    // The port is always the final argument (matches every launcher: the
    // PyInstaller binary, `python main.py <port>`, and an env-var command).
    const args = [...launcher.args, String(svc.port)];

    const proc = spawn(launcher.cmd, args, {
      cwd: launcher.cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...(launcher.env ?? {}),
        ...(svc.env ?? {}),
        [SHUTDOWN_TOKEN_ENV]: this.shutdownToken,
      },
      windowsHide: true,
    });
    const logStream = this.openLogStream(svc);

    proc.stdout?.on('data', (d: Buffer) => {
      const output = `[${svc.name}] ${d.toString()}`;
      process.stdout.write(output);
      logStream?.write(output);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const output = `[${svc.name}] ${d.toString()}`;
      process.stderr.write(output);
      logStream?.write(output);
    });

    // Catch ENOENT (binary missing) and other OS-level spawn failures so they
    // don't surface as an unhandled 'error' event and crash the main process.
    proc.on('error', (err) => {
      const message = `[${svc.name}] spawn error: ${err.message}`;
      this.spawnErrors.add(svc.name);
      this.failed.add(svc.name);
      this.lastErrors.set(svc.name, err.message);
      console.error(message);
      logStream?.write(`${message}\n`);
    });

    proc.on('exit', (code) => {
      const wasHealthy = this.healthy.has(svc.name);
      this.healthy.delete(svc.name);
      if (code !== 0 && code !== null) {
        const message = `[${svc.name}] exited unexpectedly with code ${code}`;
        console.error(message);
        logStream?.write(`${message}\n`);
        this.failed.add(svc.name);
        this.lastErrors.set(svc.name, `exited_${code}`);
        // Only notify the renderer for services that were previously healthy —
        // startup failures are already surfaced via waitAllHealthy / services:failed.
        if (wasHealthy) {
          BrowserWindow.getAllWindows().forEach((win) =>
            win.webContents.send('services:crashed', svc.name),
          );
        }
      } else {
        const message = `[${svc.name}] exited with code ${code}`;
        console.log(message);
        logStream?.write(`${message}\n`);
      }
      logStream?.end();
    });

    this.processes.set(svc.name, proc);
    console.log(
      `[main] spawned ${svc.name} on port ${svc.port} (pid ${proc.pid}) ` +
        `via ${launcher.source}: ${launcher.cmd}`,
    );
    logStream?.write(
      `\n${new Date().toISOString()} spawned ${svc.name} on :${svc.port} ` +
        `via ${launcher.source}: ${launcher.cmd} ${args.join(' ')}\n`,
    );
  }

  private openLogStream(svc: ServiceConfig): fs.WriteStream | null {
    if (!svc.logPath) return null;

    try {
      fs.mkdirSync(path.dirname(svc.logPath), { recursive: true });
      return fs.createWriteStream(svc.logPath, { flags: 'a' });
    } catch (error) {
      console.warn(
        `[${svc.name}] could not open service log: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Waits (up to STARTUP_GRACE_MS) for every service's `/health` to answer 200.
   * A process that is merely slow to boot is left alone; one that *exits*
   * during startup is respawned up to MAX_RESPAWNS times. Returns the names
   * that never became healthy.
   */
  async waitAllHealthy(): Promise<string[]> {
    await Promise.all(this.services.map((svc) => this.awaitHealthy(svc)));
    return [...this.failed];
  }

  private async awaitHealthy(
    svc: ServiceConfig,
    options: { allowRespawn?: boolean } = {},
  ): Promise<void> {
    // Adopted (or otherwise already-verified) services need no polling.
    if (this.healthy.has(svc.name)) return;

    let respawns = 0;
    const deadline = Date.now() + STARTUP_GRACE_MS;
    const allowRespawn = options.allowRespawn ?? true;

    while (Date.now() < deadline) {
      if (this.spawnErrors.has(svc.name)) break;

      const proc = this.processes.get(svc.name);

      if (proc && proc.exitCode !== null) {
        // Actually crashed while starting — respawn, bounded.
        if (!allowRespawn || respawns >= MAX_RESPAWNS) break;
        respawns += 1;
        console.warn(
          `[${svc.name}] exited during startup — respawn ${respawns}/${MAX_RESPAWNS}`,
        );
        await new Promise((r) => setTimeout(r, RESPAWN_DELAY_MS));
        this.spawnOne(svc);
        continue;
      }

      try {
        const res = await fetch(`http://127.0.0.1:${svc.port}/health`);
        if (res.ok) {
          this.healthy.add(svc.name);
          this.failed.delete(svc.name);
          this.spawnErrors.delete(svc.name);
          this.lastErrors.delete(svc.name);
          return;
        }
      } catch {
        // not up yet — keep polling
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }

    console.error(
      `[${svc.name}] not healthy after ${Math.round(STARTUP_GRACE_MS / 1000)}s`,
    );
    this.failed.add(svc.name);
    this.lastErrors.set(svc.name, 'health_timeout');
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.services.flatMap((svc) => {
        const proc = this.processes.get(svc.name);
        return proc ? [this.stopOne(svc, proc)] : [];
      }),
    );
    this.processes.clear();
  }

  /**
   * Requests a graceful shutdown via the service's own /shutdown endpoint
   * instead of an OS signal: on Windows, ChildProcess.kill() ignores the
   * signal argument and always force-kills (TerminateProcess), which would
   * skip the Python-side cleanup entirely on that platform. Falls back to
   * SIGKILL if the process hasn't exited by SHUTDOWN_TIMEOUT_MS (service
   * unresponsive, /shutdown request failed, etc).
   */
  private stopOne(svc: ServiceConfig, proc: ChildProcess): Promise<void> {
    if (proc.killed || proc.exitCode !== null) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        if (!proc.killed && proc.exitCode === null) {
          console.warn(`[${svc.name}] graceful shutdown timed out; killing`);
          proc.kill('SIGKILL');
        }
        finish();
      }, SHUTDOWN_TIMEOUT_MS);

      proc.once('exit', finish);

      fetch(`http://127.0.0.1:${svc.port}/shutdown`, {
        method: 'POST',
        headers: { [SHUTDOWN_TOKEN_HEADER]: this.shutdownToken },
      })
        .then((res) => {
          if (!res.ok) {
            console.warn(
              `[${svc.name}] /shutdown rejected with HTTP ${res.status}`,
            );
          }
        })
        .catch((err: unknown) => {
          console.warn(
            `[${svc.name}] /shutdown request failed: ${(err as Error).message}`,
          );
        });
    });
  }
}
