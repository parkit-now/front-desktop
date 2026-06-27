import { EntryFormCore } from './EntryFormCore';

interface Props {
  tenantId: string;
  accessToken: string;
}

// Manual entry form for the operativo panel. The full field/autocomplete/submit
// logic lives in EntryFormCore, shared with the auto-detected entry cards.
export function EntryForm({ tenantId, accessToken }: Props) {
  return (
    <EntryFormCore
      tenantId={tenantId}
      accessToken={accessToken}
      variant="manual"
    />
  );
}
