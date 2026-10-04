import { describe, expect, it } from 'vitest';
import { readCameraTestingMode, writeCameraTestingMode } from './testingMode';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('modo prueba de la cámara', () => {
  it('arranca apagado', () => {
    expect(readCameraTestingMode(new MemoryStorage())).toBe(false);
  });

  it('se prende y se apaga', () => {
    const storage = new MemoryStorage();
    writeCameraTestingMode(true, storage);
    expect(readCameraTestingMode(storage)).toBe(true);
    writeCameraTestingMode(false, storage);
    expect(readCameraTestingMode(storage)).toBe(false);
  });

  it('sin storage queda apagado en vez de romper', () => {
    expect(readCameraTestingMode(null)).toBe(false);
    const roto = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readCameraTestingMode(roto)).toBe(false);
    expect(() => writeCameraTestingMode(true, roto)).not.toThrow();
  });
});
