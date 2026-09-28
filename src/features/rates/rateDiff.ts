import type { UpdateRateDto } from '../../lib/api/rates';
import type { LocalEntry } from '../../lib/db/localDb';

/**
 * El diff de una edición de tarifa, y qué implica para los autos que están
 * adentro.
 *
 * Esto vivía inline dentro de un handler de `RatesPanel.tsx`, un archivo de
 * más de mil líneas, y no tenía ni un test. Sale acá porque la pregunta nueva
 * —"¿los autos que ya están adentro pasan al precio nuevo?"— se decide con
 * estas reglas, y en los dos fronts los tests corren sin DOM: si la lógica no
 * está en funciones puras, no se puede testear.
 *
 * GEMELO CONCEPTUAL de `front-web/src/features/owner/sections/tasas/validation.ts`
 * (`diffRateUpdate`, `hasPriceChange`). El código está duplicado porque los
 * repos no comparten módulos, pero las reglas tienen que coincidir: si divergen,
 * la web pregunta y el desktop no, sobre el mismo cambio.
 */

/** Los cuatro campos que cambian lo que se le cobra a un auto. */
export const RATE_PRICE_FIELDS = [
  'hourPriceArs',
  'fractionPriceArs',
  'mediaEstadiaPriceArs',
  'stayPriceArs',
] as const;

/**
 * Si esta edición toca algún precio.
 *
 * Es lo único que dispara la pregunta. Renombrar la tarifa, cambiarle el atajo
 * o activarla/desactivarla no cambia lo que se cobra, y preguntar ahí sería
 * ruido que el operador aprende a saltear sin leer — y el día que importa,
 * tampoco lo lee.
 *
 * `autoFractionPrice` NO cuenta: es una preferencia del formulario y el motor
 * de cobro ni la mira. Pero prenderla reescribe `fractionPriceArs`, y ese sí
 * cuenta. O sea que el disparador es siempre el campo de precio, nunca el flag.
 *
 * Mira PRESENCIA de clave, no valores: el body ya es el diff.
 */
export function hasPriceChange(body: UpdateRateDto): boolean {
  return RATE_PRICE_FIELDS.some((field) => body[field] !== undefined);
}

/**
 * Dinero a número, tolerando lo que no se puede parsear.
 *
 * Acepta string y number porque las dos formas conviven: en Dexie los precios
 * son `string` para no perder precisión, y en el DTO de la API son `number`.
 */
export function toMoneyNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Lo mínimo que hace falta de una tarifa para estas cuentas.
 *
 * Es un shape y no `LocalRate` ni `RateDto` a propósito: el panel trabaja con
 * el DTO (precios `number`) y Dexie guarda strings, y las reglas son las
 * mismas para los dos.
 */
export interface RatePrices {
  name: string;
  hourPriceArs: string | number;
  stayPriceArs: string | number;
  fractionPriceArs: string | number;
  mediaEstadiaPriceArs?: string | number;
  autoFractionPrice: boolean;
  shortcutNumber?: number | null;
}

export interface RateFormValues {
  name: string;
  hourPriceArs: number;
  stayPriceArs: number;
  fractionPriceArs: number;
  mediaEstadiaPriceArs: number;
  autoFractionPrice: boolean;
  shortcutNumber?: number;
}

/** Sólo los campos que realmente cambiaron respecto de la tarifa guardada. */
export function diffRateUpdate(
  values: RateFormValues,
  current: RatePrices,
): UpdateRateDto {
  const body: UpdateRateDto = {};

  if (values.name !== current.name) body.name = values.name;
  if (values.hourPriceArs !== toMoneyNumber(current.hourPriceArs))
    body.hourPriceArs = values.hourPriceArs;
  if (values.stayPriceArs !== toMoneyNumber(current.stayPriceArs))
    body.stayPriceArs = values.stayPriceArs;
  if (values.fractionPriceArs !== toMoneyNumber(current.fractionPriceArs))
    body.fractionPriceArs = values.fractionPriceArs;
  if (
    values.mediaEstadiaPriceArs !== toMoneyNumber(current.mediaEstadiaPriceArs)
  )
    body.mediaEstadiaPriceArs = values.mediaEstadiaPriceArs;
  if (values.autoFractionPrice !== current.autoFractionPrice)
    body.autoFractionPrice = values.autoFractionPrice;
  if (values.shortcutNumber !== current.shortcutNumber)
    body.shortcutNumber = values.shortcutNumber;

  return body;
}

/** Las estadías que están adentro AHORA con esta tarifa. */
export function openEntriesForRate(
  entries: LocalEntry[],
  rateId: string,
): LocalEntry[] {
  // `!leftAt` es "sigue adentro". Las que creó la cámara no tienen `rateId`,
  // así que nunca matchean: no hay precio congelado que actualizarles.
  return entries.filter((entry) => !entry.leftAt && entry.rateId === rateId);
}

/** Los cuatro precios del snapshot, como los va a dejar esta edición. */
export function nextSnapshotFromRate(
  current: RatePrices,
  body: UpdateRateDto,
): {
  rateSnapshotHourPriceArs: string;
  rateSnapshotFractionPriceArs: string;
  rateSnapshotMediaEstadiaPriceArs: string;
  rateSnapshotStayPriceArs: string;
} {
  // Se escriben los CUATRO, aunque haya cambiado uno solo, exactamente como
  // hace el backend. Es lo que cumple lo que promete el diálogo —"quedan con
  // la tarifa tal como está ahora"— y evita dejar en un estado mixto a una
  // estadía cuyo snapshot ya hubiera divergido.
  const pick = (
    field: (typeof RATE_PRICE_FIELDS)[number],
    stored: string | number | undefined,
  ): string =>
    body[field] !== undefined
      ? String(body[field])
      : String(toMoneyNumber(stored));

  return {
    rateSnapshotHourPriceArs: pick('hourPriceArs', current.hourPriceArs),
    rateSnapshotFractionPriceArs: pick(
      'fractionPriceArs',
      current.fractionPriceArs,
    ),
    rateSnapshotMediaEstadiaPriceArs: pick(
      'mediaEstadiaPriceArs',
      current.mediaEstadiaPriceArs,
    ),
    rateSnapshotStayPriceArs: pick('stayPriceArs', current.stayPriceArs),
  };
}

/** Las filas "Hora $3.500 → $3.900" que muestra el diálogo. */
export function priceDiffRows(
  body: UpdateRateDto,
  current: RatePrices,
): { label: string; before: number; after: number }[] {
  const labels: Record<(typeof RATE_PRICE_FIELDS)[number], string> = {
    hourPriceArs: 'Hora',
    fractionPriceArs: 'Fracción',
    mediaEstadiaPriceArs: 'Media estadía',
    stayPriceArs: 'Estadía',
  };

  return RATE_PRICE_FIELDS.filter((field) => body[field] !== undefined).map(
    (field) => ({
      label: labels[field],
      before: toMoneyNumber(current[field]),
      after: toMoneyNumber(body[field]),
    }),
  );
}
