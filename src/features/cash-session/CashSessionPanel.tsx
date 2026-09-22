import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { History } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { CashSessionStats } from './CashSessionStats';
import { CloseCashSessionDialog } from './CloseCashSessionDialog';
import { NoCashSessionScreen } from './NoCashSessionScreen';

interface Props {
  tenantId: string;
  accessToken: string;
  onViewMovements?: () => void;
}

export function CashSessionPanel({
  tenantId,
  accessToken,
  onViewMovements,
}: Props) {
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const { isOnline } = useNetwork();
  const { showToast } = useToast();

  const activeSession = useLiveQuery(
    () =>
      localDb.cashSessions
        .where('tenantId')
        .equals(tenantId)
        .filter((s) => !s.closedAt)
        .first(),
    [tenantId],
  );

  if (!activeSession) {
    return (
      <NoCashSessionScreen tenantId={tenantId} accessToken={accessToken} />
    );
  }

  return (
    <div className="cash-session-panel">
      <div className="cash-session-header">
        <div>
          <h2 className="cash-session-title">Caja activa</h2>
          <p className="muted">
            Abierta: {formatArgentinaDateTime(activeSession.openedAt)}
          </p>
        </div>
        <div className="cash-session-header-actions">
          {onViewMovements ? (
            <button
              type="button"
              className="ghost-button compact"
              onClick={onViewMovements}
            >
              <History size={15} aria-hidden="true" />
              Ver movimientos en el historial
            </button>
          ) : null}
          {/*
            Cerrar caja es la única operativa que EXIGE conexión, a diferencia
            del resto del panel: el servidor cierra el turno, abre el
            siguiente y renumera los tickets de los autos que siguen adentro
            sólo si el operador lo pide, todo en una transacción. Replicar esa
            renumeración offline dejaría dos fuentes de verdad para un número
            que el conductor tiene impreso en la mano.

            El botón queda habilitado a propósito y avisa al tocarlo: uno
            deshabilitado no explica nada, y encima no es focusable ni lo
            anuncian los lectores de pantalla. Lo que importa es cortar ACÁ y
            no en el submit — antes el diálogo abría igual, el operador hacía
            todo el arqueo y recién al final se comía un error.
          */}
          <button
            type="button"
            className="ghost-button danger-button"
            onClick={() => {
              if (!isOnline) {
                showToast({
                  message:
                    'Para cerrar la caja necesitás conexión con el servidor. Podés seguir registrando ingresos y egresos mientras tanto.',
                  kind: 'error',
                });
                return;
              }
              setShowCloseDialog(true);
            }}
          >
            Cerrar caja
          </button>
        </div>
      </div>

      <CashSessionStats session={activeSession} />

      {showCloseDialog && (
        <CloseCashSessionDialog
          tenantId={tenantId}
          accessToken={accessToken}
          session={activeSession}
          onClose={() => setShowCloseDialog(false)}
        />
      )}
    </div>
  );
}
