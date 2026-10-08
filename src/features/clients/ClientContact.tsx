import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Mail, MessageCircle } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { useToast } from '../../lib/notifications/ToastProvider';
import { clientForInvoice, whatsappUrl } from './contactUtils';
import './clients.css';

export function ClientContact({
  tenantId,
  plate,
  receiverCuit,
}: {
  tenantId: string;
  plate: string;
  receiverCuit?: string | null;
}) {
  const { showToast } = useToast();
  const rows = useLiveQuery(
    () => localDb.clients.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const client = clientForInvoice(rows ?? [], plate, receiverCuit);
  if (!client || (!client.name && !client.email && !client.phone)) return null;
  const whatsapp = whatsappUrl(client.phone);
  const open = (url: string) => {
    const bridge = window.parkitDesktop;
    if (bridge?.openExternal) void bridge.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  const copy = async (value: string, label: string) => {
    try {
      if (window.parkitDesktop?.copyText) {
        const result = await window.parkitDesktop.copyText(value);
        if (!result.ok) throw new Error('clipboard-failed');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error('clipboard-unavailable');
      }
      showToast({ message: `${label} copiado.`, kind: 'success' });
    } catch {
      showToast({
        message: `No se pudo copiar ${label.toLowerCase()}.`,
        kind: 'error',
      });
    }
  };
  return (
    <div className="client-contact" aria-label="Contacto del cliente">
      <strong>{client.name || 'Contacto del cliente'}</strong>
      {client.email && (
        <div className="client-contact-row">
          <span>{client.email}</span>
          <button
            type="button"
            title="Copiar email"
            aria-label="Copiar email"
            onClick={() => void copy(client.email!, 'Email')}
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            title="Abrir correo"
            aria-label="Abrir correo"
            onClick={() => open(`mailto:${encodeURIComponent(client.email!)}`)}
          >
            <Mail size={15} />
          </button>
        </div>
      )}
      {client.phone && (
        <div className="client-contact-row">
          <span>{client.phone}</span>
          <button
            type="button"
            title="Copiar teléfono"
            aria-label="Copiar teléfono"
            onClick={() => void copy(client.phone!, 'Teléfono')}
          >
            <Copy size={15} />
          </button>
          {whatsapp && (
            <button
              type="button"
              title="Abrir WhatsApp"
              aria-label="Abrir WhatsApp"
              onClick={() => open(whatsapp)}
            >
              <MessageCircle size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
