// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceManager } from './services.js';

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

// vi.hoisted ensures mockSpawn is initialized before vi.mock factories run.
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

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
  Object.defineProperty(process, 'resourcesPath', {
    value: '/fake/resources',
    configurable: true,
  });
  vi.useFakeTimers();
  mockSpawn.mockReset();
  mockSpawn.mockReturnValue(new FakeProcess());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ServiceManager — retry on startup', () => {
  it('marks service as healthy when it responds on the first attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const manager = new ServiceManager([{ name: 'lpr-service', port: 8765 }]);
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

    const manager = new ServiceManager([{ name: 'lpr-service', port: 8765 }]);
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

    const manager = new ServiceManager([{ name: 'lpr-service', port: 8765 }]);
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
      [{ name: 'lpr-service', port: 8765, env: { EXTRA: '1' } }],
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

    const manager = new ServiceManager(
      [{ name: 'lpr-service', port: 8765 }],
      'test-token',
    );
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

    const manager = new ServiceManager(
      [{ name: 'lpr-service', port: 8765 }],
      'test-token',
    );
    manager.spawnAll();

    const done = manager.stopAll();
    await vi.runAllTimersAsync();
    await done;

    expect(proc.killed).toBe(true);
  });
});
