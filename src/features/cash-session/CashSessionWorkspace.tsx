import { useState, type ComponentProps } from 'react';
import { CashSessionPanel } from './CashSessionPanel';
import { CashSessionHistoryPanel } from './CashSessionHistoryPanel';
import { CashSessionMovementsDialog } from './CashSessionMovementsDialog';

type Props = Omit<
  ComponentProps<typeof CashSessionMovementsDialog>,
  'cashSessionId' | 'onClose'
> & {
  canViewHistory: boolean;
};

export function CashSessionWorkspace({ canViewHistory, ...props }: Props) {
  const [movementsSessionId, setMovementsSessionId] = useState<string | null>(
    null,
  );
  return (
    <div className="caja-layout">
      <CashSessionPanel
        tenantId={props.tenantId}
        accessToken={props.accessToken}
        parkingName={props.parkingName}
        onViewMovements={(session) => setMovementsSessionId(session.id)}
      />
      {canViewHistory ? (
        <CashSessionHistoryPanel
          tenantId={props.tenantId}
          accessToken={props.accessToken}
          detailSuspended={Boolean(movementsSessionId)}
          onSelectSession={(session) => setMovementsSessionId(session.id)}
        />
      ) : null}
      {movementsSessionId ? (
        <CashSessionMovementsDialog
          {...props}
          key={movementsSessionId}
          cashSessionId={movementsSessionId}
          onClose={() => setMovementsSessionId(null)}
        />
      ) : null}
    </div>
  );
}
