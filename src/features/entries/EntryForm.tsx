import { useLiveQuery } from 'dexie-react-hooks';
import { createPortal } from 'react-dom';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import { createEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { getAllStaticVehicles } from '../../lib/data/vehicleBrands';
import { COLORS } from '../../lib/data/colors';
import { generateUuidV7 } from './entryUtils';
import { type LocalRate } from '../../lib/db/localDb';

interface Props {
  tenantId: string;
  accessToken: string;
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

export function EntryForm({ tenantId, accessToken }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();

  // Field values
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [vehicleInput, setVehicleInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [color, setColor] = useState('');
  const [colorSelected, setColorSelected] = useState(false);
  const [showColorSuggestions, setShowColorSuggestions] = useState(false);
  const [highlightedColorIdx, setHighlightedColorIdx] = useState(0);
  const [rateId, setRateId] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [rateSelected, setRateSelected] = useState(false);
  const [showRateSuggestions, setShowRateSuggestions] = useState(false);
  const [highlightedRateIdx, setHighlightedRateIdx] = useState(0);
  const [cochera, setCochera] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Field errors
  const [plateError, setPlateError] = useState('');
  const [vehicleError, setVehicleError] = useState('');
  const [colorError, setColorError] = useState('');
  const [rateError, setRateError] = useState('');

  // Highlighted suggestion index for keyboard navigation
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(0);

  // Double-Enter confirmation state
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for Enter/Tab navigation
  const plateRef = useRef<HTMLInputElement>(null);
  const vehicleInputRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);

  const plateResolved = useRef(false);
  // True when user explicitly selected a catalog suggestion (brand+model resolved).
  const [vehicleSelected, setVehicleSelected] = useState(false);

  const activeRates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((r) => r.isActive)
        .sortBy('name'),
    [tenantId],
  );

  // Catalog vehicles visible to this tenant (global + own). Exclude soft-deleted.
  const catalogVehicles = useLiveQuery(
    () => localDb.vehicles.filter((v) => !v.deletedAt).toArray(),
    [],
  );

  useEffect(() => {
    plateResolved.current = false;
  }, [plate]);

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
      void submitEntry();
      return;
    }
    setAwaitingConfirm(true);
    confirmTimeoutRef.current = setTimeout(() => {
      setAwaitingConfirm(false);
    }, 2500);
  }

  // On plate blur: look up previous entries for this tenant with the same plate
  // and pre-fill vehicle, color and last rate if the fields are currently empty.
  async function handlePlateBlur() {
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

    const source: { brand: string; model: string }[] =
      catalogVehicles && catalogVehicles.length > 0
        ? catalogVehicles
        : getAllStaticVehicles();

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

  // True when the current vehicleInput query matches at least one catalog entry.
  // Independent of vehicleSelected — used to enforce catalog selection.
  const hasCatalogMatches = useMemo(() => {
    const q = vehicleInput.trim().toLowerCase();
    if (!q) return false;
    const source =
      catalogVehicles && catalogVehicles.length > 0
        ? catalogVehicles
        : getAllStaticVehicles();
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
      setVehicleError(
        hasCatalogMatches
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
    vehicleSelected &&
    colorSelected &&
    rateSelected;

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submitEntry(): Promise<void> {
    const normalizedPlate = plate.trim().toUpperCase();
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
              cashSessionId: activeSession?.id,
              ticketNumber,
              version: 1,
              syncSeq: 0,
              updatedAt: now,
            });
            await localDb.pendingOps.add({
              entityType: 'entry',
              operation: 'create',
              tenantId,
              entityId: entryId,
              payload: body,
              status: 'pending',
              createdAt: Date.now(),
              retryCount: 0,
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

      // Reset all fields
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
      setTimeout(() => plateRef.current?.focus(), 50);
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
    await submitEntry();
  }

  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      <h3 className="entry-form-title">Registrar ingreso</h3>

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
              resetConfirm();
            }}
            onBlur={() => {
              void handlePlateBlur();
            }}
            onKeyDown={handlePlateKeyDown}
            className={`entry-form-plate${plateError ? ' input-error' : ''}`}
            maxLength={7}
            autoFocus
          />
          {plateError && <p className="field-error">{plateError}</p>}
        </div>

        <div className="form-field">
          <div className="entry-form-vehicle-input-container">
            <input
              ref={vehicleInputRef}
              type="text"
              placeholder="Vehículo (ej. Bora, BMW, Toyota Hilux)"
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

        <button
          type="submit"
          className={`primary-button${awaitingConfirm ? ' primary-button--confirm' : ''}`}
          disabled={saving || !canSubmit}
        >
          {saving
            ? 'Registrando...'
            : awaitingConfirm
              ? '¿Confirmar? (Enter)'
              : 'Registrar ingreso'}
        </button>
      </div>
    </form>
  );
}
