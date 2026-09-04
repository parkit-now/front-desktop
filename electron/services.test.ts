// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceManager, type ServiceConfig } from './services.js';
import type { ServiceLauncher } from './serviceRuntime.js';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

// vi.hoisted ensures mockSpawn is initialized before vi.mock factories run.
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

const launcher: ServiceLauncher = {
  cmd: '/fake/lpr-service',
  args: [],
  cwd: '/fake',
  source: 'built-binary',
};

function config(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return { name: 'lpr-service', port: 8765, launcher, ...overrides };
}

// ── Fake ChildProcess ──────────────────────────────────────────────────────

class FakeProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  readonly pid = 1234;

  kill(): void {
    if (!this.killed) {
      this.killed = true;
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  mockSpawn.mockReset();
  mockSpawn.mockReturnValue(new FakeProcess());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ServiceManager — spawn', () => {
  it('launches each service via its resolved launcher, port as the last arg', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const manager = new ServiceManager([
      config({
        launcher: {
          cmd: '/venv/bin/python',
          args: ['main.py'],
          cwd: '/repo/services/lpr',
          source: 'dev-source',
        },
      }),
    ]);
    manager.spawnAll();

    const [cmd, args, options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string },
    ];
    expect(cmd).toBe('/venv/bin/python');
    expect(args).toEqual(['main.py', '8765']);
    expect(options.cwd).toBe('/repo/services/lpr');
  });
});

describe('ServiceManager — retry on startup', () => {
  it('marks service as healthy when it responds on the first attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const manager = new ServiceManager([config()]);
    manager.spawnAll();

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('retries once and marks healthy when the second attempt succeeds', async () => {
    // Fail while only the initial spawn exists; succeed after the retry respawn.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        if (mockSpawn.mock.calls.length < 2)
          return Promise.reject(new Error('not ready'));
        return Promise.resolve({ ok: true } as Response);
      }),
    );

    const manager = new ServiceManager([config()]);
    manager.spawnAll();

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('marks service as failed after all 3 attempts time out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('service down')),
    );

    const manager = new ServiceManager([config()]);
    manager.spawnAll();

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual(['lpr-service']);
    expect(mockSpawn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe('ServiceManager — shutdown', () => {
  it('passes a per-run shutdown token to spawned services', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const manager = new ServiceManager(
      [config({ env: { EXTRA: '1' } })],
      'test-token',
    );
    manager.spawnAll();

    const [, , options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(options.env).toEqual(
      expect.objectContaining({
        EXTRA: '1',
        PARKIT_SHUTDOWN_TOKEN: 'test-token',
      }),
    );
  });

  it('requests cooperative shutdown with the shutdown token header', async () => {
    const proc = new FakeProcess();
    mockSpawn.mockReturnValue(proc);
    const fetchMock = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.exitCode = 0;
        proc.emit('exit', 0, null);
      });
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ServiceManager([config()], 'test-token');
    manager.spawnAll();

    const done = manager.stopAll();
    await done;

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8765/shutdown', {
      method: 'POST',
      headers: { 'X-Parkit-Shutdown-Token': 'test-token' },
    });
    expect(proc.killed).toBe(false);
  });

  it('force-kills the process if cooperative shutdown never exits', async () => {
    const proc = new FakeProcess();
    mockSpawn.mockReturnValue(proc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const manager = new ServiceManager([config()], 'test-token');
    manager.spawnAll();

    const done = manager.stopAll();
    await vi.runAllTimersAsync();
    await done;

    expect(proc.killed).toBe(true);
  });
});
