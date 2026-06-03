import { useEffect, useMemo, useState } from 'react';
import {
  createRate,
  deactivateRate,
  listRates,
  type CreateRateDto,
  type RateDto,
  type UpdateRateDto,
  updateRate,
} from '../../lib/api/rates';
import { translateApiError } from '../../lib/api/translate';
import { useToast } from '../../lib/notifications/ToastProvider';

type Props = {
  accessToken: string;
  tenantId: string;
  canManage: boolean;
  entityName?: string;
};

type EditorMode = 'create' | 'edit';

type FormState = {
  name: string;
  hourPriceArs: string;
  stayPriceArs: string;
  fractionPriceArs: string;
  isActive: boolean;
};

type FormErrors = {
  name?: string;
  hourPriceArs?: string;
  stayPriceArs?: string;
  fractionPriceArs?: string;
};

const ARS_FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatArs(value: number): string {
  return ARS_FORMATTER.format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toMoneyString(value: number): string {
  return value.toFixed(2);
}

function validateMoney(raw: string): { value?: number; error?: string } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { error: 'Este campo es obligatorio.' };
  }

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(trimmed)) {
    return { error: 'Ingresá un número válido con hasta 2 decimales.' };
  }

  const parsed = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return { error: 'Ingresá un número válido.' };
  }

  if (parsed < 0) {
    return { error: 'No puede ser negativo.' };
  }

  return { value: parsed };
}

function emptyForm(): FormState {
  return {
    name: '',
    hourPriceArs: '',
    stayPriceArs: '',
    fractionPriceArs: '',
    isActive: true,
  };
}

function fromRate(rate: RateDto): FormState {
  return {
    name: rate.name,
    hourPriceArs: toMoneyString(rate.hourPriceArs),
    stayPriceArs: toMoneyString(rate.stayPriceArs),
    fractionPriceArs: toMoneyString(rate.fractionPriceArs),
    isActive: rate.isActive,
  };
}

