import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bold,
  GripVertical,
  Printer,
  RefreshCcw,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildEntryTicketHtml } from '../../lib/print/entryTicket';
import {
  fetchEntityProfileSettings,
  updateEntityTicketTemplate,
} from '../../lib/api/entities';
import {
  describePrintFailure,
  type PrintOutcome,
} from '../../lib/print/printTicket';
import {
  PAPER_SIZES,
  readPrinterSettings,
  setPaperSize,
  setSelectedPrinter,
  setTailFeedMm,
  TAIL_FEED_OPTIONS_MM,
  type PaperSize,
} from '../../lib/print/printerSettings';
import {
  fontSizeToOption,
  normalizeTicketTemplateSettings,
  readTicketTemplateSettings,
  resetTicketTemplateSettings,
  TICKET_TEMPLATE_FIELD_LABELS,
  TICKET_TEMPLATE_SIZE_OPTIONS,
  ticketTemplatePayload,
  type TicketTemplateField,
  type TicketTemplateFontSize,
  type TicketTemplateSettings,
  writeTicketTemplateSettings,
} from '../../lib/print/ticketTemplate';
import { useToast } from '../../lib/notifications/ToastProvider';
import { AppSelect } from '../../lib/ui/AppSelect';

interface Props {
  tenantId: string | null;
  tenantName: string | null;
  tenantAddress: string | null;
  tenantCuit?: string | null;
  actorRole?: 'admin' | 'owner' | 'operator' | null;
  accessToken?: string | null;
}

const SYSTEM_DEFAULT = '';

const FIELD_SIZE_OPTIONS = (
  Object.keys(TICKET_TEMPLATE_SIZE_OPTIONS) as TicketTemplateFontSize[]
).map((key) => ({
  value: key,
  label: TICKET_TEMPLATE_SIZE_OPTIONS[key].label,
}));

function testTicketData({
  tenantName,
  tenantAddress,
  tenantCuit,
}: {
  tenantName: string | null;
  tenantAddress: string | null;
  tenantCuit?: string | null;
}) {
  return {
    parkingName: tenantName,
    parkingAddress: tenantAddress,
    parkingCuit: tenantCuit ?? null,
    plate: 'ABC 123',
    vehicleBrand: 'VW',
    vehicleModel: 'Suran',
    color: 'Negra',
    cochera: '12',
    notes: 'Llave en oficina',
    enteredAt: new Date().toISOString(),
    rateNumber: 2,
    rateName: 'Auto',
    ticketNumber: 10,
  };
}

