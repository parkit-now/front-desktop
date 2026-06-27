import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Car, LogOut } from 'lucide-react';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useToast } from '../../lib/notifications/ToastProvider';
import { ActiveVehiclesDialog } from './ActiveVehiclesDialog';
import { ExitModal } from './ExitModal';

interface Props {
  tenantId: string;
  accessToken: string;
  userId: string;
}

// Egresos zone under the manual entry form: charge a car by its ticket number,
// or open the full "autos en base" table to pick one. Both routes open ExitModal.
export function ExitControls({ tenantId, accessToken, userId }: Props) {
  const { showToast } = useToast();
  const [ticket, setTicket] = useState('');
  const [searching, setSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exitEntry, setExitEntry] = useState<LocalEntry | null>(null);

  const activeCount = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => !e.leftAt)
        .count(),
    [tenantId],
  );

  async function findByTicket(n: number): Promise<LocalEntry | undefined> {
    const session = await localDb.cashSessions
      .where('tenantId')
      .equals(tenantId)
      .filter((s) => !s.closedAt)
      .first();

    if (session) {
      const inSession = await localDb.entries
        .where('cashSessionId')
        .equals(session.id)
        .filter((e) => e.ticketNumber === n && !e.leftAt)
        .first();
      if (inSession) return inSession;
    }

    // Fallback: any active entry in this tenant with that ticket number.
    return localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.ticketNumber === n && !e.leftAt)
      .first();
  }

  async function handleTicketSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const n = Number.parseInt(ticket.trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      showToast({
        message: 'Ingresá un número de ticket válido.',
        kind: 'error',
      });
      return;
    }
    setSearching(true);
    try {
      const entry = await findByTicket(n);
      if (!entry) {
        showToast({
          message: `No hay ningún auto activo con el ticket #${n}.`,
          kind: 'error',
        });
        return;
      }
      setExitEntry(entry);
      setTicket('');
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="exit-controls">
      <h3 className="exit-controls__title">
        <LogOut size={18} aria-hidden="true" />
        Registrar egreso
      </h3>

      <form
        className="exit-controls__form"
        onSubmit={(e) => void handleTicketSubmit(e)}
      >
        <input
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="N° de ticket (ej. 3)"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          className="exit-controls__ticket"
          disabled={searching}
        />
        <button
          type="submit"
          className="primary-button compact exit-controls__confirm"
          disabled={searching || ticket.trim().length === 0}
        >
          Cobrar
        </button>
      </form>

      <button
        type="button"
        className="exit-controls__list-button"
        onClick={() => setDialogOpen(true)}
      >
        <span className="exit-controls__list-icon" aria-hidden="true">
          <Car size={17} />
        </span>
        <span className="exit-controls__list-label">Ver autos en base</span>
        <span className="exit-controls__list-count">{activeCount ?? 0}</span>
      </button>

      {dialogOpen ? (
        <ActiveVehiclesDialog
          tenantId={tenantId}
          userId={userId}
          onExit={(entry) => {
            setExitEntry(entry);
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}

      {exitEntry ? (
        <ExitModal
          entry={exitEntry}
          tenantId={tenantId}
          accessToken={accessToken}
          onClose={() => setExitEntry(null)}
        />
      ) : null}
    </section>
  );
}
