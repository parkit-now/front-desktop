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

/**
 * Routes `fetch` by URL. `/health` defaults to failing so `spawnAll` actually
 * spawns (rather than adopting); pass `health: 'ok'` to exercise adoption.
 */
function stubFetch(
  opts: {
    health?: 'ok' | 'down';
    onShutdown?: () => void;
  } = {},
) {
  const health = opts.health ?? 'down';
  const fn = vi.fn((url: string) => {
    if (url.endsWith('/health')) {
      return health === 'ok'
        ? Promise.resolve({ ok: true } as Response)
        : Promise.reject(new Error('down'));
    }
    opts.onShutdown?.(); // /shutdown
    return Promise.resolve({ ok: true } as Response);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
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
  it('launches each service via its resolved launcher, port as the last arg', async () => {
    stubFetch();

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
    await manager.spawnAll();

    const [cmd, args, options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string },
    ];
    expect(cmd).toBe('/venv/bin/python');
    expect(args).toEqual(['main.py', '8765']);
    expect(options.cwd).toBe('/repo/services/lpr');
  });

  it('adopts an already-running service instead of spawning over it', async () => {
    stubFetch({ health: 'ok' });

    const manager = new ServiceManager([config()]);
    await manager.spawnAll();
    const failed = await manager.waitAllHealthy();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
  });
});

describe('ServiceManager — startup wait', () => {
  it('goes healthy once /health answers, without respawning a slow process', async () => {
    // Ping (pre-spawn) fails so it spawns; then /health answers ok.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        mockSpawn.mock.calls.length === 0
          ? Promise.reject(new Error('not ready'))
          : Promise.resolve({ ok: true } as Response),
      ),
    );

    const manager = new ServiceManager([config()]);
    await manager.spawnAll();

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(1); // never killed/respawned
  });

  it('does NOT respawn a process that is alive but slow to boot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('booting')));

    const manager = new ServiceManager([config()]);
    await manager.spawnAll();

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual(['lpr-service']); // gave up after the grace window
    expect(mockSpawn).toHaveBeenCalledTimes(1); // alive → not respawned
  });

  it('respawns a service that exits during startup, then goes healthy', async () => {
    const procs: FakeProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const p = new FakeProcess();
      procs.push(p);
      return p;
    });
    // Ping fails; /health fails until the 2nd process exists.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        procs.length >= 2
          ? Promise.resolve({ ok: true } as Response)
          : Promise.reject(new Error('down')),
      ),
    );

    const manager = new ServiceManager([config()]);
    await manager.spawnAll();
    // First process crashes mid-startup.
    procs[0].exitCode = 1;
    procs[0].emit('exit', 1, null);

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(2); // initial + 1 respawn
  });

  it('gives up after MAX_RESPAWNS repeated crashes', async () => {
    const procs: FakeProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const p = new FakeProcess();
      p.exitCode = 1; // every spawn is already dead
      procs.push(p);
      return p;
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const manager = new ServiceManager([config()]);
    await manager.spawnAll();

    const done = manager.waitAllHealthy();
    await vi.runAllTimersAsync();

    expect(await done).toEqual(['lpr-service']);
    expect(mockSpawn).toHaveBeenCalledTimes(3); // initial + 2 respawns
  });
});

describe('ServiceManager — shutdown', () => {
  it('passes a per-run shutdown token to spawned services', async () => {
    stubFetch();

    const manager = new ServiceManager(
      [config({ env: { EXTRA: '1' } })],
      'test-token',
    );
    await manager.spawnAll();

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
    const fetchMock = stubFetch({
      onShutdown: () => {
        queueMicrotask(() => {
          proc.exitCode = 0;
          proc.emit('exit', 0, null);
        });
      },
    });

    const manager = new ServiceManager([config()], 'test-token');
    await manager.spawnAll();

    await manager.stopAll();

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8765/shutdown', {
      method: 'POST',
      headers: { 'X-Parkit-Shutdown-Token': 'test-token' },
    });
    expect(proc.killed).toBe(false);
  });

  it('force-kills the process if cooperative shutdown never exits', async () => {
    const proc = new FakeProcess();
    mockSpawn.mockReturnValue(proc);
    stubFetch();

    const manager = new ServiceManager([config()], 'test-token');
    await manager.spawnAll();

    const done = manager.stopAll();
    await vi.runAllTimersAsync();
    await done;

    expect(proc.killed).toBe(true);
  });
});
