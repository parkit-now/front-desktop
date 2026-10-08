import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LocalEntry } from '../../lib/db/localDb';
import { translateApiError } from '../../lib/api/translate';
import { useToast } from '../../lib/notifications/ToastProvider';
import { saveEntryInlineField } from './entryInlineFields';

type Props = {
  entry: LocalEntry;
  field: 'notes' | 'cochera';
  tenantId: string;
  accessToken: string;
  isOnline: boolean;
  disabledReason?: string;
};

export function InlineEntryField({
  entry,
  field,
  tenantId,
  accessToken,
  isOnline,
  disabledReason,
}: Props) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNotes = field === 'notes';
  const label = isNotes ? 'nota' : 'cochera';
  const currentValue = entry[field] ?? '';

  useEffect(() => {
    if (editing) (textareaRef.current ?? inputRef.current)?.focus();
  }, [editing]);

  function cancel() {
    if (!savingRef.current) setEditing(false);
  }

  async function save() {
    if (savingRef.current) return;
    if (draft.trim() === currentValue) {
      setEditing(false);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const changed = await saveEntryInlineField({
        tenantId,
        entryId: entry.id,
        accessToken,
        isOnline,
        field,
        value: draft,
      });
      if (changed) {
        showToast({
          message: `${isNotes ? 'Nota' : 'Cochera'} guardada${isOnline ? '.' : ' localmente.'}`,
          kind: 'success',
        });
      }
      setEditing(false);
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div
      className={`dt-inline-field dt-inline-field--${field}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!editing) return;
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        } else if (
          event.key === 'Enter' &&
          (!isNotes || event.ctrlKey || event.metaKey)
        ) {
          event.preventDefault();
          void save();
        }
      }}
    >
      {editing ? (
        <div className="dt-inline-field-editor">
          {isNotes ? (
            <textarea
              ref={textareaRef}
              aria-label={`Notas de ${entry.plate}`}
              value={draft}
              maxLength={500}
              rows={3}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <input
              ref={inputRef}
              aria-label={`Cochera de ${entry.plate}`}
              value={draft}
              maxLength={100}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <div className="dt-inline-field-actions">
            <button
              type="button"
              title="Cancelar"
              aria-label={`Cancelar edición de ${label}`}
              disabled={saving}
              onClick={cancel}
            >
              <X size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              title={`Guardar ${label}`}
              aria-label={`Guardar ${label}`}
              disabled={saving}
              onClick={() => void save()}
            >
              <Check size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`dt-inline-field-trigger${currentValue ? '' : ' is-empty'}`}
          title={disabledReason ?? `Editar ${label}`}
          aria-label={
            disabledReason
              ? `${entry.plate}: ${disabledReason}`
              : `Editar ${label} de ${entry.plate}`
          }
          aria-disabled={Boolean(disabledReason)}
          onClick={() => {
            if (disabledReason) return;
            setDraft(currentValue);
            setEditing(true);
          }}
        >
          {currentValue ? (
            <span className="dt-inline-field-value">{currentValue}</span>
          ) : null}
          <Pencil size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
