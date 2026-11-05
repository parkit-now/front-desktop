export type SyncFailure = { stage: string; error: unknown };

/** Conserva los errores originales sin abortar las demás etapas del sync. */
export class SyncError extends Error {
  constructor(readonly failures: readonly SyncFailure[]) {
    super('Fallaron etapas de sincronización.');
    this.name = 'SyncError';
  }
}
