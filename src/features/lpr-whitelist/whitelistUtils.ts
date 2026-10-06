export type IgnoredPlateRule = {
  plate: string;
  active: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  deletedAt?: string | null;
};

export function normalizeIgnoredPlate(plate: string): string {
  return plate.replace(/[\s_-]/g, '').toUpperCase();
}

export function argentinaDay(now = Date.now()): string {
  return new Date(now).toLocaleDateString('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export function ignoredPlateState(
  rule: IgnoredPlateRule,
  now = Date.now(),
): string {
  if (!rule.active || rule.deletedAt) return 'Desactivada';
  const day = argentinaDay(now);
  if (rule.validFrom && day < rule.validFrom) return 'Programada';
  if (rule.validUntil && day > rule.validUntil) return 'Vencida';
  return 'Vigente';
}

export function isIgnoredPlate(
  plate: string,
  rules: IgnoredPlateRule[],
  now = Date.now(),
): boolean {
  const normalized = normalizeIgnoredPlate(plate);
  return (
    Boolean(normalized) &&
    rules.some(
      (rule) =>
        normalizeIgnoredPlate(rule.plate) === normalized &&
        ignoredPlateState(rule, now) === 'Vigente',
    )
  );
}

export function whitelistFormError(input: {
  plate: string;
  notes?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}): string | null {
  if (!/^[A-Z0-9]{1,20}$/.test(normalizeIgnoredPlate(input.plate)))
    return 'Ingresá una patente válida.';
  if ((input.notes?.length ?? 0) > 500)
    return 'La nota no puede superar los 500 caracteres.';
  if (input.validFrom && input.validUntil && input.validFrom > input.validUntil)
    return 'La fecha hasta debe ser igual o posterior a la fecha desde.';
  return null;
}

export function whitelistDateLabel(day?: string | null): string {
  return day ? day.split('-').reverse().join('/') : 'Sin límite';
}
