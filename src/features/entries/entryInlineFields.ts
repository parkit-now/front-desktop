import { correctEntry } from '../../lib/api/entries';
import { localDb } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';

export type EntryInlineField = 'notes' | 'cochera' | 'manualInvoiceNumber';

type SaveEntryInlineFieldInput = {
  tenantId: string;
  entryId: string;
  accessToken: string;
  isOnline: boolean;
  field: EntryInlineField;
  value: string;
};

export async function saveEntryInlineField({
  tenantId,
  entryId,
  accessToken,
  isOnline,
  field,
  value,
}: SaveEntryInlineFieldInput): Promise<boolean> {
  const nextValue = value.trim();
  const body =
    field === 'notes'
      ? { notes: nextValue }
      : field === 'cochera'
        ? { cochera: nextValue }
        : { manualInvoiceNumber: nextValue };

  if (isOnline) {
    const entry = await localDb.entries.get(entryId);
    if (!entry || entry.tenantId !== tenantId || entry.deletedAt) {
      throw new Error('Entry is no longer available');
    }
    if ((entry[field] ?? '') === nextValue) return false;

    const result = await correctEntry({
      tenantId,
      entryId,
      expectedVersion: entry.version,
      bearer: accessToken,
      body,
    });
    await localDb.entries.update(entryId, {
      [field]: result[field] ?? undefined,
      version: result.version,
      syncSeq: result.syncSeq,
      updatedAt: result.updatedAt,
    });
    return true;
  }

  return localDb.transaction(
    'rw',
    localDb.entries,
    localDb.pendingOps,
    async () => {
      const entry = await localDb.entries.get(entryId);
      if (!entry || entry.tenantId !== tenantId || entry.deletedAt) {
        throw new Error('Entry is no longer available');
      }
      if ((entry[field] ?? '') === nextValue) return false;

      const now = new Date().toISOString();
      const expectedVersion = entry.version;
      await localDb.entries.update(entryId, {
        [field]: nextValue || undefined,
        version: expectedVersion + 1,
        updatedAt: now,
      });
      await enqueuePendingOp({
        entityType: 'entry',
        operation: 'update',
        tenantId,
        entityId: entryId,
        payload: {
          kind: 'correction',
          expectedVersion,
          body,
        },
        status: 'pending',
      });
      return true;
    },
  );
}
