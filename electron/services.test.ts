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
  readonly pid = 1234;

  kill(): void {
    if (!this.killed) {
      this.killed = true;
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
