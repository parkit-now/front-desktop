import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listInvoiceReceivers,
  getInvoiceReceiverSuggestion,
  lookupTaxpayer,
  type InvoiceReceiverDto,
  type TaxpayerDto,
} from '../../lib/api/arca';
import { translateApiError } from '../../lib/api/translate';
import { localDb } from '../../lib/db/localDb';
import {
  isReceiverReady,
  isValidCuit,
  latestInvoiceReceiverForPlate,
  normalizeCuit,
  receiverCuitError,
  receiverCuitToSend,
  type ReceiverChoice,
  type TaxpayerLookup,
} from './invoiceUtils';

/** Espera después de la última tecla antes de consultar el padrón. */
const LOOKUP_DEBOUNCE_MS = 250;
const RECEIVER_SUGGESTION_TIMEOUT_MS = 5000;

/**
 * Respuestas del padrón de esta sesión, por playa y CUIT: volver a elegir un
 * CUIT (o reabrir el cobro) no vuelve a esperar a ARCA. El backend tiene su
 * propia caché de 30 días; esta es sólo para no repetir el viaje.
 */
const lookupCache = new Map<string, TaxpayerDto>();

/**
 * El receptor de la factura en el cobro y en «Emitir factura»: consumidor
 * final o un CUIT, con la consulta al padrón mientras se tipea y los CUIT ya
 * facturados como sugerencias. Todo necesita red: offline sólo hay consumidor
 * final.
 */
