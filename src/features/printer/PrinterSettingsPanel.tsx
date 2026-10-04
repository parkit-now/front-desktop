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
  PrinterCheck,
  RefreshCcw,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildEntryTicketHtml } from '../../lib/print/entryTicket';
import { buildPaymentReceiptHtml } from '../../lib/print/receipt';
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
  resolvePaperSize,
  setCustomPaperSize,
  setPaperSize,
  setSelectedPrinter,
  setTailFeedMm,
  TAIL_FEED_OPTIONS_MM,
  type PaperSize,
} from '../../lib/print/printerSettings';
import {
  isRequiredReceiptField,
  readReceiptTemplateSettings,
  RECEIPT_TEMPLATE_FIELD_LABELS,
  resetReceiptTemplateSettings,
  type ReceiptTemplateField,
  type ReceiptTemplateSettings,
  writeReceiptTemplateSettings,
} from '../../lib/print/receiptTemplate';
import {
  fontSizeToOption,
  linkVehicleFields,
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

type TemplateKind = 'entry' | 'receipt';
type PrintableTemplateField = TicketTemplateField | ReceiptTemplateField;

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

function testReceiptData({
  tenantId,
  tenantName,
  tenantAddress,
  tenantCuit,
}: {
  tenantId: string | null;
  tenantName: string | null;
  tenantAddress: string | null;
  tenantCuit?: string | null;
}) {
  return {
    tenantId,
    parkingName: tenantName,
    parkingAddress: tenantAddress,
    parkingCuit: tenantCuit ?? null,
    plate: 'IAG 571',
    ticketNumber: 10,
    amountDue: 170000,
    received: 180000,
    change: 10000,
    paymentMethodName: 'Efectivo',
    enteredAt: '2026-09-17T12:28:00Z',
    leftAt: '2026-09-18T14:46:00Z',
  };
}

function TemplateFieldRow({
  field,
  label,
  disabled = false,
  readOnly = false,
  visibilityLocked = false,
  onChange,
}: {
  field: PrintableTemplateField;
  label: string;
  disabled?: boolean;
  readOnly?: boolean;
  visibilityLocked?: boolean;
  onChange: (field: PrintableTemplateField) => void;
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
          disabled={controlsDisabled || visibilityLocked}
          onChange={(event) =>
            onChange({ ...field, visible: event.target.checked })
          }
        />
        <span>{label}</span>
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
  const [customMediaWidth, setCustomMediaWidth] = useState<number>(
    () => readPrinterSettings().customMediaWidthMm,
  );
  const [customBodyWidth, setCustomBodyWidth] = useState<number>(
    () => readPrinterSettings().customBodyWidthMm,
  );
  const [template, setTemplate] = useState<TicketTemplateSettings>(() =>
    readTicketTemplateSettings(templateTenantId),
  );
  const [receiptTemplate, setReceiptTemplate] =
    useState<ReceiptTemplateSettings>(() =>
      readReceiptTemplateSettings(templateTenantId),
    );
  const [activeTemplateKind, setActiveTemplateKind] =
    useState<TemplateKind>('entry');
  const [previewHeight, setPreviewHeight] = useState(180);
  const [testing, setTesting] = useState(false);
  const [testingDialog, setTestingDialog] = useState(false);
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
    setReceiptTemplate(readReceiptTemplateSettings(templateTenantId));

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

  function receiptFieldHasValue(
    fieldId: ReceiptTemplateField['id'],
    nextTemplate: ReceiptTemplateSettings = receiptTemplate,
  ): boolean {
    if (isRequiredReceiptField(fieldId)) return true;
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
        fields: linkVehicleFields(
          next.fields.map((field) => {
            const hasValue =
              field.id === 'parkingCuit'
                ? Boolean(tenantCuit?.trim() || next.cuitOverride.trim())
                : field.id === 'grossIncome'
                  ? Boolean(next.grossIncomeText.trim())
                  : true;
            return hasValue ? field : { ...field, visible: false };
          }),
        ),
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

  const saveReceiptTemplate = useCallback(
    (next: ReceiptTemplateSettings) => {
      if (!canEditTicketTemplate) return;

      const normalized: ReceiptTemplateSettings = {
        ...next,
        fields: next.fields.map((field) => {
          const hasValue =
            field.id === 'parkingCuit'
              ? Boolean(tenantCuit?.trim() || next.cuitOverride.trim())
              : field.id === 'grossIncome'
                ? Boolean(next.grossIncomeText.trim())
                : true;
          if (isRequiredReceiptField(field.id)) {
            return { ...field, visible: true };
          }
          return hasValue ? field : { ...field, visible: false };
        }),
      };
      setReceiptTemplate(normalized);
      writeReceiptTemplateSettings(normalized);
    },
    [canEditTicketTemplate, tenantCuit],
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

  function handleReceiptFieldChange(nextField: PrintableTemplateField): void {
    if (!canEditTicketTemplate) return;
    const receiptField = nextField as ReceiptTemplateField;

    saveReceiptTemplate({
      ...receiptTemplate,
      fields: receiptTemplate.fields.map((field) =>
        field.id === receiptField.id ? receiptField : field,
      ),
    });
  }

  function handleDragEnd(event: DragEndEvent): void {
    if (!canEditTicketTemplate) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (activeTemplateKind === 'receipt') {
      const oldIndex = receiptTemplate.fields.findIndex(
        (field) => field.id === active.id,
      );
      const newIndex = receiptTemplate.fields.findIndex(
        (field) => field.id === over.id,
      );
      if (oldIndex === -1 || newIndex === -1) return;

      saveReceiptTemplate({
        ...receiptTemplate,
        fields: arrayMove(receiptTemplate.fields, oldIndex, newIndex),
      });
      return;
    }

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

    if (activeTemplateKind === 'receipt') {
      const next = resetReceiptTemplateSettings(templateTenantId);
      setReceiptTemplate(next);
      showToast({
        message: 'Plantilla no fiscal restaurada.',
        kind: 'success',
      });
      return;
    }

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

  const resolvedPaper = useMemo(
    () =>
      resolvePaperSize({
        paperSize,
        customMediaWidthMm: customMediaWidth,
        customBodyWidthMm: customBodyWidth,
      }),
    [customBodyWidth, customMediaWidth, paperSize],
  );

  const previewHtml = useMemo(() => {
    if (activeTemplateKind === 'receipt') {
      return buildPaymentReceiptHtml(
        testReceiptData({
          tenantId: templateTenantId,
          tenantName,
          tenantAddress,
          tenantCuit,
        }),
        {
          bodyWidthMm: resolvedPaper.bodyWidthMm,
          template: receiptTemplate,
        },
      );
    }

    return buildEntryTicketHtml(
      testTicketData({ tenantName, tenantAddress, tenantCuit }),
      {
        bodyWidthMm: resolvedPaper.bodyWidthMm,
        template,
      },
    );
  }, [
    activeTemplateKind,
    receiptTemplate,
    resolvedPaper.bodyWidthMm,
    template,
    tenantAddress,
    tenantCuit,
    tenantName,
    templateTenantId,
  ]);

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

  async function handleTestPrint(debugDialog = false): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.printTicket !== 'function') return;

    if (debugDialog) setTestingDialog(true);
    else setTesting(true);
    try {
      // Uses the real builder and the real channel so one click validates the
      // paper width, the device name and silent mode end to end.
      const outcome: PrintOutcome = await bridge.printTicket({
        html:
          activeTemplateKind === 'receipt'
            ? buildPaymentReceiptHtml(
                testReceiptData({
                  tenantId: templateTenantId,
                  tenantName,
                  tenantAddress,
                  tenantCuit,
                }),
                {
                  bodyWidthMm: resolvedPaper.bodyWidthMm,
                  template: receiptTemplate,
                },
              )
            : buildEntryTicketHtml(
                testTicketData({ tenantName, tenantAddress, tenantCuit }),
                { bodyWidthMm: resolvedPaper.bodyWidthMm, template },
              ),
        deviceName: selected || null,
        tailFeedMm: tailFeed,
        mediaWidthMm: resolvedPaper.mediaWidthMm,
        bodyWidthMm: resolvedPaper.bodyWidthMm,
        debugDialog,
      });
      showToast(
        outcome.ok
          ? {
              message:
                activeTemplateKind === 'receipt'
                  ? 'Prueba no fiscal enviada a la impresora.'
                  : 'Prueba enviada a la impresora.',
              kind: 'success',
            }
          : { message: describePrintFailure(outcome), kind: 'error' },
      );
    } finally {
      if (debugDialog) setTestingDialog(false);
      else setTesting(false);
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
  // El modelo no tiene fila propia: lo maneja la de "Marca y modelo".
  const activeFields =
    activeTemplateKind === 'receipt'
      ? receiptTemplate.fields
      : template.fields.filter((field) => field.id !== 'vehicleModel');
  const templateTitle =
    activeTemplateKind === 'receipt'
      ? 'Plantilla no fiscal'
      : 'Plantilla del ticket';
  const templateDescription =
    activeTemplateKind === 'receipt'
      ? canEditTicketTemplate
        ? 'Elegí qué datos imprimir en el comprobante no fiscal.'
        : 'Solo dueños y administradores pueden modificar el comprobante no fiscal.'
      : canEditTicketTemplate
        ? 'Elegí qué datos imprimir, en qué orden y con qué tamaño.'
        : 'Solo dueños y administradores pueden modificar qué datos imprime el ticket.';
  const activeCuitOverride =
    activeTemplateKind === 'receipt'
      ? receiptTemplate.cuitOverride
      : template.cuitOverride;
  const activeGrossIncomeText =
    activeTemplateKind === 'receipt'
      ? receiptTemplate.grossIncomeText
      : template.grossIncomeText;
  const activeNonFiscalControlText =
    activeTemplateKind === 'receipt'
      ? receiptTemplate.nonFiscalControlText
      : template.nonFiscalControlText;

  function saveActiveTemplateText(
    patch: Partial<
      Pick<
        TicketTemplateSettings,
        'cuitOverride' | 'grossIncomeText' | 'nonFiscalControlText'
      >
    >,
  ): void {
    if (activeTemplateKind === 'receipt') {
      saveReceiptTemplate({ ...receiptTemplate, ...patch });
      return;
    }
    saveTemplate({ ...template, ...patch });
  }

  function activeFieldHasValue(field: PrintableTemplateField): boolean {
    return activeTemplateKind === 'receipt'
      ? receiptFieldHasValue(field.id as ReceiptTemplateField['id'])
      : fieldHasValue(field.id as TicketTemplateField['id']);
  }

  function activeFieldIsLocked(field: PrintableTemplateField): boolean {
    return (
      activeTemplateKind === 'receipt' &&
      isRequiredReceiptField(field.id as ReceiptTemplateField['id'])
    );
  }

  function activeFieldLabel(field: PrintableTemplateField): string {
    return activeTemplateKind === 'receipt'
      ? RECEIPT_TEMPLATE_FIELD_LABELS[field.id as ReceiptTemplateField['id']]
      : TICKET_TEMPLATE_FIELD_LABELS[field.id as TicketTemplateField['id']];
  }

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
              Papel de la impresora
            </label>
            <AppSelect
              id="printer-paper-size"
              value={paperSize}
              onChange={(value) => {
                const next = value as PaperSize;
                setPaper(next);
                const saved =
                  next === 'custom'
                    ? setCustomPaperSize({
                        mediaWidthMm: customMediaWidth,
                        bodyWidthMm: customBodyWidth,
                      })
                    : setPaperSize(next);
                setCustomMediaWidth(saved.customMediaWidthMm);
                setCustomBodyWidth(saved.customBodyWidthMm);
                showToast({
                  message: 'Papel de impresora guardado.',
                  kind: 'success',
                });
              }}
              options={(Object.keys(PAPER_SIZES) as PaperSize[]).map((key) => ({
                value: key,
                label: PAPER_SIZES[key].label,
              }))}
            />
            <p className="muted printer-panel-hint">
              En Windows, si el ticket sale en A4, configurá el rollo en
              Preferencias de impresión o probá “Imprimir con diálogo” para ver
              qué tamaño está tomando el driver.
            </p>
          </div>

          {paperSize === 'custom' ? (
            <div className="printer-custom-paper-grid">
              <div className="printer-panel-field">
                <label className="form-label" htmlFor="printer-media-width">
                  Ancho físico del papel
                </label>
                <input
                  id="printer-media-width"
                  className="form-input"
                  type="number"
                  inputMode="numeric"
                  min={20}
                  max={210}
                  value={customMediaWidth}
                  onChange={(event) => {
                    const mediaWidthMm = Number(event.target.value);
                    setCustomMediaWidth(mediaWidthMm);
                    const saved = setCustomPaperSize({
                      mediaWidthMm,
                      bodyWidthMm: customBodyWidth,
                    });
                    setCustomMediaWidth(saved.customMediaWidthMm);
                    setCustomBodyWidth(saved.customBodyWidthMm);
                  }}
                />
                <p className="muted printer-panel-hint">Milímetros.</p>
              </div>
              <div className="printer-panel-field">
                <label className="form-label" htmlFor="printer-body-width">
                  Ancho imprimible
                </label>
                <input
                  id="printer-body-width"
                  className="form-input"
                  type="number"
                  inputMode="numeric"
                  min={20}
                  max={customMediaWidth}
                  value={customBodyWidth}
                  onChange={(event) => {
                    const bodyWidthMm = Number(event.target.value);
                    setCustomBodyWidth(bodyWidthMm);
                    const saved = setCustomPaperSize({
                      mediaWidthMm: customMediaWidth,
                      bodyWidthMm,
                    });
                    setCustomMediaWidth(saved.customMediaWidthMm);
                    setCustomBodyWidth(saved.customBodyWidthMm);
                  }}
                />
                <p className="muted printer-panel-hint">
                  Dejalo menor que el papel si el driver tiene márgenes.
                </p>
              </div>
            </div>
          ) : null}

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
            {window.parkitDesktop?.platform === 'win32' ? (
              <button
                type="button"
                className="ghost-button compact"
                onClick={() => void handleTestPrint(true)}
                disabled={testingDialog || printers === null}
              >
                <PrinterCheck size={15} aria-hidden="true" />
                {testingDialog ? 'Abriendo...' : 'Imprimir con diálogo'}
              </button>
            ) : null}
          </div>
        </section>

        <section className="dashboard-card printer-preview-card">
          <div className="printer-panel-title-row">
            <h2>Vista previa</h2>
            <div className="printer-template-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTemplateKind === 'entry'}
                className={activeTemplateKind === 'entry' ? 'active' : ''}
                onClick={() => setActiveTemplateKind('entry')}
              >
                Ingreso
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTemplateKind === 'receipt'}
                className={activeTemplateKind === 'receipt' ? 'active' : ''}
                onClick={() => setActiveTemplateKind('receipt')}
              >
                No fiscal
              </button>
            </div>
          </div>
          <p className="muted printer-panel-hint">
            Papel:{' '}
            {resolvedPaper.mediaWidthMm
              ? `${resolvedPaper.mediaWidthMm} mm`
              : 'según driver'}
            {' · '}
            Imprimible:{' '}
            {resolvedPaper.bodyWidthMm
              ? `${resolvedPaper.bodyWidthMm} mm`
              : 'según driver'}
            {' · '}
            Alto aprox.: {Math.round(previewHeight * (25.4 / 96) * 10) / 10} mm
          </p>
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
            <h2>{templateTitle}</h2>
            <p className="muted">{templateDescription}</p>
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
        <div
          className="printer-template-tabs printer-template-tabs--wide"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTemplateKind === 'entry'}
            className={activeTemplateKind === 'entry' ? 'active' : ''}
            onClick={() => setActiveTemplateKind('entry')}
          >
            Ticket de ingreso
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTemplateKind === 'receipt'}
            className={activeTemplateKind === 'receipt' ? 'active' : ''}
            onClick={() => setActiveTemplateKind('receipt')}
          >
            Comprobante no fiscal
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
              value={activeCuitOverride}
              placeholder={tenantCuit ?? 'Ej. 20-16865508-0'}
              disabled={!canEditTicketTemplate}
              onChange={(event) =>
                saveActiveTemplateText({ cuitOverride: event.target.value })
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
              value={activeGrossIncomeText}
              placeholder="Ej. IIBB: 1027025-06"
              disabled={!canEditTicketTemplate}
              onChange={(event) =>
                saveActiveTemplateText({
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
              value={activeNonFiscalControlText}
              placeholder={
                activeTemplateKind === 'receipt'
                  ? 'No válido como factura'
                  : 'Control no fiscal'
              }
              disabled={!canEditTicketTemplate}
              onChange={(event) =>
                saveActiveTemplateText({
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
            items={activeFields.map((field) => field.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="ticket-template-list">
              {activeFields.map((field) => (
                <TemplateFieldRow
                  key={field.id}
                  field={field}
                  label={activeFieldLabel(field)}
                  disabled={!activeFieldHasValue(field)}
                  visibilityLocked={activeFieldIsLocked(field)}
                  readOnly={!canEditTicketTemplate}
                  onChange={
                    activeTemplateKind === 'receipt'
                      ? handleReceiptFieldChange
                      : (nextField) =>
                          handleFieldChange(nextField as TicketTemplateField)
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </div>
  );
}
