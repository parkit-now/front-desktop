import { EntryFormCore, type ManualEntryDraft } from './EntryFormCore';

interface Props {
  tenantId: string;
  accessToken: string;
  /** Header of the printed entry ticket. */
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
  initialDraft?: ManualEntryDraft | null;
  onDraftChange?: (draft: ManualEntryDraft) => void;
  onDraftReset?: () => void;
}

// Manual entry form for the operativo panel. The full field/autocomplete/submit
// logic lives in EntryFormCore, shared with the auto-detected entry cards.
export function EntryForm({
  tenantId,
  accessToken,
  parkingName = null,
  parkingAddress = null,
  parkingCuit = null,
  initialDraft = null,
  onDraftChange,
  onDraftReset,
}: Props) {
  return (
    <EntryFormCore
      tenantId={tenantId}
      accessToken={accessToken}
      variant="manual"
      parkingName={parkingName}
      parkingAddress={parkingAddress}
      parkingCuit={parkingCuit}
      initialDraft={initialDraft}
      onDraftChange={onDraftChange}
      onDraftReset={onDraftReset}
    />
  );
}
