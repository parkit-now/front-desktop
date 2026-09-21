import { useLiveQuery } from 'dexie-react-hooks';
import { createPortal } from 'react-dom';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { createEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { COLORS } from '../../lib/data/colors';
import { Printer, PrinterX } from 'lucide-react';
import { generateUuidV7 } from './entryUtils';
import {
  describePrintFailure,
  printEntryTicket,
} from '../../lib/print/printTicket';
import { type LocalRate } from '../../lib/db/localDb';

export type EntryFormVariant = 'manual' | 'auto';

export type ManualEntryDraft = {
  plate: string;
  brand: string;
  model: string;
  vehicleInput: string;
  vehicleSelected: boolean;
  color: string;
  colorSelected: boolean;
  rateId: string;
  rateInput: string;
  rateSelected: boolean;
  cochera: string;
  notes: string;
};

const ACTIVE_ENTRY_MESSAGE = 'El vehículo ya tiene un ingreso activo.';

interface Props {
  tenantId: string;
  accessToken: string;
  /** Pre-fill the plate field (auto-detected entries). */
  initialPlate?: string;
  /** 'manual' = full card with autofocus + reset-and-refocus on submit.
   *  'auto' = compact card; on submit it notifies onRegistered instead. */
  variant?: EntryFormVariant;
  /** Rendered above the fields (title for manual, plate image for auto). */
  headerSlot?: ReactNode;
  /** Extra buttons rendered next to the submit button (e.g. "Descartar"). */
  extraActions?: ReactNode;
  /** Called after a successful registration with the normalised plate. */
  onRegistered?: (result: { plate: string; entryId: string }) => void;
  /** Header of the printed ticket. Only used by the manual variant. */
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
  /** Temporary in-memory draft for the manual operativo form. */
  initialDraft?: ManualEntryDraft | null;
  /** Called as the manual operativo draft changes. Should not update parent state per key stroke. */
  onDraftChange?: (draft: ManualEntryDraft) => void;
  /** Called when the manual operativo draft is intentionally cleared. */
  onDraftReset?: () => void;
}

type VehicleSuggestion =
  | { kind: 'model'; label: string; brand: string; model: string }
  | { kind: 'brand'; label: string; brand: string };

const SUGGESTION_LIMIT = 10;

// Portal dropdown for vehicle suggestions — avoids overflow/stacking-context clipping.
function VehicleSuggestionsPortal({
  inputRef,
  suggestions,
  onSelect,
  open,
  highlightedIdx,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  suggestions: VehicleSuggestion[];
  onSelect: (s: VehicleSuggestion) => void;
  open: boolean;
  highlightedIdx: number;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 200,
    });
  }, [open, inputRef]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[highlightedIdx] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIdx]);

  if (!open || suggestions.length === 0) return null;

  return createPortal(
    <ul ref={listRef} className="vehicle-suggestions" style={style}>
      {suggestions.map((s, i) => (
        <li
          key={i}
          className={[
            `vehicle-suggestion vehicle-suggestion--${s.kind}`,
            i === highlightedIdx ? 'vehicle-suggestion--highlighted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(s);
          }}
        >
          {s.label}
          {s.kind === 'brand' && (
            <span className="vehicle-suggestion-tag">marca</span>
          )}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

function ColorSuggestionsPortal({
  inputRef,
  suggestions,
  onSelect,
  open,
  highlightedIdx,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  suggestions: string[];
  onSelect: (color: string) => void;
  open: boolean;
  highlightedIdx: number;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 200,
    });
  }, [open, inputRef]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[highlightedIdx] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIdx]);

  if (!open || suggestions.length === 0) return null;

  return createPortal(
    <ul ref={listRef} className="vehicle-suggestions" style={style}>
      {suggestions.map((c, i) => (
        <li
          key={c}
          className={[
            'vehicle-suggestion vehicle-suggestion--model',
            i === highlightedIdx ? 'vehicle-suggestion--highlighted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(c);
          }}
        >
          {c}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

function RateSuggestionsPortal({
  inputRef,
  suggestions,
  onSelect,
  open,
  highlightedIdx,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  suggestions: LocalRate[];
  onSelect: (r: LocalRate) => void;
  open: boolean;
  highlightedIdx: number;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 200,
    });
  }, [open, inputRef]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[highlightedIdx] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIdx]);

  if (!open || suggestions.length === 0) return null;

  return createPortal(
    <ul ref={listRef} className="vehicle-suggestions" style={style}>
      {suggestions.map((r, i) => (
        <li
          key={r.id}
          className={[
            'vehicle-suggestion vehicle-suggestion--model',
            i === highlightedIdx ? 'vehicle-suggestion--highlighted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(r);
          }}
        >
          {r.name}
          {r.shortcutNumber != null && (
            <span className="vehicle-suggestion-tag">{r.shortcutNumber}</span>
          )}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

export function EntryFormCore({
  tenantId,
  accessToken,
  initialPlate,
  variant = 'manual',
  headerSlot,
  extraActions,
  onRegistered,
  parkingName = null,
  parkingAddress = null,
  parkingCuit = null,
  initialDraft = null,
  onDraftChange,
  onDraftReset,
}: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();

  // Field values
  const manualDraft = variant === 'manual' ? initialDraft : null;
  const [plate, setPlate] = useState(
    () => manualDraft?.plate ?? (initialPlate ?? '').toUpperCase(),
  );
  const [brand, setBrand] = useState(() => manualDraft?.brand ?? '');
  const [model, setModel] = useState(() => manualDraft?.model ?? '');
  const [vehicleInput, setVehicleInput] = useState(
    () => manualDraft?.vehicleInput ?? '',
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [color, setColor] = useState(() => manualDraft?.color ?? '');
  const [colorSelected, setColorSelected] = useState(
    () => manualDraft?.colorSelected ?? false,
  );
  const [showColorSuggestions, setShowColorSuggestions] = useState(false);
  const [highlightedColorIdx, setHighlightedColorIdx] = useState(0);
  const [rateId, setRateId] = useState(() => manualDraft?.rateId ?? '');
  const [rateInput, setRateInput] = useState(
    () => manualDraft?.rateInput ?? '',
  );
  const [rateSelected, setRateSelected] = useState(
    () => manualDraft?.rateSelected ?? false,
  );
  const [showRateSuggestions, setShowRateSuggestions] = useState(false);
  const [highlightedRateIdx, setHighlightedRateIdx] = useState(0);
  const [cochera, setCochera] = useState(() => manualDraft?.cochera ?? '');
  const [notes, setNotes] = useState(() => manualDraft?.notes ?? '');
  const [saving, setSaving] = useState(false);

  // Field errors
  const [plateError, setPlateError] = useState('');
  const [vehicleError, setVehicleError] = useState('');
  const [colorError, setColorError] = useState('');
  const [rateError, setRateError] = useState('');
  const [plateHasActiveEntry, setPlateHasActiveEntry] = useState(false);

  // Highlighted suggestion index for keyboard navigation
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(0);

  // Double-Enter confirmation state
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextDraftSyncRef = useRef(false);

  // Refs for Enter/Tab navigation
  const plateRef = useRef<HTMLInputElement>(null);
  const vehicleInputRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);

  const plateResolved = useRef(false);
  // True when user explicitly selected a catalog suggestion (brand+model resolved).
  const [vehicleSelected, setVehicleSelected] = useState(
    () => manualDraft?.vehicleSelected ?? false,
  );

  // Exclude soft-deleted rates: charging with a rate the owner took down is the
  // whole point of the tombstone sync. `pullRates` already removes them, this is
  // the belt-and-suspenders read.
  const activeRates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((r) => r.isActive && !r.deletedAt)
        .sortBy('name'),
    [tenantId],
  );

  // Catálogo de ESTE estacionamiento, sin bajas lógicas.
  //
  // Antes esta query no filtraba por tenant y las deps estaban vacías. Eran dos
  // bugs en uno: al cambiar de estacionamiento sin limpiar IndexedDB el
  // operador veía el catálogo ajeno —y como el formulario OBLIGA a elegir del
  // catálogo, un pick errado escribía el snapshot de marca/modelo de otra playa
  // en un ingreso real— y con `deps: []` la query ni siquiera se re-ejecutaba
  // al cambiar de tenant. `VehiclesPanel` ya lo hacía bien; era asimetría pura.
  const catalogVehicles = useLiveQuery(
    () =>
      localDb.vehicles
        .where('tenantId')
        .equals(tenantId)
        .filter((v) => !v.deletedAt)
        .toArray(),
    [tenantId],
  );

  useEffect(() => {
    plateResolved.current = false;
  }, [plate]);

  useEffect(() => {
    if (variant !== 'manual' || !onDraftChange) return;
    if (skipNextDraftSyncRef.current) {
      skipNextDraftSyncRef.current = false;
      return;
    }
    onDraftChange({
      plate,
      brand,
      model,
      vehicleInput,
      vehicleSelected,
      color,
      colorSelected,
      rateId,
      rateInput,
      rateSelected,
      cochera,
      notes,
    });
  }, [
    brand,
    cochera,
    color,
    colorSelected,
    model,
    notes,
    onDraftChange,
    plate,
    rateId,
    rateInput,
    rateSelected,
    vehicleInput,
    vehicleSelected,
    variant,
  ]);

  useEffect(() => {
    setHighlightedSuggestionIdx(0);
  }, [vehicleInput]);

  useEffect(() => {
    setHighlightedColorIdx(0);
  }, [color]);

  useEffect(() => {
    setHighlightedRateIdx(0);
  }, [rateInput]);

  // ── Confirm submit logic ──────────────────────────────────────────────────

  function resetConfirm() {
    if (awaitingConfirm) {
      setAwaitingConfirm(false);
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
    }
  }

  function triggerSubmitConfirm() {
    if (awaitingConfirm) {
      setAwaitingConfirm(false);
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
      // El doble Enter es el mismo camino que tocar "Registrar ingreso": imprime.
      void submitEntry({ print: true });
      return;
    }
    setAwaitingConfirm(true);
    confirmTimeoutRef.current = setTimeout(() => {
      setAwaitingConfirm(false);
    }, 2500);
  }

  // Look up previous entries for this tenant with the same plate and pre-fill
  // vehicle, color and last rate when those fields are still empty. Runs on
  // plate blur and (for auto-detected entries) once on mount.
  const prefillFromPlate = useCallback(async () => {
    const normalized = plate.trim().toUpperCase();
    if (!normalized || plateResolved.current) return;

    const prev = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.plate === normalized)
      .first();

    if (prev) {
      if (!color && prev.color) {
        setColor(prev.color);
        setColorSelected(true);
      }
      if (!rateId && prev.rateId) {
        const prevRate = activeRates?.find((r) => r.id === prev.rateId);
        if (prevRate) {
          setRateId(prevRate.id);
          setRateInput(
            prevRate.shortcutNumber != null
              ? `${prevRate.name} (${prevRate.shortcutNumber})`
              : prevRate.name,
          );
          setRateSelected(true);
        }
      }
      if (prev.vehicleBrand && !vehicleInput) {
        const b = prev.vehicleBrand;
        const m = prev.vehicleModel ?? '';
        setBrand(b);
        setModel(m);
        setVehicleInput(m ? `${b} ${m}` : b);
        setVehicleSelected(true);
      }
      plateResolved.current = true;
    }
  }, [plate, tenantId, color, rateId, vehicleInput, activeRates]);

  // Auto-detected entries: prefill once the initial plate and rates are ready.
  const didAutoPrefill = useRef(false);
  useEffect(() => {
    if (variant !== 'auto' || didAutoPrefill.current) return;
    if (!initialPlate || activeRates === undefined) return;
    didAutoPrefill.current = true;
    void prefillFromPlate();
  }, [variant, initialPlate, activeRates, prefillFromPlate]);

  const checkActivePlate = useCallback(async () => {
    const normalized = plate.trim().toUpperCase();
    if (!normalized) {
      setPlateHasActiveEntry(false);
      return;
    }
    const active = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.plate === normalized && !e.leftAt)
      .first();
    setPlateHasActiveEntry(Boolean(active));
    if (active) {
      setPlateError(ACTIVE_ENTRY_MESSAGE);
    }
  }, [plate, tenantId]);

  function handlePlateBlur() {
    void prefillFromPlate();
    void checkActivePlate();
  }

  // 0 = prefix match, 1 = word-boundary match, 2 = contains match
  const scoreMatch = useCallback((name: string, q: string): number => {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) return 0;
    if (lower.split(/[\s\-_]+/).some((w) => w.startsWith(q))) return 1;
    return 2;
  }, []);

  // Build combined suggestions sorted by relevance: models first, then brands.
  const suggestions = useMemo<VehicleSuggestion[]>(() => {
    const q = vehicleInput.trim().toLowerCase();
    if (!q || vehicleSelected) return [];

    // Única fuente: el catálogo sincronizado. Antes había un fallback a una
    // lista estática de 244 modelos hardcodeada en el repo, pero era
    // todo-o-nada: apenas había UN vehículo en la base local la lista entera se
    // ignoraba, así que con el seed viejo (3 globales) el operador solo podía
    // cargar Corolla, Ranger o Kangoo. El catálogo global ahora vive en la base
    // y lo siembra una migración.
    const source: { brand: string; model: string }[] = catalogVehicles ?? [];

    const modelBrands = new Map<string, Set<string>>();
    for (const v of source) {
      const key = v.model.toLowerCase();
      if (!modelBrands.has(key)) modelBrands.set(key, new Set());
      modelBrands.get(key)!.add(v.brand.toLowerCase());
    }
    const ambiguous = new Set(
      [...modelBrands.entries()]
        .filter(([, brands]) => brands.size > 1)
        .map(([m]) => m),
    );

    type ModelSuggestion = Extract<VehicleSuggestion, { kind: 'model' }>;

    // Collect all model matches with relevance score, then sort
    const seenModels = new Set<string>();
    const modelMatches: { score: number; s: ModelSuggestion }[] = [];
    for (const v of source) {
      if (!v.model.toLowerCase().includes(q)) continue;
      const key = `${v.brand}|${v.model}`;
      if (seenModels.has(key)) continue;
      seenModels.add(key);
      const isAmbig = ambiguous.has(v.model.toLowerCase());
      modelMatches.push({
        score: scoreMatch(v.model, q),
        s: {
          kind: 'model',
          label: isAmbig ? `${v.model} — ${v.brand}` : v.model,
          brand: v.brand,
          model: v.model,
        },
      });
    }
    modelMatches.sort(
      (a, b) => a.score - b.score || a.s.model.localeCompare(b.s.model),
    );
    const result: VehicleSuggestion[] = modelMatches
      .slice(0, SUGGESTION_LIMIT)
      .map((m) => m.s);

    // Fill remaining slots with brand matches (also sorted by relevance)
    if (result.length < SUGGESTION_LIMIT) {
      const seenBrands = new Set<string>();
      const brandMatches: { score: number; brand: string }[] = [];
      for (const v of source) {
        if (!v.brand.toLowerCase().includes(q)) continue;
        if (seenBrands.has(v.brand)) continue;
        seenBrands.add(v.brand);
        brandMatches.push({ score: scoreMatch(v.brand, q), brand: v.brand });
      }
      brandMatches.sort(
        (a, b) => a.score - b.score || a.brand.localeCompare(b.brand),
      );
      for (const { brand } of brandMatches) {
        result.push({ kind: 'brand', label: brand, brand });
        if (result.length >= SUGGESTION_LIMIT) break;
      }
    }

    return result;
  }, [vehicleInput, catalogVehicles, scoreMatch, vehicleSelected]);

  /**
   * El catálogo local está vacío: o nunca se sincronizó, o el pull falló. El
   * formulario exige elegir del catálogo, así que en ese estado no se puede
   * registrar ningún ingreso y hay que decirlo en vez de rechazar en silencio.
   */
  const catalogIsEmpty =
    catalogVehicles !== undefined && catalogVehicles.length === 0;

  // True when the current vehicleInput query matches at least one catalog entry.
  // Independent of vehicleSelected — used to enforce catalog selection.
  const hasCatalogMatches = useMemo(() => {
    const q = vehicleInput.trim().toLowerCase();
    if (!q) return false;
    const source = catalogVehicles ?? [];
    return source.some(
      (v) =>
        v.model.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q),
    );
  }, [vehicleInput, catalogVehicles]);

  const colorSuggestions = useMemo(() => {
    const q = color.trim().toLowerCase();
    if (!q || colorSelected) return [];
    return [...COLORS]
      .filter((c) => c.toLowerCase().includes(q))
      .sort(
        (a, b) => scoreMatch(a, q) - scoreMatch(b, q) || a.localeCompare(b),
      );
  }, [color, colorSelected, scoreMatch]);

  const rateSuggestions = useMemo<LocalRate[]>(() => {
    const q = rateInput.trim().toLowerCase();
    if (!q || rateSelected) return [];
    const rates = activeRates ?? [];
    const scored: { score: number; r: LocalRate }[] = [];
    for (const r of rates) {
      const numStr = r.shortcutNumber != null ? String(r.shortcutNumber) : '';
      const nameLower = r.name.toLowerCase();
      let score = -1;
      if (numStr && numStr === q) score = 0;
      else if (numStr && numStr.startsWith(q)) score = 1;
      else if (nameLower.startsWith(q)) score = 2;
      else if (numStr && numStr.includes(q)) score = 3;
      else if (nameLower.includes(q)) score = 4;
      if (score >= 0) scored.push({ score, r });
    }
    scored.sort(
      (a, b) => a.score - b.score || a.r.name.localeCompare(b.r.name),
    );
    return scored.map((x) => x.r);
  }, [rateInput, rateSelected, activeRates]);

  function rateLabel(r: LocalRate): string {
    return r.shortcutNumber != null
      ? `${r.name} (${r.shortcutNumber})`
      : r.name;
  }

  function selectRateSuggestion(r: LocalRate) {
    setRateId(r.id);
    setRateInput(rateLabel(r));
    setRateSelected(true);
    setRateError('');
    setShowRateSuggestions(false);
  }

  function handleRateInputChange(value: string) {
    setRateInput(value);
    setRateId('');
    setRateSelected(false);
    setRateError('');
    setShowRateSuggestions(true);
    resetConfirm();
  }

  function handleRateInputBlur() {
    setTimeout(() => setShowRateSuggestions(false), 150);
  }

  function selectColorSuggestion(c: string) {
    setColor(c);
    setColorSelected(true);
    setColorError('');
    setShowColorSuggestions(false);
  }

  function handleColorInputChange(value: string) {
    setColor(value);
    setColorError('');
    setColorSelected(false);
    setShowColorSuggestions(true);
    resetConfirm();
  }

  function handleColorInputBlur() {
    setTimeout(() => setShowColorSuggestions(false), 150);
  }

  function selectSuggestion(s: VehicleSuggestion) {
    const b = s.brand;
    const m = s.kind === 'model' ? s.model : '';
    setBrand(b);
    setModel(m);
    setVehicleInput(m ? `${b} ${m}` : b);
    setVehicleError('');
    setVehicleSelected(true);
    setShowSuggestions(false);
  }

  function handleVehicleInputChange(value: string) {
    setVehicleInput(value);
    setVehicleError('');
    setVehicleSelected(false);
    setBrand('');
    setModel('');
    setShowSuggestions(true);
    resetConfirm();
  }

  function handleVehicleInputBlur() {
    setTimeout(() => setShowSuggestions(false), 150);
  }

  // ── Enter / Tab navigation ────────────────────────────────────────────────

  function handlePlateKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    const norm = plate.trim().toUpperCase();
    if (norm.length < 3) {
      setPlateError('Mínimo 3 caracteres');
      return;
    }
    setPlateError('');
    vehicleInputRef.current?.focus();
  }

  function handleVehicleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedSuggestionIdx((i) =>
          Math.min(suggestions.length - 1, i + 1),
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedSuggestionIdx((i) => Math.max(0, i - 1));
        return;
      }
    }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    if (showSuggestions && suggestions.length > 0) {
      // Select highlighted suggestion and advance
      selectSuggestion(suggestions[highlightedSuggestionIdx]);
      setShowSuggestions(false);
      colorRef.current?.focus();
      return;
    }
    if (!vehicleInput.trim()) {
      setVehicleError('Ingresá el vehículo');
      return;
    }
    if (!vehicleSelected) {
      if (hasCatalogMatches) {
        setVehicleError('Seleccioná un vehículo de la lista');
        setShowSuggestions(true);
      } else {
        setVehicleError('Vehículo no encontrado en el catálogo');
      }
      return;
    }
    setShowSuggestions(false);
    colorRef.current?.focus();
  }

  function handleColorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showColorSuggestions && colorSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedColorIdx((i) =>
          Math.min(colorSuggestions.length - 1, i + 1),
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedColorIdx((i) => Math.max(0, i - 1));
        return;
      }
    }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    if (showColorSuggestions && colorSuggestions.length > 0) {
      selectColorSuggestion(colorSuggestions[highlightedColorIdx]);
      setShowColorSuggestions(false);
      rateRef.current?.focus();
      return;
    }
    if (!color.trim()) {
      setColorError('Ingresá el color');
      return;
    }
    if (!colorSelected) {
      setColorError('Seleccioná un color de la lista');
      setShowColorSuggestions(true);
      return;
    }
    setShowColorSuggestions(false);
    rateRef.current?.focus();
  }

  function handleRateKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showRateSuggestions && rateSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedRateIdx((i) =>
          Math.min(rateSuggestions.length - 1, i + 1),
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedRateIdx((i) => Math.max(0, i - 1));
        return;
      }
    }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    if (showRateSuggestions && rateSuggestions.length > 0) {
      selectRateSuggestion(rateSuggestions[highlightedRateIdx]);
      setShowRateSuggestions(false);
      return;
    }
    if (!rateSelected) {
      setRateError('Seleccioná una tarifa de la lista');
      if (rateSuggestions.length > 0) setShowRateSuggestions(true);
      return;
    }
    if (!validateAll()) return;
    triggerSubmitConfirm();
  }

  // Optional fields: Enter triggers submit confirm flow (skip cochera/notes)
  function handleOptionalKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!validateAll()) return;
    triggerSubmitConfirm();
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validateAll(): boolean {
    let ok = true;
    const norm = plate.trim().toUpperCase();
    if (norm.length < 3) {
      setPlateError('Mínimo 3 caracteres');
      ok = false;
    } else if (norm.length > 7) {
      setPlateError('Máximo 7 caracteres');
      ok = false;
    }
    if (!vehicleInput.trim()) {
      setVehicleError('Ingresá el vehículo');
      ok = false;
    } else if (!vehicleSelected) {
      // Con el catálogo vacío el input rechaza TODO, y un mensaje de "no
      // encontrado" haría creer que el modelo no existe cuando en realidad
      // falta sincronizar. Se distinguen los dos casos.
      setVehicleError(
        catalogIsEmpty
          ? 'El catálogo no está sincronizado. Sincronizá para cargar ingresos.'
          : hasCatalogMatches
            ? 'Seleccioná un vehículo de la lista'
            : 'Vehículo no encontrado en el catálogo',
      );
      ok = false;
    }
    if (!color.trim()) {
      setColorError('Ingresá el color');
      ok = false;
    } else if (!colorSelected) {
      setColorError('Seleccioná un color de la lista');
      ok = false;
    }
    if (!rateSelected) {
      setRateError('Seleccioná una tarifa de la lista');
      ok = false;
    }
    if (!ok) {
      if (norm.length < 3 || norm.length > 7) plateRef.current?.focus();
      else if (!vehicleInput.trim() || (hasCatalogMatches && !vehicleSelected))
        vehicleInputRef.current?.focus();
      else if (!color.trim() || !colorSelected) colorRef.current?.focus();
      else rateRef.current?.focus();
    }
    return ok;
  }

  const canSubmit =
    plate.trim().length >= 3 &&
    plate.trim().length <= 7 &&
    !plateHasActiveEntry &&
    vehicleSelected &&
    colorSelected &&
    rateSelected;

  // ── Submit ────────────────────────────────────────────────────────────────

  function resetFields() {
    setPlate('');
    setBrand('');
    setModel('');
    setVehicleInput('');
    setColor('');
    setColorSelected(false);
    setShowColorSuggestions(false);
    setRateId('');
    setRateInput('');
    setRateSelected(false);
    setShowRateSuggestions(false);
    setCochera('');
    setNotes('');
    setPlateError('');
    setVehicleError('');
    setColorError('');
    setRateError('');
    setAwaitingConfirm(false);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setVehicleSelected(false);
  }

  async function submitEntry({ print }: { print: boolean }): Promise<void> {
    const normalizedPlate = plate.trim().toUpperCase();

    const stillActive = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.plate === normalizedPlate && !e.leftAt)
      .first();
    if (stillActive) {
      setPlateHasActiveEntry(true);
      setPlateError(ACTIVE_ENTRY_MESSAGE);
      showToast({ message: ACTIVE_ENTRY_MESSAGE, kind: 'error' });
      return;
    }

    const finalBrand = vehicleSelected ? brand : '';
    const finalModel = vehicleSelected ? model : vehicleInput.trim();

    const selectedRate = activeRates?.find((r) => r.id === rateId);
    const entryId = generateUuidV7();
    const now = new Date().toISOString();

    // Resolve active cash session and compute ticket number
    const activeSession = await localDb.cashSessions
      .where('tenantId')
      .equals(tenantId)
      .filter((s) => !s.closedAt)
      .first();

    const ticketNumber = activeSession
      ? (await localDb.entries
          .where('cashSessionId')
          .equals(activeSession.id)
          .count()) + 1
      : undefined;

    const body = {
      id: entryId,
      plate: normalizedPlate,
      color: color.trim() || undefined,
      cochera: cochera.trim() || undefined,
      notes: notes.trim() || undefined,
      enteredAt: now,
      vehicleBrand: finalBrand || undefined,
      vehicleModel: finalModel || undefined,
      rateId: selectedRate?.id,
      rateSnapshotName: selectedRate?.name,
      rateSnapshotHourPriceArs: selectedRate
        ? parseFloat(selectedRate.hourPriceArs)
        : undefined,
      rateSnapshotStayPriceArs: selectedRate
        ? parseFloat(selectedRate.stayPriceArs)
        : undefined,
      rateSnapshotFractionPriceArs: selectedRate
        ? parseFloat(selectedRate.fractionPriceArs)
        : undefined,
      rateSnapshotMediaEstadiaPriceArs: selectedRate
        ? parseFloat(selectedRate.mediaEstadiaPriceArs)
        : undefined,
      cashSessionId: activeSession?.id,
      ticketNumber,
    };

    setSaving(true);
    try {
      if (isOnline) {
        const result = await createEntry({
          tenantId,
          bearer: accessToken,
          body,
        });
        const localEntry: LocalEntry = {
          id: result.id,
          tenantId: result.tenantId,
          plate: result.plate,
          color: result.color ?? undefined,
          cochera: result.cochera ?? undefined,
          notes: result.notes ?? undefined,
          enteredAt: result.enteredAt,
          leftAt: result.leftAt ?? undefined,
          vehicleBrand: result.vehicleBrand ?? undefined,
          vehicleModel: result.vehicleModel ?? undefined,
          rateId: result.rateId ?? undefined,
          rateSnapshotName: result.rateSnapshotName ?? undefined,
          rateSnapshotHourPriceArs:
            result.rateSnapshotHourPriceArs !== null
              ? String(result.rateSnapshotHourPriceArs)
              : undefined,
          rateSnapshotStayPriceArs:
            result.rateSnapshotStayPriceArs !== null
              ? String(result.rateSnapshotStayPriceArs)
              : undefined,
          rateSnapshotFractionPriceArs:
            result.rateSnapshotFractionPriceArs !== null
              ? String(result.rateSnapshotFractionPriceArs)
              : undefined,
          rateSnapshotMediaEstadiaPriceArs:
            result.rateSnapshotMediaEstadiaPriceArs != null
              ? String(result.rateSnapshotMediaEstadiaPriceArs)
              : undefined,
          cashSessionId: result.cashSessionId ?? undefined,
          ticketNumber: result.ticketNumber ?? undefined,
          version: result.version,
          syncSeq: result.syncSeq,
          updatedAt: result.updatedAt,
        };
        await localDb.entries.put(localEntry);
      } else {
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.pendingOps,
          async () => {
            await localDb.entries.put({
              id: entryId,
              tenantId,
              plate: normalizedPlate,
              color: color.trim() || undefined,
              cochera: cochera.trim() || undefined,
              notes: notes.trim() || undefined,
              enteredAt: now,
              vehicleBrand: finalBrand || undefined,
              vehicleModel: finalModel || undefined,
              rateId: selectedRate?.id,
              rateSnapshotName: selectedRate?.name,
              rateSnapshotHourPriceArs: selectedRate?.hourPriceArs,
              rateSnapshotStayPriceArs: selectedRate?.stayPriceArs,
              rateSnapshotFractionPriceArs: selectedRate?.fractionPriceArs,
              rateSnapshotMediaEstadiaPriceArs:
                selectedRate?.mediaEstadiaPriceArs,
              cashSessionId: activeSession?.id,
              ticketNumber,
              version: 1,
              syncSeq: 0,
              updatedAt: now,
            });
            await enqueuePendingOp({
              entityType: 'entry',
              operation: 'create',
              tenantId,
              entityId: entryId,
              payload: body,
              status: 'pending',
            });
          },
        );
      }

      showToast({
        message: isOnline
          ? `Ingreso registrado: ${normalizedPlate}`
          : `Guardado localmente: ${normalizedPlate}`,
        kind: 'success',
      });

      if (print) {
        // Best-effort y a propósito fuera del try/catch de arriba: el ingreso ya
        // está en Dexie (y en pendingOps si estamos offline), así que una falla
        // de impresión NO puede reportarse como un ingreso fallido ni revertir
        // nada. Tampoco se espera: el operador sigue tipeando la patente que
        // viene mientras el trabajo se encola en el spooler.
        void printEntryTicket(
          {
            parkingName,
            parkingAddress,
            parkingCuit,
            plate: normalizedPlate,
            vehicleBrand: finalBrand || null,
            vehicleModel: finalModel || null,
            color: color.trim() || null,
            cochera: cochera.trim() || null,
            notes: notes.trim() || null,
            enteredAt: now,
            rateNumber: selectedRate?.shortcutNumber ?? null,
            rateName: selectedRate?.name ?? null,
            ticketNumber: ticketNumber ?? null,
          },
          tenantId,
        ).then((outcome) => {
          if (!outcome.ok) {
            showToast({
              message: describePrintFailure(outcome),
              kind: 'error',
            });
          }
        });
      }

      if (variant === 'auto') {
        onRegistered?.({ plate: normalizedPlate, entryId });
      } else {
        skipNextDraftSyncRef.current = true;
        resetFields();
        onDraftReset?.();
        setTimeout(() => plateRef.current?.focus(), 50);
      }
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  // Button click: direct submit (no double-confirm, click is already intentional)
  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!validateAll()) return;
    await submitEntry({ print: true });
  }

  // "Registrar sin imprimir": mismo registro, sin papel.
  async function handleSubmitWithoutPrinting(): Promise<void> {
    if (!validateAll()) return;
    resetConfirm();
    await submitEntry({ print: false });
  }

  return (
    <form
      className={`entry-form${variant === 'auto' ? ' entry-form--auto' : ''}`}
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      {headerSlot ??
        (variant === 'manual' ? (
          <h3 className="entry-form-title">Registrar ingreso</h3>
        ) : null)}

      <div className="entry-form-fields auth-form">
        <div className="form-field">
          <input
            ref={plateRef}
            type="text"
            placeholder="Patente (ej. ABC123)"
            value={plate}
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
              setPlateError('');
              setPlateHasActiveEntry(false);
              resetConfirm();
            }}
            onBlur={handlePlateBlur}
            onKeyDown={handlePlateKeyDown}
            className={`entry-form-plate${plateError ? ' input-error' : ''}`}
            maxLength={7}
            autoFocus={variant === 'manual'}
          />
          {plateError && <p className="field-error">{plateError}</p>}
        </div>

        <div className="form-field">
          <div className="entry-form-vehicle-input-container">
            <input
              ref={vehicleInputRef}
              type="text"
              placeholder={
                catalogIsEmpty
                  ? 'Catálogo sin sincronizar — sincronizá para cargar'
                  : 'Vehículo (ej. Bora, BMW, Toyota Hilux)'
              }
              disabled={catalogIsEmpty}
              value={vehicleInput}
              onChange={(e) => {
                handleVehicleInputChange(e.target.value);
              }}
              onFocus={() => {
                if (!vehicleSelected && vehicleInput) {
                  setShowSuggestions(true);
                }
              }}
              onBlur={handleVehicleInputBlur}
              onKeyDown={handleVehicleKeyDown}
              maxLength={120}
              autoComplete="off"
              className={vehicleError ? 'input-error' : undefined}
            />
            <VehicleSuggestionsPortal
              inputRef={vehicleInputRef}
              suggestions={suggestions}
              onSelect={selectSuggestion}
              open={showSuggestions}
              highlightedIdx={highlightedSuggestionIdx}
            />
          </div>
          {vehicleError && <p className="field-error">{vehicleError}</p>}
        </div>

        <div className="form-field">
          <div className="entry-form-vehicle-input-container">
            <input
              ref={colorRef}
              type="text"
              placeholder="Color (ej. NEGRO, GRIS, ROJO)"
              value={color}
              onChange={(e) => handleColorInputChange(e.target.value)}
              onFocus={() => {
                if (!colorSelected && color) setShowColorSuggestions(true);
              }}
              onBlur={handleColorInputBlur}
              onKeyDown={handleColorKeyDown}
              maxLength={50}
              autoComplete="off"
              className={colorError ? 'input-error' : undefined}
            />
            <ColorSuggestionsPortal
              inputRef={colorRef}
              suggestions={colorSuggestions}
              onSelect={(c) => {
                selectColorSuggestion(c);
                rateRef.current?.focus();
              }}
              open={showColorSuggestions}
              highlightedIdx={highlightedColorIdx}
            />
          </div>
          {colorError && <p className="field-error">{colorError}</p>}
        </div>

        <div className="form-field">
          <div className="entry-form-vehicle-input-container">
            <input
              ref={rateRef}
              type="text"
              placeholder="Tarifa (ej. 1, dia auto)"
              value={rateInput}
              onChange={(e) => handleRateInputChange(e.target.value)}
              onFocus={() => {
                if (!rateSelected && rateInput) setShowRateSuggestions(true);
              }}
              onBlur={handleRateInputBlur}
              onKeyDown={handleRateKeyDown}
              autoComplete="off"
              className={rateError ? 'input-error' : undefined}
            />
            <RateSuggestionsPortal
              inputRef={rateRef}
              suggestions={rateSuggestions}
              onSelect={(r) => {
                selectRateSuggestion(r);
              }}
              open={showRateSuggestions}
              highlightedIdx={highlightedRateIdx}
            />
          </div>
          {rateError && <p className="field-error">{rateError}</p>}
        </div>

        <div className="form-field">
          <input
            type="text"
            placeholder="Cochera (opcional)"
            value={cochera}
            onChange={(e) => {
              setCochera(e.target.value);
            }}
            onKeyDown={handleOptionalKeyDown}
            maxLength={100}
          />
        </div>

        <div className="form-field">
          <input
            type="text"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            onKeyDown={handleOptionalKeyDown}
            maxLength={500}
          />
        </div>

        <div className="entry-form-actions">
          {extraActions}
          <button
            // type="button" es obligatorio: sin eso sería el submit implícito
            // del form y terminaría imprimiendo.
            type="button"
            className="entry-action-square"
            onClick={() => void handleSubmitWithoutPrinting()}
            disabled={saving || !canSubmit}
            title="Registrar sin imprimir ticket"
            aria-label="Registrar sin imprimir ticket"
          >
            <PrinterX size={24} aria-hidden="true" />
          </button>
          <button
            type="submit"
            className={`primary-button${awaitingConfirm ? ' primary-button--confirm' : ''}`}
            disabled={saving || !canSubmit}
            title="Registrar ingreso e imprimir ticket"
            aria-label="Registrar ingreso e imprimir ticket"
          >
            {variant === 'auto' || (!saving && !awaitingConfirm) ? (
              <Printer size={18} aria-hidden="true" />
            ) : null}
            <span>
              {saving
                ? 'Registrando...'
                : awaitingConfirm
                  ? '¿Confirmar? (Enter)'
                  : 'Registrar ingreso'}
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}
