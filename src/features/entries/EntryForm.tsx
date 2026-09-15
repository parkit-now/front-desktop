import { EntryFormCore } from './EntryFormCore';

interface Props {
  tenantId: string;
  accessToken: string;
  /** Header of the printed entry ticket. */
  parkingName?: string | null;
  parkingAddress?: string | null;
}

// Manual entry form for the operativo panel. The full field/autocomplete/submit
// logic lives in EntryFormCore, shared with the auto-detected entry cards.
export function EntryForm({
  tenantId,
  accessToken,
  parkingName = null,
  parkingAddress = null,
}: Props) {
  return (
    <EntryFormCore
      tenantId={tenantId}
      accessToken={accessToken}
      variant="manual"
      parkingName={parkingName}
      parkingAddress={parkingAddress}
    />
  );
}