export function useInvoiceReceiver(input: {
  readonly tenantId: string;
  readonly accessToken: string;
  readonly isOnline: boolean;
  readonly plate?: string | null;
  readonly entryId?: string;
  readonly paymentIntentId?: string;
  readonly suggestionEnabled?: boolean;
  readonly frozen?: boolean;
}) {
  const { tenantId, accessToken, isOnline, plate = null } = input;
  const [choice, setChoiceState] = useState<ReceiverChoice>('final');
  const [cuit, setCuit] = useState('');
  const [touched, setTouched] = useState(false);
  const [lookup, setLookup] = useState<TaxpayerLookup>({ status: 'idle' });
  const [suggestions, setSuggestions] = useState<InvoiceReceiverDto[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const autofillKeyRef = useRef<string | null>(null);
  const userEditedRef = useRef(false);
  const [userEdited, setUserEdited] = useState(false);
  const [source, setSource] = useState<'mercadopago' | null>(null);
  const sourceRef = useRef<'mercadopago' | null>(null);
  const frozenRef = useRef(false);
  const [settledSuggestion, setSettledSuggestion] = useState<string | null>(
    null,
  );
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const {
    entryId,
    paymentIntentId,
    suggestionEnabled = false,
    frozen = false,
  } = input;
  const identity = `${tenantId}:${entryId ?? plate ?? ''}`;
  const identityRef = useRef(identity);
  const tokenRef = useRef(accessToken);
  const completedSuggestionRef = useRef<string | null>(null);
  const suggestionScope = `${tenantId}:${entryId ?? ''}:${paymentIntentId ?? ''}`;
  const enabled =
    suggestionEnabled && isOnline && Boolean(entryId && accessToken);
  const resolvingSuggestion =
    enabled && settledSuggestion !== suggestionScope && !userEdited;

  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);
  useEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    userEditedRef.current = false;
    sourceRef.current = null;
    autofillKeyRef.current = null;
    setUserEdited(false);
    setSource(null);
    setChoiceState('final');
    setCuit('');
    setTouched(false);
    setSuggestions([]);
    setSuggestionsLoaded(false);
  }, [identity]);

  useEffect(() => {
    if (!enabled || !entryId) {
      if (!suggestionEnabled) completedSuggestionRef.current = null;
      setSettledSuggestion(null);
      return;
    }
    if (userEditedRef.current) return;
    if (completedSuggestionRef.current === suggestionScope) {
      setSettledSuggestion(suggestionScope);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      completedSuggestionRef.current = suggestionScope;
      setSettledSuggestion(suggestionScope);
    }, RECEIVER_SUGGESTION_TIMEOUT_MS);
    void getInvoiceReceiverSuggestion({
      tenantId,
      entryId,
      paymentIntentId,
      bearer: tokenRef.current,
      signal: controller.signal,
    })
      .then(({ cuit: suggestedCuit }) => {
        if (
          controller.signal.aborted ||
          userEditedRef.current ||
          frozenRef.current ||
          !suggestedCuit ||
          !isValidCuit(suggestedCuit)
        )
          return;
        sourceRef.current = 'mercadopago';
        setSource('mercadopago');
        setChoiceState('cuit');
        setCuit(suggestedCuit);
        setTouched(false);
      })
      .catch(() => {
        /* Optional suggestion: keep the usual receiver. */
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          completedSuggestionRef.current = suggestionScope;
          setSettledSuggestion(suggestionScope);
        }
        window.clearTimeout(timer);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    suggestionEnabled,
    tenantId,
    entryId,
    paymentIntentId,
    suggestionScope,
  ]);

  const digits = normalizeCuit(cuit);
  const wantsCuit = choice === 'cuit' && isOnline;

  useEffect(() => {
    if (!isOnline || !plate) return;
    const normalizedPlate = plate.trim().toUpperCase();
    if (!normalizedPlate) return;

    const key = `${tenantId}:${normalizedPlate}`;
    if (autofillKeyRef.current === key || userEditedRef.current) return;
    autofillKeyRef.current = key;

    let cancelled = false;
    Promise.all([
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter(
          (entry) =>
            !entry.deletedAt &&
            entry.plate.trim().toUpperCase() === normalizedPlate,
        )
        .toArray(),
      localDb.invoices.where('tenantId').equals(tenantId).toArray(),
    ])
      .then(([entries, invoices]) => {
        if (
          cancelled ||
          userEditedRef.current ||
          sourceRef.current ||
          frozenRef.current
        )
          return;
        const previous = latestInvoiceReceiverForPlate({
          tenantId,
          plate: normalizedPlate,
          entries,
          invoices,
        });
        if (!previous) return;
        setChoiceState('cuit');
        setCuit(previous.cuit);
        setTouched(false);
      })
      .catch(() => {
        // Sin autocompletado se puede facturar igual: el operador tipea o usa
        // las sugerencias generales del estacionamiento.
      });

    return () => {
      cancelled = true;
    };
  }, [isOnline, plate, tenantId, identity]);

  useEffect(() => {
    if (!wantsCuit || !isValidCuit(digits) || !accessToken) {
      setLookup({ status: 'idle' });
      return;
    }
    const key = `${tenantId}:${digits}`;
    setLookupKey(key);
    const cached = lookupCache.get(key);
    if (cached) {
      setLookup({ status: 'done', taxpayer: cached });
      return;
    }
    setLookup({ status: 'loading' });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      lookupTaxpayer({ tenantId, cuit: digits, bearer: accessToken })
        .then((taxpayer) => {
          lookupCache.set(key, taxpayer);
          if (!cancelled) setLookup({ status: 'done', taxpayer });
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setLookup({ status: 'error', message: translateApiError(error) });
          }
        });
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wantsCuit, digits, tenantId, accessToken]);

  useEffect(() => {
    if (!wantsCuit || suggestionsLoaded || !accessToken) return;
    let cancelled = false;
    listInvoiceReceivers({ tenantId, bearer: accessToken })
      .then((rows) => {
        if (!cancelled) setSuggestions(rows);
      })
      .catch(() => {
        // Sin sugerencias se tipea el CUIT entero: no vale un error.
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsCuit, suggestionsLoaded, tenantId, accessToken]);

  return useMemo(() => {
    const effectiveChoice: ReceiverChoice = wantsCuit ? 'cuit' : 'final';
    const currentLookup: TaxpayerLookup =
      wantsCuit && isValidCuit(digits) && lookupKey !== `${tenantId}:${digits}`
        ? { status: 'loading' }
        : lookup;
    const state = { choice: effectiveChoice, cuit, lookup: currentLookup };
    const error = effectiveChoice === 'cuit' ? receiverCuitError(cuit) : null;
    return {
      /** Lo elegido; offline es siempre consumidor final. */
      choice: effectiveChoice,
      setChoice: (next: ReceiverChoice) => {
        userEditedRef.current = true;
        setUserEdited(true);
        setSource(null);
        setChoiceState(next);
        setTouched(false);
      },
      cuit,
      setCuit: (next: string) => {
        userEditedRef.current = true;
        setUserEdited(true);
        setSource(null);
        setCuit(next);
      },
      markTouched: () => setTouched(true),
      lookup: currentLookup,
      source,
      resolvingSuggestion,
      suggestions,
      /**
       * El error aparece al salir del campo o con los 11 dígitos, nunca con
       * el campo vacío: ahí alcanza con la ayuda y el botón deshabilitado.
       */
      visibleCuitError:
        digits.length > 0 && (touched || digits.length >= 11) ? error : null,
      ready: !resolvingSuggestion && isReceiverReady(state),
      cuitToSend: receiverCuitToSend(state),
      receiverName:
        currentLookup.status === 'done' && currentLookup.taxpayer.identified
          ? currentLookup.taxpayer.razonSocial
          : null,
    };
  }, [
    wantsCuit,
    cuit,
    lookup,
    suggestions,
    digits,
    touched,
    lookupKey,
    tenantId,
    source,
    resolvingSuggestion,
  ]);
}

export type InvoiceReceiverState = ReturnType<typeof useInvoiceReceiver>;
