import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface ServiceConfig {
  name: string;
  port: number;
  /** Extra env vars merged into the child process environment. */
  env?: Record<string, string>;
}

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

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
  private readonly processes: ChildProcess[] = [];
  private readonly failed: string[] = [];

  constructor(private readonly services: ServiceConfig[]) {}

  spawnAll(): void {
    if (!app.isPackaged) return;

    for (const svc of this.services) {
      const ext = process.platform === 'win32' ? '.exe' : '';
      const bin = path.join(process.resourcesPath, `${svc.name}${ext}`);

      const proc = spawn(bin, [String(svc.port)], {
        stdio: 'pipe',
        env: { ...process.env, ...(svc.env ?? {}) },
      });

      proc.stdout?.on('data', (d: Buffer) =>
        process.stdout.write(`[${svc.name}] ${d.toString()}`),
      );
      proc.stderr?.on('data', (d: Buffer) =>
        process.stderr.write(`[${svc.name}] ${d.toString()}`),
      );
      proc.on('exit', (code) =>
        console.log(`[${svc.name}] exited with code ${code}`),
      );

      this.processes.push(proc);
      console.log(
        `[main] spawned ${svc.name} on port ${svc.port} (pid ${proc.pid})`,
      );
    }
  }

  /**
   * Polls each service's /health endpoint until it responds 200 or the
   * timeout expires. Returns the names of services that failed to become
   * healthy so the caller can surface them to the user.
   */
  async waitAllHealthy(): Promise<string[]> {
    await Promise.all(
      this.services.map(async (svc) => {
        const url = `http://127.0.0.1:${svc.port}/health`;
        const deadline = Date.now() + HEALTH_TIMEOUT_MS;

        while (Date.now() < deadline) {
          try {
            const res = await fetch(url);
            if (res.ok) return;
          } catch {
            // service not ready yet — keep polling
          }
          await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
        }

        console.error(`[main] ${svc.name} did not become healthy in time`);
        this.failed.push(svc.name);
      }),
    );
    return [...this.failed];
  }

  stopAll(): void {
    for (const proc of this.processes) {
      if (!proc.killed) proc.kill();
    }
  }
}
