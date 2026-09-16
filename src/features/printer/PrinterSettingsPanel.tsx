import { Printer, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { buildEntryTicketHtml } from '../../lib/print/entryTicket';
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
import { useToast } from '../../lib/notifications/ToastProvider';
import { AppSelect } from '../../lib/ui/AppSelect';

interface Props {
  tenantName: string | null;
  tenantAddress: string | null;
}

const SYSTEM_DEFAULT = '';

export function PrinterSettingsPanel({ tenantName, tenantAddress }: Props) {
  const { showToast } = useToast();
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
  const [testing, setTesting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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

  async function handleTestPrint(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.printTicket !== 'function') return;

    setTesting(true);
    try {
      // Uses the real builder and the real channel so one click validates the
      // paper width, the device name and silent mode end to end.
      const outcome: PrintOutcome = await bridge.printTicket({
        html: buildEntryTicketHtml(
          {
            parkingName: tenantName,
            parkingAddress: tenantAddress,
            vehicle: 'VW Suran',
            color: 'Negra',
            enteredAt: new Date().toISOString(),
            rateNumber: 2,
            ticketNumber: 0,
          },
          { bodyWidthMm: PAPER_SIZES[paperSize].bodyWidthMm },
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
            La impresora guardada no está disponible en este momento. Elegí otra
            o volvé a conectarla.
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
            Si la impresora avanza el papel y corta sin imprimir nada, probá con
            la opción del driver: algunas térmicas rechazan los tamaños de
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
            tiene guillotina y corta sobre el texto, subilo. Imprimiendo a PDF o
            sin guillotina, ponelo en cero y ahorrás ese papel en cada ticket.
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
    </div>
  );
}
