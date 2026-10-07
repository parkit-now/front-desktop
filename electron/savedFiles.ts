import { shell } from 'electron';
import fs from 'node:fs';

const savedPaths = new Set<string>();

export function rememberSavedFile(filePath: string): void {
  savedPaths.add(filePath);
}

export async function showSavedFileInFolder(
  filePath: unknown,
): Promise<{ ok: boolean }> {
  // Only files actually saved by this process may be revealed through IPC.
  if (typeof filePath !== 'string' || !savedPaths.has(filePath)) {
    return { ok: false };
  }
  try {
    if (!(await fs.promises.stat(filePath)).isFile()) return { ok: false };
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
