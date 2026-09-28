import { useEffect, useMemo, useState } from 'react';
import {
  listInvoiceReceivers,
  lookupTaxpayer,
  type InvoiceReceiverDto,
  type TaxpayerDto,
} from '../../lib/api/arca';
import { translateApiError } from '../../lib/api/translate';
import {
  isReceiverReady,
  isValidCuit,
  normalizeCuit,
  receiverCuitError,
  receiverCuitToSend,
  type ReceiverChoice,
  type TaxpayerLookup,
} from './invoiceUtils';

/** Espera después de la última tecla antes de consultar el padrón. */
const LOOKUP_DEBOUNCE_MS = 250;

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
}) {
  const { tenantId, accessToken, isOnline } = input;
  const [choice, setChoiceState] = useState<ReceiverChoice>('final');
  const [cuit, setCuit] = useState('');
  const [touched, setTouched] = useState(false);
  const [lookup, setLookup] = useState<TaxpayerLookup>({ status: 'idle' });
  const [suggestions, setSuggestions] = useState<InvoiceReceiverDto[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  const digits = normalizeCuit(cuit);
  const wantsCuit = choice === 'cuit' && isOnline;

  useEffect(() => {
    if (!wantsCuit || !isValidCuit(digits) || !accessToken) {
      setLookup({ status: 'idle' });
      return;
    }
    const key = `${tenantId}:${digits}`;
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
    const state = { choice: effectiveChoice, cuit, lookup };
    const error = effectiveChoice === 'cuit' ? receiverCuitError(cuit) : null;
    return {
      /** Lo elegido; offline es siempre consumidor final. */
      choice: effectiveChoice,
      setChoice: (next: ReceiverChoice) => {
        setChoiceState(next);
        setTouched(false);
      },
      cuit,
      setCuit,
      markTouched: () => setTouched(true),
      lookup,
      suggestions,
      /**
       * El error aparece al salir del campo o con los 11 dígitos, nunca con
       * el campo vacío: ahí alcanza con la ayuda y el botón deshabilitado.
       */
      visibleCuitError:
        digits.length > 0 && (touched || digits.length >= 11) ? error : null,
      ready: isReceiverReady(state),
      cuitToSend: receiverCuitToSend(state),
      receiverName:
        lookup.status === 'done' && lookup.taxpayer.identified
          ? lookup.taxpayer.razonSocial
          : null,
    };
  }, [wantsCuit, cuit, lookup, suggestions, digits, touched]);
}

export type InvoiceReceiverState = ReturnType<typeof useInvoiceReceiver>;