function TemplateFieldRow({
  field,
  disabled = false,
  readOnly = false,
  onChange,
}: {
  field: TicketTemplateField;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (field: TicketTemplateField) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: field.id, disabled: disabled || readOnly });
  const checkboxId = `ticket-field-${field.id}`;
  const size = fontSizeToOption(field.fontSizePt);
  const controlsDisabled = disabled || readOnly;

  return (
    <div
      ref={setNodeRef}
      className={`ticket-template-row ${field.visible ? '' : 'is-hidden'} ${controlsDisabled ? 'is-disabled' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="ticket-template-drag"
        aria-label="Arrastrar campo"
        disabled={controlsDisabled}
        {...(controlsDisabled ? {} : attributes)}
        {...(controlsDisabled ? {} : listeners)}
      >
        <GripVertical size={15} aria-hidden="true" />
      </button>
      <label className="ticket-template-visible" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={field.visible && !disabled}
          disabled={controlsDisabled}
          onChange={(event) =>
            onChange({ ...field, visible: event.target.checked })
          }
        />
        <span>{TICKET_TEMPLATE_FIELD_LABELS[field.id]}</span>
      </label>
      <div className="ticket-template-controls">
        <AppSelect
          value={size}
          disabled={controlsDisabled}
          onChange={(value) => {
            const nextSize = value as TicketTemplateFontSize;
            onChange({
              ...field,
              fontSizePt: TICKET_TEMPLATE_SIZE_OPTIONS[nextSize].pt,
            });
          }}
          options={FIELD_SIZE_OPTIONS}
        />
        <button
          type="button"
          className={`ticket-template-bold ${field.emphasis === 'bold' ? 'active' : ''}`}
          aria-pressed={field.emphasis === 'bold'}
          disabled={controlsDisabled}
          title="Negrita"
          onClick={() =>
            onChange({
              ...field,
              emphasis: field.emphasis === 'bold' ? 'normal' : 'bold',
            })
          }
        >
          <Bold size={15} aria-hidden="true" />
          <span>Negrita</span>
        </button>
      </div>
    </div>
  );
}

export function PrinterSettingsPanel({
  tenantId,
  tenantName,
  tenantAddress,
  tenantCuit = null,
  actorRole = null,
  accessToken = null,
}: Props) {
  const { showToast } = useToast();
  const templateTenantId = tenantId ?? 'default';
  const canEditTicketTemplate = actorRole === 'admin' || actorRole === 'owner';
  const [printers, setPrinters] = useState<DesktopPrinter[] | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [selected, setSelected] = useState<string>(
    () => readPrinterSettings().deviceName ?? SYSTEM_DEFAULT,
  );
  const [tailFeed, setTailFeed] = useState<number>(
    () => readPrinterSettings().tailFeedMm,
  );
  const [paperSize, setPaper] = useState<PaperSize>(
    () => readPrinterSettings().paperSize,
  );
  const [template, setTemplate] = useState<TicketTemplateSettings>(() =>
    readTicketTemplateSettings(templateTenantId),
  );
  const [previewHeight, setPreviewHeight] = useState(180);
  const [testing, setTesting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const remoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    const localTemplate = readTicketTemplateSettings(templateTenantId);
    setTemplate(localTemplate);

    if (!tenantId || !accessToken) return;

    let mounted = true;
    void fetchEntityProfileSettings(tenantId, accessToken)
      .then((profile) => {
        if (!mounted) return;
        if (profile.ticketTemplate) {
          const remoteTemplate = normalizeTicketTemplateSettings(
            tenantId,
            profile.ticketTemplate,
          );
          setTemplate(remoteTemplate);
          writeTicketTemplateSettings(remoteTemplate);
          return;
        }
        if (canEditTicketTemplate) {
          void updateEntityTicketTemplate(
            tenantId,
            accessToken,
            ticketTemplatePayload(localTemplate),
          ).catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [accessToken, canEditTicketTemplate, templateTenantId, tenantId]);

  useEffect(() => {
    return () => {
      if (remoteSaveTimerRef.current) {
        clearTimeout(remoteSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.listPrinters !== 'function') {
      setBridgeMissing(true);
      return;
    }
    let mounted = true;
    void bridge
      .listPrinters()
      .then((list) => {
        if (mounted) setPrinters(list);
      })
      .catch(() => {
        if (mounted) setPrinters([]);
      });
    return () => {
      mounted = false;
    };
  }, [reloadToken]);

  const handleChange = useCallback(
    (value: string) => {
      setSelected(value);
      setSelectedPrinter(value || null);
      showToast({ message: 'Impresora guardada.', kind: 'success' });
    },
    [showToast],
  );

  function fieldHasValue(
    fieldId: TicketTemplateField['id'],
    nextTemplate: TicketTemplateSettings = template,
  ): boolean {
    if (fieldId === 'parkingCuit') {
      return Boolean(tenantCuit?.trim() || nextTemplate.cuitOverride.trim());
    }
    if (fieldId === 'grossIncome') {
      return Boolean(nextTemplate.grossIncomeText.trim());
    }
    return true;
  }

  const saveTemplate = useCallback(
    (next: TicketTemplateSettings) => {
      if (!canEditTicketTemplate) return;

      const normalized: TicketTemplateSettings = {
        ...next,
        fields: next.fields.map((field) => {
          const hasValue =
            field.id === 'parkingCuit'
              ? Boolean(tenantCuit?.trim() || next.cuitOverride.trim())
              : field.id === 'grossIncome'
                ? Boolean(next.grossIncomeText.trim())
                : true;
          return hasValue ? field : { ...field, visible: false };
        }),
      };
      setTemplate(normalized);
      writeTicketTemplateSettings(normalized);
      if (tenantId && accessToken) {
        if (remoteSaveTimerRef.current) {
          clearTimeout(remoteSaveTimerRef.current);
        }
        remoteSaveTimerRef.current = setTimeout(() => {
          remoteSaveTimerRef.current = null;
          void updateEntityTicketTemplate(
            tenantId,
            accessToken,
            ticketTemplatePayload(normalized),
          ).catch(() => undefined);
        }, 500);
      }
    },
    [accessToken, canEditTicketTemplate, tenantCuit, tenantId],
  );

  function handleFieldChange(nextField: TicketTemplateField): void {
    if (!canEditTicketTemplate) return;

    saveTemplate({
      ...template,
      fields: template.fields.map((field) =>
        field.id === nextField.id ? nextField : field,
      ),
    });
  }

  function handleDragEnd(event: DragEndEvent): void {
    if (!canEditTicketTemplate) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = template.fields.findIndex(
      (field) => field.id === active.id,
    );
    const newIndex = template.fields.findIndex((field) => field.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    saveTemplate({
      ...template,
      fields: arrayMove(template.fields, oldIndex, newIndex),
    });
  }

  function handleResetTemplate(): void {
    if (!canEditTicketTemplate) return;

    const next = resetTicketTemplateSettings(templateTenantId);
    setTemplate(next);
    if (remoteSaveTimerRef.current) {
      clearTimeout(remoteSaveTimerRef.current);
      remoteSaveTimerRef.current = null;
    }
    if (tenantId && accessToken) {
      void updateEntityTicketTemplate(
        tenantId,
        accessToken,
        ticketTemplatePayload(next),
      ).catch(() => undefined);
    }
    showToast({ message: 'Plantilla compacta restaurada.', kind: 'success' });
  }

  const previewHtml = useMemo(
    () =>
      buildEntryTicketHtml(
        testTicketData({ tenantName, tenantAddress, tenantCuit }),
        {
          bodyWidthMm: PAPER_SIZES[paperSize].bodyWidthMm,
          template,
        },
      ),
    [paperSize, template, tenantAddress, tenantCuit, tenantName],
  );

  function updatePreviewHeight(): void {
    const frame = previewFrameRef.current;
    const doc = frame?.contentDocument;
    const body = doc?.body;
    if (!body) return;

    const contentHeight = Math.ceil(body.scrollHeight);
    setPreviewHeight(Math.max(80, contentHeight));
  }

  useEffect(() => {
    setPreviewHeight(180);
  }, [previewHtml]);

  async function handleTestPrint(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.printTicket !== 'function') return;

    setTesting(true);
    try {
      // Uses the real builder and the real channel so one click validates the
      // paper width, the device name and silent mode end to end.
      const outcome: PrintOutcome = await bridge.printTicket({
        html: buildEntryTicketHtml(
          testTicketData({ tenantName, tenantAddress, tenantCuit }),
          { bodyWidthMm: PAPER_SIZES[paperSize].bodyWidthMm, template },
        ),
        deviceName: selected || null,
        tailFeedMm: tailFeed,
        pageWidthMm: PAPER_SIZES[paperSize].pageWidthMm,
      });
      showToast(
        outcome.ok
          ? { message: 'Prueba enviada a la impresora.', kind: 'success' }
          : { message: describePrintFailure(outcome), kind: 'error' },
      );
    } finally {
      setTesting(false);
    }
  }

  if (bridgeMissing) {
    return (
      <section className="dashboard-card warning">
        <h2>Impresión no disponible</h2>
        <p className="muted">
          La impresión solo funciona en la app de escritorio.
        </p>
      </section>
    );
  }

  const isLinux = window.parkitDesktop?.platform === 'linux';
  // A printer saved on another day may be unplugged today. Keep it visible
  // instead of silently resetting the choice: USB printers come back.
  const savedMissing =
    selected !== SYSTEM_DEFAULT &&
    printers !== null &&
    !printers.some((printer) => printer.name === selected);

  const options = [
    { value: SYSTEM_DEFAULT, label: 'Impresora por defecto del sistema' },
    ...(printers ?? []).map((printer) => ({
      value: printer.name,
      label: printer.isDefault
        ? `${printer.displayName} (predeterminada)`
        : printer.displayName,
    })),
    ...(savedMissing
      ? [{ value: selected, label: `${selected} (no disponible)` }]
      : []),
  ];

  return (
    <div className="printer-panel">
      <div className="printer-panel-main">
        <section className="dashboard-card">
          <h2>Impresora de tickets</h2>
          <p className="muted">
            El ticket de ingreso se imprime en esta impresora, sin pedir
            confirmación. Es una configuración de esta computadora.
          </p>

          {printers === null ? (
            <p className="muted">Buscando impresoras...</p>
          ) : (
            <div className="printer-panel-field">
              <label className="form-label" htmlFor="printer-select">
                Impresora
              </label>
              <AppSelect
                id="printer-select"
                value={selected}
                onChange={handleChange}
                options={options}
              />
            </div>
          )}

          {printers !== null && printers.length === 0 ? (
            <p className="csd-note csd-note--warning">
              No se encontraron impresoras instaladas en esta computadora.
              {isLinux
                ? ' En Linux la lista sale de CUPS: verificá que esté instalado y corriendo.'
                : ''}
            </p>
          ) : null}

          {savedMissing ? (
            <p className="csd-note csd-note--warning">
              La impresora guardada no está disponible en este momento. Elegí
              otra o volvé a conectarla.
            </p>
          ) : null}

          <div className="printer-panel-field">
            <label className="form-label" htmlFor="printer-paper-size">
              Tamaño de papel
            </label>
            <AppSelect
              id="printer-paper-size"
              value={paperSize}
              onChange={(value) => {
                const next = value as PaperSize;
                setPaper(next);
                setPaperSize(next);
                showToast({
                  message: 'Tamaño de papel guardado.',
                  kind: 'success',
                });
              }}
              options={(Object.keys(PAPER_SIZES) as PaperSize[]).map((key) => ({
                value: key,
                label: PAPER_SIZES[key].label,
              }))}
            />
            <p className="muted printer-panel-hint">
              Si la impresora avanza el papel y corta sin imprimir nada, probá
              con la opción del driver: algunas térmicas rechazan los tamaños de
              página personalizados.
            </p>
          </div>

          <div className="printer-panel-field">
            <label className="form-label" htmlFor="printer-tail-feed">
              Avance de papel al final
            </label>
            <AppSelect
              id="printer-tail-feed"
              value={String(tailFeed)}
              onChange={(value) => {
                const mm = Number(value);
                setTailFeed(mm);
                setTailFeedMm(mm);
                showToast({ message: 'Avance guardado.', kind: 'success' });
              }}
              options={TAIL_FEED_OPTIONS_MM.map((mm) => ({
                value: String(mm),
                label: mm === 0 ? 'Sin avance' : `${mm} mm`,
              }))}
            />
            <p className="muted printer-panel-hint">
              Papel que se alimenta después de la última línea. Si tu impresora
              tiene guillotina y corta sobre el texto, subilo. Imprimiendo a PDF
              o sin guillotina, ponelo en cero y ahorrás ese papel en cada
              ticket.
            </p>
          </div>

          <div className="printer-panel-actions">
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <RefreshCcw size={15} aria-hidden="true" />
              Actualizar lista
            </button>
            <button
              type="button"
              className="primary-button compact"
              onClick={() => void handleTestPrint()}
              disabled={testing || printers === null}
            >
              <Printer size={15} aria-hidden="true" />
              {testing ? 'Imprimiendo...' : 'Imprimir prueba'}
            </button>
          </div>
        </section>

        <section className="dashboard-card printer-preview-card">
          <h2>Vista previa</h2>
          <div className="ticket-preview-shell">
            <iframe
              ref={previewFrameRef}
              title="Vista previa del ticket"
              className="ticket-preview-frame"
              srcDoc={previewHtml}
              style={{ height: previewHeight }}
              onLoad={updatePreviewHeight}
            />
          </div>
        </section>
      </div>

      <section
        className={`dashboard-card printer-template-card ${canEditTicketTemplate ? '' : 'is-readonly'}`}
      >
        <div className="printer-panel-title-row">
          <div>
            <h2>Plantilla del ticket</h2>
            <p className="muted">
              {canEditTicketTemplate
                ? 'Elegí qué datos imprimir, en qué orden y con qué tamaño.'
                : 'Solo dueños y administradores pueden modificar qué datos imprime el ticket.'}
            </p>
          </div>
          <button
            type="button"
            className="ghost-button compact"
            onClick={handleResetTemplate}
            disabled={!canEditTicketTemplate}
            title={
              canEditTicketTemplate
                ? 'Restaurar plantilla'
                : 'Solo dueños y administradores pueden restaurar la plantilla'
            }
          >
            <RotateCcw size={15} aria-hidden="true" />
            Restaurar
          </button>
        </div>

        <div className="printer-template-text-grid">
          <div className="printer-panel-field">
            <label className="form-label" htmlFor="ticket-cuit">
              CUIT impreso
            </label>
            <input
              id="ticket-cuit"
              className="form-input"
              value={template.cuitOverride}
              placeholder={tenantCuit ?? 'Ej. 20-16865508-0'}
              disabled={!canEditTicketTemplate}
              onChange={(event) =>
                saveTemplate({ ...template, cuitOverride: event.target.value })
              }
            />
          </div>
          <div className="printer-panel-field">
            <label className="form-label" htmlFor="ticket-iibb">
              IIBB
            </label>
            <input
              id="ticket-iibb"
              className="form-input"
              value={template.grossIncomeText}
              placeholder="Ej. IIBB: 1027025-06"
              disabled={!canEditTicketTemplate}
              onChange={(event) =>
                saveTemplate({
                  ...template,
                  grossIncomeText: event.target.value,
                })
              }
            />
          </div>
          <div className="printer-panel-field">
            <label className="form-label" htmlFor="ticket-control">
              Control fiscal
            </label>
            <input
              id="ticket-control"
              className="form-input"
              value={template.nonFiscalControlText}
              placeholder="Control no fiscal"
              disabled={!canEditTicketTemplate}
              onChange={(event) =>
                saveTemplate({
                  ...template,
                  nonFiscalControlText: event.target.value,
                })
              }
            />
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={template.fields.map((field) => field.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="ticket-template-list">
              {template.fields.map((field) => (
                <TemplateFieldRow
                  key={field.id}
                  field={field}
                  disabled={!fieldHasValue(field.id)}
                  readOnly={!canEditTicketTemplate}
                  onChange={handleFieldChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </div>
  );
}
