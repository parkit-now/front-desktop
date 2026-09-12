import { localDb, type PendingOp } from '../db/localDb';

/**
 * Usuario dueño de la sesión activa.
 *
 * Es un registry de módulo y no un hook a propósito: hay call sites que encolan
 * desde funciones puras, fuera del árbol de componentes (ver
 * `features/camera/useCameraDetections.ts`). Si el autor dependiera de React
 * context, justo esas operaciones quedarían sin dueño.
 */
let activeUserId: string | null = null;

/** Lo llama `SyncProvider` en cuanto la sesión se resuelve o cambia. */
export function setEnqueueUserId(userId: string | null): void {
  activeUserId = userId;
}

/** Campos que pone `enqueuePendingOp`; el call site no los manda. */
export type NewPendingOp = Omit<
  PendingOp,
  'localId' | 'createdAt' | 'retryCount' | 'userId' | 'nextAttemptAt'
>;

/**
 * Única puerta de entrada a la cola de pendientes.
 *
 * Centralizado porque `userId`, `createdAt` y `retryCount` son exactamente los
 * campos que se olvidan al sumar un call site nuevo — y sin `userId` no hay
 * forma de saber de qué turno salió una operación, que en una playa con cambio
 * de operador y arqueo de caja no es un detalle.
 */
export async function enqueuePendingOp(op: NewPendingOp): Promise<void> {
  await localDb.pendingOps.add({
    ...op,
    userId: activeUserId ?? undefined,
    createdAt: Date.now(),
    retryCount: 0,
  });
}
