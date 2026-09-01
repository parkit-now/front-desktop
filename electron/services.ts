import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface ServiceConfig {
  name: string;
  port: number;
  /** Extra env vars merged into the child process environment. */
  env?: Record<string, string>;
}

const MAX_SPAWN_RETRIES = 2; // 3 total attempts (0, 1, 2)
const RETRY_DELAY_MS = 2_000;
const HEALTH_TIMEOUT_MS = 10_000; // per attempt
const HEALTH_POLL_MS = 500;
// Budget: PROCESS_LOOP_SHUTDOWN_TIMEOUT (3s, camera main.py) + watchdog.stop()
// join (2s) + capture.stop() join (2s) + storage.close()'s WAL checkpoint,
// bounded by sqlite3's default 5s busy_timeout if the db is briefly locked.
const SHUTDOWN_TIMEOUT_MS = 12_000;
const SHUTDOWN_TOKEN_ENV = 'PARKIT_SHUTDOWN_TOKEN';
const SHUTDOWN_TOKEN_HEADER = 'X-Parkit-Shutdown-Token';

/**
 * Manages the lifecycle of Python microservices spawned by Electron.
 *
 * In dev mode (app.isPackaged === false) all methods are no-ops: developers
 * start services manually via `make lpr-dev` / `make camera-dev`.
 *
 * In production the binaries are expected at process.resourcesPath/<name>[.exe],
 * placed there by electron-builder's extraResources config.
 */
export class ServiceManager {
  private readonly processes = new Map<string, ChildProcess>();
  private readonly failed = new Set<string>();
  private readonly healthy = new Set<string>();
  private readonly shutdownToken: string;

  constructor(
    private readonly services: ServiceConfig[],
    shutdownToken = randomBytes(32).toString('hex'),
  ) {
    this.shutdownToken = shutdownToken;
  }

  spawnAll(): void {
    if (!app.isPackaged) return;
    for (const svc of this.services) {
      this.spawnOne(svc);
    }
  }

  private spawnOne(svc: ServiceConfig): void {
    // Kill any previous instance before respawning (used on retry).
    const existing = this.processes.get(svc.name);
    if (existing && !existing.killed) existing.kill();

    const ext = process.platform === 'win32' ? '.exe' : '';
    const bin = path.join(process.resourcesPath, `${svc.name}${ext}`);

    const proc = spawn(bin, [String(svc.port)], {
      stdio: 'pipe',
      env: {
        ...process.env,
        ...(svc.env ?? {}),
        [SHUTDOWN_TOKEN_ENV]: this.shutdownToken,
      },
    });

    proc.stdout?.on('data', (d: Buffer) =>
      process.stdout.write(`[${svc.name}] ${d.toString()}`),
    );
    proc.stderr?.on('data', (d: Buffer) =>
      process.stderr.write(`[${svc.name}] ${d.toString()}`),
    );

    // Catch ENOENT (binary missing) and other OS-level spawn failures so they
    // don't surface as an unhandled 'error' event and crash the main process.
    proc.on('error', (err) => {
      console.error(`[${svc.name}] spawn error: ${err.message}`);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[${svc.name}] exited unexpectedly with code ${code}`);
        // Only notify the renderer for services that were previously healthy —
        // startup failures are already surfaced via waitAllHealthy / services:failed.
        if (this.healthy.has(svc.name)) {
          BrowserWindow.getAllWindows().forEach((win) =>
            win.webContents.send('services:crashed', svc.name),
          );
        }
      } else {
        console.log(`[${svc.name}] exited with code ${code}`);
      }
    });

    this.processes.set(svc.name, proc);
    console.log(
      `[main] spawned ${svc.name} on port ${svc.port} (pid ${proc.pid})`,
    );
  }

  /**
   * Polls each service's /health endpoint until it responds 200 or the
   * timeout expires. Retries up to MAX_SPAWN_RETRIES times (killing and
   * respawning the process between attempts) before marking as failed.
   * Returns the names of services that failed all attempts.
   */
  async waitAllHealthy(): Promise<string[]> {
    await Promise.all(
      this.services.map(async (svc) => {
        for (let attempt = 0; attempt <= MAX_SPAWN_RETRIES; attempt++) {
          if (attempt > 0) {
            console.log(
              `[${svc.name}] retrying (attempt ${attempt + 1}/${MAX_SPAWN_RETRIES + 1})…`,
            );
            const proc = this.processes.get(svc.name);
            if (proc && !proc.killed) proc.kill();
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            this.spawnOne(svc);
          }

          const ok = await this.pollHealth(svc.port);
          if (ok) {
            this.healthy.add(svc.name);
            return;
          }

          console.error(
            `[${svc.name}] health check failed (attempt ${attempt + 1}/${MAX_SPAWN_RETRIES + 1})`,
          );
        }

        this.failed.add(svc.name);
      }),
    );
    return [...this.failed];
  }

  private async pollHealth(port: number): Promise<boolean> {
    const url = `http://127.0.0.1:${port}/health`;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) return true;
      } catch {
        // service not ready yet — keep polling
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }
    return false;
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
