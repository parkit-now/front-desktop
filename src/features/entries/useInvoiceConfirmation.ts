import { useEffect, useRef, useState } from 'react';
import { getInvoicePreview, issueInvoice } from '../../lib/api/arca';
import { ApiError } from '../../lib/api/client';
import type { InvoiceSummaryDto } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import { useToast } from '../../lib/notifications/ToastProvider';
import type { InvoiceLetter } from './invoiceUtils';

type ReceiverSnapshot = {
  letter: InvoiceLetter | null;
  cuit: string | null | undefined;
  receiverName?: string | null;
};

export function useInvoiceConfirmation(input: {
  tenantId: string;
  entryId: string;
  bearer: string;
}) {
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState<
    (ReceiverSnapshot & { amount: number }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    working.current = false;
    setSnapshot(null);
    setBusy(false);
    return () => {
      generation.current += 1;
    };
  }, [input.tenantId, input.entryId]);

  async function prepare(receiver: ReceiverSnapshot, active: number) {
    setSnapshot(null);
    const preview = await getInvoicePreview(input);
    if (generation.current === active)
      setSnapshot({ ...receiver, amount: preview.amount });
  }

  async function open(receiver: ReceiverSnapshot) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const active = generation.current;
    try {
      await prepare(receiver, active);
    } catch (error) {
      if (generation.current === active)
        showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      if (generation.current === active) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  async function confirm(
    onResult: (invoice: InvoiceSummaryDto) => void | Promise<void>,
  ) {
    if (working.current || !snapshot) return;
    working.current = true;
    setBusy(true);
    const active = generation.current;
    const confirmed = snapshot;
    try {
      const result = await issueInvoice({
        ...input,
        receiverCuit: confirmed.cuit ?? undefined,
        expectedAmount: confirmed.amount,
      });
      if (generation.current !== active) return;
      setSnapshot(null);
      await onResult(result);
    } catch (error) {
      if (generation.current !== active) return;
      setSnapshot(null);
      showToast({ message: translateApiError(error), kind: 'error' });
      if (
        error instanceof ApiError &&
        error.problem?.code === 'INVOICE_AMOUNT_CHANGED'
      ) {
        try {
          await prepare(confirmed, active);
        } catch (refreshError) {
          if (generation.current === active)
            showToast({
              message: translateApiError(refreshError),
              kind: 'error',
            });
        }
      }
    } finally {
      if (generation.current === active) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  function close() {
    if (!working.current) setSnapshot(null);
  }

  return { snapshot, busy, open, confirm, close };
}
