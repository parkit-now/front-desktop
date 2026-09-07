import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

const MAX_NOTES_LENGTH = 500;

interface Props {
  notes: string;
  onSave: (notes: string) => Promise<void>;
}

export function CashSessionNotesEditor({ notes, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [saving, setSaving] = useState(false);

  // A sync pull can bring newer notes while the section sits idle.
  useEffect(() => {
    if (!editing) setDraft(notes);
  }, [notes, editing]);

  async function handleSave(): Promise<void> {
    const clean = draft.trim();
    if (clean === notes.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(clean);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="csd-section">
      <div className="csd-notes-header">
        <h4 className="csd-section-title">Notas del turno</h4>
        {!editing ? (
          <button
            type="button"
            className="csd-notes-edit"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} aria-hidden="true" />
            {notes ? 'Editar' : 'Agregar nota'}
          </button>
        ) : null}
      </div>

      {editing ? (
        <>
          <textarea
            className="csd-notes-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_NOTES_LENGTH}
            rows={3}
            placeholder="Observaciones del turno..."
            disabled={saving}
            autoFocus
          />
          <div className="csd-notes-actions">
            <span className="csd-notes-counter">
              {draft.length}/{MAX_NOTES_LENGTH}
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setDraft(notes);
                setEditing(false);
              }}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button compact"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Guardar nota'}
            </button>
          </div>
        </>
      ) : notes ? (
        <p className="csd-notes">{notes}</p>
      ) : (
        <p className="muted">Sin notas para este turno.</p>
      )}
    </div>
  );
}
