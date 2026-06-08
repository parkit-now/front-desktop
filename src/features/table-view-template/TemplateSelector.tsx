import { Bookmark, Info, Save, Trash2, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '../../lib/ui/useCloseOnOutsideClick';
import type {
  TableTemplateScope,
  TableViewConfig,
  TableViewTemplate,
} from './definitions';
import { useTableViewTemplates } from './useTableViewTemplates';

type TemplateSelectorProps = {
  scope?: TableTemplateScope;
  selectedTemplateId: string | null;
  onSelectedTemplateIdChange: (templateId: string | null) => void;
  getCurrentConfig: () => TableViewConfig;
  onApply: (config: TableViewConfig | null) => void;
};

export function TemplateSelector({
  scope,
  selectedTemplateId,
  onSelectedTemplateIdChange,
  getCurrentConfig,
  onApply,
}: TemplateSelectorProps) {
  const templatesApi = useTableViewTemplates(scope);
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [editingTemplate, setEditingTemplate] =
    useState<TableViewTemplate | null>(null);
  const [metadataName, setMetadataName] = useState('');
  const [metadataDescription, setMetadataDescription] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);

  useCloseOnOutsideClick(menuRef, open, closeMenu);

  const selectedTemplate = useMemo(
    () =>
      templatesApi.templates.find(
        (template) => template.id === selectedTemplateId,
      ) ?? null,
    [selectedTemplateId, templatesApi.templates],
  );

  if (!templatesApi.enabled) return null;

  function applyTemplate(templateId: string | null): void {
    if (templateId === null) {
      onSelectedTemplateIdChange(null);
      templatesApi.setLastUsed(null);
      onApply(null);
      setOpen(false);
      return;
    }

    const template = templatesApi.templates.find(
      (item) => item.id === templateId,
    );
    if (!template) return;
    onSelectedTemplateIdChange(template.id);
    templatesApi.setLastUsed(template.id);
    onApply(template.config);
    setOpen(false);
  }

  function openSaveDialog(): void {
    setSaveName('');
    setSaveDescription('');
    setOpen(false);
    setSaveDialogOpen(true);
  }

  function handleSaveTemplate(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedName = saveName.trim();
    if (!trimmedName) return;

    const template = templatesApi.save({
      name: trimmedName,
      description: saveDescription.trim() || undefined,
      config: getCurrentConfig(),
    });
    if (!template) return;

    onSelectedTemplateIdChange(template.id);
    setSaveDialogOpen(false);
  }

  function handleOverwrite(): void {
    if (!selectedTemplateId) return;
    const updated = templatesApi.overwrite(
      selectedTemplateId,
      getCurrentConfig(),
    );
    if (updated) templatesApi.setLastUsed(updated.id);
  }

  function openMetadataDialog(template: TableViewTemplate): void {
    setEditingTemplate(template);
    setMetadataName(template.name);
    setMetadataDescription(template.description ?? '');
    setOpen(false);
  }

  function handleSaveMetadata(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!editingTemplate) return;

    const updated = templatesApi.updateMetadata(editingTemplate.id, {
      name: metadataName,
      description: metadataDescription,
    });
    if (!updated) return;
    setEditingTemplate(null);
  }

  function handleDelete(templateId: string): void {
    const template = templatesApi.templates.find(
      (item) => item.id === templateId,
    );
    const accepted = window.confirm(
      `¿Eliminar la plantilla "${template?.name ?? 'seleccionada'}"?`,
    );
    if (!accepted) return;

    templatesApi.remove(templateId);
    if (selectedTemplateId === templateId) {
      onSelectedTemplateIdChange(null);
      onApply(null);
    }
  }

  return (
    <>
      <div className="dt-menu dt-template-menu" ref={menuRef}>
        <button
          type="button"
          className="dt-icon-button"
          title="Plantillas de tabla"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Bookmark size={17} />
          <span className="dt-sr-only">Plantillas</span>
        </button>
        {open ? (
          <div className="dt-menu-panel dt-template-panel">
            <div className="dt-menu-heading">
              <span>Plantillas</span>
              {selectedTemplate ? <small>{selectedTemplate.name}</small> : null}
            </div>

            <button
              type="button"
              className={`dt-menu-action ${selectedTemplateId === null ? 'active' : ''}`}
              onClick={() => applyTemplate(null)}
            >
              Sin plantilla
            </button>

            <div className="dt-template-list">
              {templatesApi.templates.length === 0 ? (
                <p className="dt-empty-note">No hay plantillas guardadas.</p>
              ) : (
                templatesApi.templates.map((template) => (
                  <div className="dt-template-row" key={template.id}>
                    <button
                      type="button"
                      className={`dt-template-choice ${template.id === selectedTemplateId ? 'active' : ''}`}
                      onClick={() => applyTemplate(template.id)}
                    >
                      <span>{template.name}</span>
                    </button>
                    <button
                      type="button"
                      className="dt-mini-icon"
                      title={template.description?.trim() || 'Sin descripción'}
                      onClick={() => openMetadataDialog(template)}
                    >
                      <Info size={14} />
                    </button>
                    <button
                      type="button"
                      className="dt-mini-icon danger"
                      onClick={() => handleDelete(template.id)}
                      title="Eliminar plantilla"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="dt-template-footer">
              <button
                type="button"
                className="dt-primary-action"
                onClick={openSaveDialog}
              >
                <Bookmark size={15} /> Guardar plantilla
              </button>
              <button
                type="button"
                className="dt-secondary-action"
                onClick={handleOverwrite}
                disabled={!selectedTemplateId}
              >
                <Save size={15} /> Actualizar actual
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {saveDialogOpen ? (
        <div
          className="dt-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSaveDialogOpen(false);
          }}
        >
          <form
            className="dt-small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Guardar plantilla"
            onSubmit={handleSaveTemplate}
          >
            <header>
              <div>
                <p>Plantilla</p>
                <h3>Guardar vista actual</h3>
              </div>
              <button
                type="button"
                className="dt-dialog-close"
                onClick={() => setSaveDialogOpen(false)}
                aria-label="Cerrar"
              >
                <X size={17} />
              </button>
            </header>
            <label>
              <span>Nombre</span>
              <input
                type="text"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder="Ej. Operación diaria"
                autoFocus
              />
            </label>
            <label>
              <span>Descripción</span>
              <textarea
                value={saveDescription}
                onChange={(event) => setSaveDescription(event.target.value)}
                placeholder="Opcional"
                rows={3}
              />
            </label>
            <div className="dt-dialog-actions">
              <button
                type="button"
                className="dt-secondary-action"
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="dt-primary-action"
                disabled={!saveName.trim()}
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingTemplate ? (
        <div
          className="dt-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingTemplate(null);
          }}
        >
          <form
            className="dt-small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Editar descripción de plantilla"
            onSubmit={handleSaveMetadata}
          >
            <header>
              <div>
                <p>Descripción</p>
                <h3>Editar plantilla</h3>
              </div>
              <button
                type="button"
                className="dt-dialog-close"
                onClick={() => setEditingTemplate(null)}
                aria-label="Cerrar"
              >
                <X size={17} />
              </button>
            </header>
            <label>
              <span>Nombre</span>
              <input
                type="text"
                value={metadataName}
                onChange={(event) => setMetadataName(event.target.value)}
                autoFocus
              />
            </label>
            <label>
              <span>Descripción</span>
              <textarea
                value={metadataDescription}
                onChange={(event) => setMetadataDescription(event.target.value)}
                placeholder="Sin descripción"
                rows={3}
              />
            </label>
            <div className="dt-dialog-actions">
              <button
                type="button"
                className="dt-secondary-action"
                onClick={() => setEditingTemplate(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="dt-primary-action"
                disabled={!metadataName.trim()}
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
