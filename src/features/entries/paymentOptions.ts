/**
 * Opciones del select de medio de pago de una línea de pago.
 *
 * Dedupe defensivo por `id` (el pull incremental no debería duplicar, pero un
 * select con filas repetidas confunde al operador) y un placeholder con el
 * nombre guardado SOLO cuando la línea apunta a un medio que ya no está entre
 * las opciones (borrado o deshabilitado) o no tiene id.
 */
export function dedupePaymentMethods<T extends { id: string }>(
  methods: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const method of methods) {
    if (seen.has(method.id)) continue;
    seen.add(method.id);
    result.push(method);
  }
  return result;
}

export function needsPaymentPlaceholder(
  paymentMethodId: string | null | undefined,
  methods: readonly { id: string }[],
): boolean {
  if (!paymentMethodId) return true;
  return !methods.some((method) => method.id === paymentMethodId);
}
