import { AlertTriangle, X } from 'lucide-react';
import { formatArs } from '../../lib/format/argentina';

export interface PriceDiffRow {
  label: string;
  before: number;
  after: number;
}

interface Props {
  rateName: string;
  openEntries: number;
  rows: PriceDiffRow[];
  isOffline: boolean;
  isPending: boolean;
  onCancel: () => void;
  onKeepSnapshot: () => void;
  onApply: () => void;
}

/**
 * La pregunta que aparece al cambiar precios con autos adentro.
 *
 * POR QUÉ NO ES EL `ConfirmDialog` COMPARTIDO
 *
 * Acá hay TRES salidas —aplicar, no aplicar, y cancelar la edición entera— y
 * el `ConfirmDialog` tiene dos botones, con la salida "cancelar" cableada al
 * botón izquierdo, al backdrop y a Escape. Si "dejarlos con el precio de
 * entrada" se mapeara a cancelar, **Escape guardaría en silencio**. Un Escape
 * nunca puede guardar plata.
 *
 * Reusa las clases CSS del diálogo compartido para verse igual, sin tocarlo:
 * lo usan media docena de pantallas y su `message` es `string`, que no aguanta
 * este cuerpo.
 */
export function RatePropagationDialog({
  rateName,
  openEntries,
  rows,
  isOffline,
  isPending,
  onCancel,
  onKeepSnapshot,
  onApply,
}: Props) {
  const plural = openEntries !== 1;

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // Cerrar por afuera CANCELA: no guarda ni aplica nada.
        if (event.target === event.currentTarget && !isPending) onCancel();
      }}
    >
      <section
        className="confirm-dialog confirm-dialog-warning"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rate-propagation-title"
        aria-describedby="rate-propagation-message"
      >
        <div className="confirm-dialog-top">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <AlertTriangle size={22} />
          </span>
          <button
            type="button"
            className="confirm-dialog-close"
            onClick={onCancel}
            disabled={isPending}
            aria-label="Cancelar"
          >
            <X size={17} />
          </button>
        </div>

        <div>
          <p className="confirm-dialog-kicker">Autos adentro</p>
          <h3 id="rate-propagation-title">
            Cambiaste los precios de «{rateName}»
          </h3>

          <div id="rate-propagation-message">
            <p>
              Hay{' '}
              <strong>
                {openEntries} {plural ? 'autos adentro' : 'auto adentro'}
              </strong>{' '}
              con esta tasa.
            </p>
            <p>
              Si {plural ? 'los pasás' : 'lo pasás'} al precio nuevo, cuando{' '}
              {plural ? 'salgan' : 'salga'} se {plural ? 'les' : 'le'} cobra{' '}
              <strong>toda la estadía</strong> con los precios nuevos,{' '}
              <strong>
                desde la hora en que {plural ? 'entraron' : 'entró'}
              </strong>
              . No se cobra un rato al precio viejo y el resto al nuevo.
            </p>
            <p>
              Si {plural ? 'los dejás' : 'lo dejás'} como{' '}
              {plural ? 'están' : 'está'}, {plural ? 'siguen' : 'sigue'} con el
              precio que {plural ? 'tenían' : 'tenía'} al entrar, y el precio
              nuevo rige sólo para los que entren de ahora en más.
            </p>

            {rows.length > 0 ? (
              <ul className="rate-propagation-diff">
                {rows.map((row) => (
                  <li key={row.label}>
                    <span>{row.label}</span>
                    <span>
                      {formatArs(row.before)} →{' '}
                      <strong>{formatArs(row.after)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {isOffline ? (
              <p className="rate-propagation-offline">
                Estás sin conexión: el cambio se aplica ahora en esta
                computadora y se manda al servidor cuando vuelva internet.
              </p>
            ) : null}

            <p className="rate-propagation-note">
              Los autos que ya salieron no se tocan.
            </p>
          </div>
        </div>

        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={onKeepSnapshot}
            disabled={isPending}
          >
            {plural
              ? 'Dejarlos con el precio de entrada'
              : 'Dejarlo con el precio de entrada'}
          </button>
          <button
            type="button"
            className="confirm-dialog-primary warning"
            onClick={onApply}
            disabled={isPending}
          >
            {/* El número va en el botón primario: es lo que se lee cuando
                alguien confirma sin leer el cuerpo. */}
            {isPending
              ? 'Guardando...'
              : plural
                ? `Pasar los ${openEntries} al precio nuevo`
                : 'Pasar ese auto al precio nuevo'}
          </button>
        </div>
      </section>
    </div>
  );
}