function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function RatesPanel({
  accessToken,
  tenantId,
  canManage,
  entityName,
}: Props) {
  const { showToast } = useToast();
  const [rates, setRates] = useState<RateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editingRate, setEditingRate] = useState<RateDto | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [errors, setErrors] = useState<FormErrors>({});

  async function loadRates(): Promise<void> {
    setLoading(true);
    try {
      const response = await listRates({
        tenantId,
        bearer: accessToken,
        query: {
          includeDeleted: false,
          includeInactive,
        },
      });
      setRates(response);
    } catch (error) {
      showToast({
        message: translateApiError(error),
        kind: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRates();
  }, [accessToken, tenantId, includeInactive]);

  const activeCount = useMemo(
    () =>
      rates.filter((rate) => rate.isActive && rate.deletedAt === null).length,
    [rates],
  );

  function beginCreate(): void {
    if (!canManage) return;
    setEditorMode('create');
    setEditingRate(null);
    setForm(emptyForm());
    setErrors({});
  }

  function beginEdit(rate: RateDto): void {
    if (!canManage) return;
    setEditorMode('edit');
    setEditingRate(rate);
    setForm(fromRate(rate));
    setErrors({});
  }

  function validateForm(): {
    payload?: {
      name: string;
      hourPriceArs: number;
      stayPriceArs: number;
      fractionPriceArs: number;
      isActive: boolean;
    };
  } {
    const nextErrors: FormErrors = {};

    const name = form.name.trim();
    if (name.length === 0) {
      nextErrors.name = 'El nombre es obligatorio.';
    } else if (name.length > 120) {
      nextErrors.name = 'Máximo 120 caracteres.';
    }

    const hour = validateMoney(form.hourPriceArs);
    if (hour.error) nextErrors.hourPriceArs = hour.error;

    const stay = validateMoney(form.stayPriceArs);
    if (stay.error) nextErrors.stayPriceArs = stay.error;

    const fraction = validateMoney(form.fractionPriceArs);
    if (fraction.error) nextErrors.fractionPriceArs = fraction.error;

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return {};
    }

    return {
      payload: {
        name,
        hourPriceArs: hour.value ?? 0,
        stayPriceArs: stay.value ?? 0,
        fractionPriceArs: fraction.value ?? 0,
        isActive: form.isActive,
      },
    };
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!canManage) return;

    const { payload } = validateForm();
    if (!payload) return;

    setSaving(true);

    try {
      if (editorMode === 'create') {
        const body: CreateRateDto = {
          id: generateUuidV7(),
          name: payload.name,
          hourPriceArs: payload.hourPriceArs,
          stayPriceArs: payload.stayPriceArs,
          fractionPriceArs: payload.fractionPriceArs,
        };

        await createRate({
          tenantId,
          bearer: accessToken,
          body,
        });

        showToast({ message: 'Tasa creada.', kind: 'success' });
      } else if (editingRate) {
        const body: UpdateRateDto = {};

        if (payload.name !== editingRate.name) body.name = payload.name;
        if (payload.hourPriceArs !== editingRate.hourPriceArs)
          body.hourPriceArs = payload.hourPriceArs;
        if (payload.stayPriceArs !== editingRate.stayPriceArs)
          body.stayPriceArs = payload.stayPriceArs;
        if (payload.fractionPriceArs !== editingRate.fractionPriceArs)
          body.fractionPriceArs = payload.fractionPriceArs;
        if (payload.isActive !== editingRate.isActive)
          body.isActive = payload.isActive;

        if (Object.keys(body).length === 0) {
          showToast({ message: 'No hay cambios para guardar.', kind: 'info' });
          setSaving(false);
          return;
        }

        await updateRate({
          tenantId,
          rateId: editingRate.id,
          expectedVersion: editingRate.version,
          bearer: accessToken,
          body,
        });

        showToast({ message: 'Tasa actualizada.', kind: 'success' });
      }

      await loadRates();
      beginCreate();
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(rate: RateDto): Promise<void> {
    if (!canManage) return;

    const accepted = window.confirm(
      `¿Querés desactivar la tasa "${rate.name}"? Podrás volver a activarla editándola.`,
    );
    if (!accepted) return;

    setSaving(true);
    try {
      await deactivateRate({
        tenantId,
        rateId: rate.id,
        expectedVersion: rate.version,
        bearer: accessToken,
      });

      showToast({ message: 'Tasa desactivada.', kind: 'success' });
      await loadRates();
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rates-panel">
      <header className="rates-header">
        <div>
          <h2>Tasas</h2>
          <p className="muted">
            {entityName ? `${entityName}. ` : ''}Activas: {activeCount} / Total:{' '}
            {rates.length}
          </p>
        </div>

        <div className="rates-actions">
          {!canManage ? (
            <span className="status-badge status-muted">Solo lectura</span>
          ) : null}
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              void loadRates();
            }}
            disabled={loading || saving}
          >
            Recargar
          </button>
          {canManage ? (
            <button
              type="button"
              className="primary-button compact"
              onClick={beginCreate}
              disabled={saving}
            >
              Nueva tasa
            </button>
          ) : null}
        </div>
      </header>

      <div className="rates-toolbar">
        <label className="toggle-chip">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => {
              setIncludeInactive(event.target.checked);
            }}
            disabled={loading || saving}
          />
          <span>Mostrar inactivas</span>
        </label>
      </div>

      <div className={`rates-layout ${canManage ? '' : 'readonly'}`}>
        <div className="rates-table-card">
          {loading ? (
            <p className="muted">Cargando tasas...</p>
          ) : rates.length === 0 ? (
            <div className="empty-state">
              <h3>Sin tasas todavía</h3>
              <p className="muted">
                {canManage
                  ? 'Creá la primera tasa para empezar a operar con precios desde la app.'
                  : 'Todavía no hay tasas configuradas para este estacionamiento.'}
              </p>
            </div>
          ) : (
            <table className="rates-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Hora</th>
                  <th>Estadía</th>
                  <th>Fracción</th>
                  <th>Estado</th>
                  <th>Actualizada</th>
                  {canManage ? <th className="right">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => {
                  const inactive = !rate.isActive || rate.deletedAt !== null;

                  return (
                    <tr key={rate.id}>
                      <td>{rate.name}</td>
                      <td>{formatArs(rate.hourPriceArs)}</td>
                      <td>{formatArs(rate.stayPriceArs)}</td>
                      <td>{formatArs(rate.fractionPriceArs)}</td>
                      <td>
                        <span
                          className={`status-badge ${inactive ? 'status-muted' : 'status-ok'}`}
                        >
                          {inactive ? 'Inactiva' : 'Activa'}
                        </span>
                      </td>
                      <td>{formatDate(rate.updatedAt)}</td>
                      {canManage ? (
                        <td className="right">
                          <button
                            type="button"
                            className="table-action"
                            onClick={() => {
                              beginEdit(rate);
                            }}
                            disabled={saving}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="table-action danger"
                            onClick={() => {
                              void handleDeactivate(rate);
                            }}
                            disabled={saving || inactive}
                          >
                            Desactivar
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {canManage ? (
          <aside className="rate-editor-card">
            <h3>{editorMode === 'create' ? 'Nueva tasa' : 'Editar tasa'}</h3>
            <p className="muted">
              {editorMode === 'create'
                ? 'Los cambios impactan en nuevas operaciones del tenant activo.'
                : 'Esta edición usa control de versión para evitar pisar cambios concurrentes.'}
            </p>

            <form
              className="auth-form"
              onSubmit={(event) => {
                void handleSubmit(event);
              }}
            >
              <div className="form-field">
                <input
                  type="text"
                  placeholder="Nombre (ej. DIA AUTO)"
                  value={form.name}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, name: event.target.value }));
                  }}
                  className={errors.name ? 'input-error' : undefined}
                />
                {errors.name ? (
                  <p className="field-error">{errors.name}</p>
                ) : null}
              </div>

              <div className="form-field">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Precio hora"
                  value={form.hourPriceArs}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      hourPriceArs: event.target.value,
                    }));
                  }}
                  className={errors.hourPriceArs ? 'input-error' : undefined}
                />
                {errors.hourPriceArs ? (
                  <p className="field-error">{errors.hourPriceArs}</p>
                ) : null}
              </div>

              <div className="form-field">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Precio estadía"
                  value={form.stayPriceArs}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      stayPriceArs: event.target.value,
                    }));
                  }}
                  className={errors.stayPriceArs ? 'input-error' : undefined}
                />
                {errors.stayPriceArs ? (
                  <p className="field-error">{errors.stayPriceArs}</p>
                ) : null}
              </div>

              <div className="form-field">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Precio fracción"
                  value={form.fractionPriceArs}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      fractionPriceArs: event.target.value,
                    }));
                  }}
                  className={
                    errors.fractionPriceArs ? 'input-error' : undefined
                  }
                />
                {errors.fractionPriceArs ? (
                  <p className="field-error">{errors.fractionPriceArs}</p>
                ) : null}
              </div>

              <label className="toggle-chip">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      isActive: event.target.checked,
                    }));
                  }}
                />
                <span>Tasa activa</span>
              </label>

              <div className="editor-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={beginCreate}
                  disabled={saving}
                >
                  Limpiar
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? 'Guardando...'
                    : editorMode === 'create'
                      ? 'Crear tasa'
                      : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
