import type { Session } from '@supabase/supabase-js';
import {
  AlertTriangle,
  Car,
  Cctv,
  CreditCard,
  DollarSign,
  Home,
  Layers,
  Printer,
  Truck,
  Archive,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CameraPanel } from '../camera/CameraPanel';
import { CameraSettingsPanel } from '../camera/CameraSettingsPanel';
import { AutoEntriesColumns } from '../camera/AutoEntriesColumns';
import { useCameraStatus, type CameraStatus } from '../camera/useCameraStatus';
import { EntryForm } from '../entries/EntryForm';
import type { ManualEntryDraft } from '../entries/EntryFormCore';
import { ExitControls } from '../entries/ExitControls';
import { EntryHistoryPanel } from '../entries/EntryHistoryPanel';
import { PaymentMethodsPanel } from '../payment-methods/PaymentMethodsPanel';
import { RatesPanel } from '../rates/RatesPanel';
import { VehiclesPanel } from '../vehicles/VehiclesPanel';
import { VehicleTypesPanel } from '../vehicle-types/VehicleTypesPanel';
import { OfflineBanner } from '../sync/OfflineBanner';
import { SyncButton } from '../sync/SyncButton';
import { LprStatusIndicator } from '../lpr/LprStatusIndicator';
import { NoCashSessionScreen } from '../cash-session/NoCashSessionScreen';
import { CashSessionPanel } from '../cash-session/CashSessionPanel';
import { CashSessionHistoryPanel } from '../cash-session/CashSessionHistoryPanel';
import { PrinterSettingsPanel } from '../printer/PrinterSettingsPanel';
import { localDb } from '../../lib/db/localDb';
import {
  fetchMe,
  type AppRole,
  type EntityRole,
  type MeMembershipDto,
  type MeResponseDto,
} from '../../lib/api/auth';
import { listAdminParkings, type ParkingDto } from '../../lib/api/tenants';
import { translateApiError, translateRole } from '../../lib/api/translate';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { PARKIT_LOGO_URL } from '../../lib/brand';
import { SyncProvider } from '../../lib/sync/SyncContext';
import { signOut } from '../../lib/supabase/session';
import { getErrorMessage } from './errors';

type Props = {
  session: Session;
  /** Restored from local cache, not yet re-validated against the server. */
  sessionStale?: boolean;
};

/** Cómo se abrió Historial cuando se entra desde la sección Caja. */
type HistorialFocus =
  | { kind: 'cashSession'; sessionId: string }
  | { kind: 'activeCashSession' };

type WorkspaceSection =
  | 'dashboard'
  | 'rates'
  | 'operativo'
  | 'camara'
  | 'historial'
  | 'payment-methods'
  | 'vehicles'
  | 'vehicle-types'
  | 'caja'
  | 'impresora'
  | 'camara-config';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function tenantStorageKey(userId: string): string {
  return `parkit.desktop.tenant:${userId}`;
}

function profileStorageKey(userId: string): string {
  return `parkit.desktop.profile:${userId}`;
}

function manualEntryDraftKey(userId: string, tenantId: string): string {
  return `${userId}:${tenantId}`;
}

function formatCameraDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}min`;
}

function OperationalCameraStatusBadge({
  status,
}: {
  status: CameraStatus | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status?.camera !== 'down') return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [status?.camera]);

  if (!status || status.camera === 'ok') return null;

  const elapsed =
    status.camera === 'down' && status.downSince
      ? formatCameraDuration(now - status.downSince.getTime())
      : null;
  const detail =
    status.camera === 'initializing'
      ? 'Abriendo fuente de video'
      : [
          elapsed ? `hace ${elapsed}` : null,
          status.reconnectAttempts > 0
            ? `reintento ${status.reconnectAttempts}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div
      className={`operational-camera-badge ${status.camera}`}
      role="status"
      aria-live="polite"
    >
      <AlertTriangle size={16} aria-hidden="true" />
      <span>
        {status.camera === 'initializing'
          ? 'Conectando cámara'
          : 'Cámara sin señal'}
      </span>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function readStoredValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return asNonEmptyString(window.localStorage.getItem(key));
}

function writeStoredValue(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
}

function readCachedProfile(userId: string): MeResponseDto | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(profileStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeResponseDto;
    if (!parsed.id || !Array.isArray(parsed.memberships)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(userId: string, profile: MeResponseDto): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    profileStorageKey(userId),
    JSON.stringify(profile),
  );
}

function readGlobalRoleFromSession(session: Session): AppRole | null {
  const role: unknown = session.user.app_metadata.role;
  return role === 'admin' || role === 'user' ? role : null;
}

function entityRoleForRates(
  profile: MeResponseDto | null,
  membership: MeMembershipDto | null,
): EntityRole | 'admin' | null {
  if (profile?.role === 'admin') return 'admin';
  return membership?.role ?? null;
}

function canAccessRates(
  profile: MeResponseDto | null,
  membership: MeMembershipDto | null,
  tenantId: string | null,
): boolean {
  if (profile?.role === 'admin') return tenantId !== null;
  return membership !== null;
}

function canManageRates(
  profile: MeResponseDto | null,
  membership: MeMembershipDto | null,
): boolean {
  return profile?.role === 'admin' || membership?.role === 'owner';
}

function membershipOptionLabel(membership: MeMembershipDto): string {
  return `${membership.tenantName} (${translateRole(membership.role)})`;
}

function shortTenantId(tenantId: string): string {
  return tenantId.slice(0, 8);
}

function sameMemberships(a: MeMembershipDto[], b: MeMembershipDto[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.tenantId !== right.tenantId ||
      left.tenantName !== right.tenantName ||
      left.tenantAddress !== right.tenantAddress ||
      left.role !== right.role
    ) {
      return false;
    }
  }
  return true;
}

export function SessionView({ session, sessionStale = false }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const cameraStatus = useCameraStatus();
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [section, setSection] = useState<WorkspaceSection>('operativo');
  const [historialFocus, setHistorialFocus] = useState<HistorialFocus | null>(
    null,
  );
  const [profile, setProfile] = useState<MeResponseDto | null>(() =>
    readCachedProfile(session.user.id),
  );
  const [activeTenantId, setActiveTenantId] = useState<string | null>(() => {
    return readStoredValue(tenantStorageKey(session.user.id));
  });
  const manualEntryDraftsRef = useRef<Record<string, ManualEntryDraft>>({});
  const activeDraftKeyRef = useRef<string | null>(null);
  // Platform admins have no memberships; they pick a lot from the full list.
  const [adminParkings, setAdminParkings] = useState<ParkingDto[] | null>(null);

  const tenantKey = useMemo(
    () => tenantStorageKey(session.user.id),
    [session.user.id],
  );
  const activeManualEntryDraftKey = activeTenantId
    ? manualEntryDraftKey(session.user.id, activeTenantId)
    : null;

  useEffect(() => {
    if (
      activeDraftKeyRef.current &&
      activeDraftKeyRef.current !== activeManualEntryDraftKey
    ) {
      delete manualEntryDraftsRef.current[activeDraftKeyRef.current];
    }
    activeDraftKeyRef.current = activeManualEntryDraftKey;
  }, [activeManualEntryDraftKey]);

  const handleManualEntryDraftChange = useCallback(
    (draft: ManualEntryDraft) => {
      if (!activeManualEntryDraftKey) return;
      manualEntryDraftsRef.current[activeManualEntryDraftKey] = draft;
    },
    [activeManualEntryDraftKey],
  );

  const resetManualEntryDraft = useCallback(() => {
    if (!activeManualEntryDraftKey) return;
    delete manualEntryDraftsRef.current[activeManualEntryDraftKey];
  }, [activeManualEntryDraftKey]);

  const activeCashSession = useLiveQuery(
    () =>
      activeTenantId
        ? localDb.cashSessions
            .where('tenantId')
            .equals(activeTenantId)
            .filter((s) => !s.closedAt)
            .first()
        : Promise.resolve(undefined),
    [activeTenantId],
  );

  const memberships = useMemo(
    () => profile?.memberships ?? [],
    [profile?.memberships],
  );
  const activeMembership = useMemo(() => {
    return memberships.find((item) => item.tenantId === activeTenantId) ?? null;
  }, [activeTenantId, memberships]);
  const effectiveGlobalRole =
    profile?.role ?? readGlobalRoleFromSession(session);
  const isAdminWithoutMemberships =
    effectiveGlobalRole === 'admin' && memberships.length === 0;
  const activeTenantName = useMemo(() => {
    if (activeMembership) return activeMembership.tenantName;
    if (!activeTenantId) return null;
    return (
      adminParkings?.find((parking) => parking.id === activeTenantId)?.name ??
      null
    );
  }, [activeMembership, activeTenantId, adminParkings]);
  // Sale del perfil cacheado, así el ticket también se imprime offline. Un
  // admin sin membership no tiene dirección: el ticket omite la línea.
  const activeTenantAddress = activeMembership?.tenantAddress ?? null;
  const activeRole = entityRoleForRates(profile, activeMembership);
  const ratesAllowed = canAccessRates(
    profile,
    activeMembership,
    activeTenantId,
  );
  const ratesManageAllowed = canManageRates(profile, activeMembership);
  const hasMemberships = memberships.length > 0;
  const canShowRatesNav =
    hasMemberships ||
    (effectiveGlobalRole === 'admin' && activeTenantId !== null);

  useEffect(() => {
    const cachedProfile = readCachedProfile(session.user.id);
    setProfile(cachedProfile);
    setActiveTenantId(readStoredValue(tenantKey));
  }, [session.user.id, tenantKey]);

  useEffect(() => {
    if (memberships.length === 0) return;

    const selectedStillExists =
      activeTenantId !== null &&
      memberships.some((item) => item.tenantId === activeTenantId);

    if (!selectedStillExists) {
      setActiveTenantId(memberships[0].tenantId);
    }
  }, [activeTenantId, memberships]);

  useEffect(() => {
    writeStoredValue(tenantKey, activeTenantId);
  }, [activeTenantId, tenantKey]);

  useEffect(() => {
    if (!ratesAllowed && section === 'rates') {
      setSection('operativo');
    }
  }, [ratesAllowed, section]);

  // Cambiar a un estacionamiento donde sos operador no debe dejarte adentro de
  // la configuración de cámara: el botón desaparece del sidebar, pero el panel
  // seguiría montado porque `section` no cambia solo.
  useEffect(() => {
    if (!ratesManageAllowed && section === 'camara-config') {
      setSection('operativo');
    }
  }, [ratesManageAllowed, section]);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile(): Promise<void> {
      try {
        const nextProfile = await fetchMe(session.access_token);
        if (isMounted) {
          setProfile((current) => {
            if (
              current?.id === nextProfile.id &&
              current.role === nextProfile.role &&
              current.email === nextProfile.email &&
              sameMemberships(current.memberships, nextProfile.memberships)
            ) {
              return current;
            }
            return nextProfile;
          });
          writeCachedProfile(session.user.id, nextProfile);
        }
      } catch (error) {
        if (isMounted) {
          const cachedProfile = readCachedProfile(session.user.id);
          if (cachedProfile) {
            setProfile(cachedProfile);
            showToast({
              message:
                'Sin conexión con el servidor. Usamos el perfil guardado en este equipo.',
              kind: 'info',
            });
          } else {
            showToast({
              message: translateApiError(error, { endpoint: 'auth.me' }),
              kind: 'error',
            });
          }
        }
      }
    }

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [session.access_token, session.user.id, showToast]);

  useEffect(() => {
    if (!isAdminWithoutMemberships) {
      setAdminParkings(null);
      return;
    }

    let isMounted = true;

    async function loadParkings(): Promise<void> {
      try {
        const parkings = await listAdminParkings(session.access_token);
        if (isMounted) {
          setAdminParkings(parkings);
        }
      } catch (error) {
        if (isMounted) {
          setAdminParkings([]);
          showToast({ message: translateApiError(error), kind: 'error' });
        }
      }
    }

    void loadParkings();

    return () => {
      isMounted = false;
    };
  }, [isAdminWithoutMemberships, session.access_token, showToast]);

  async function handleSignOut() {
    setPendingSignOut(true);
    manualEntryDraftsRef.current = {};
    try {
      await signOut();
    } catch (error) {
      showToast({ message: getErrorMessage(error), kind: 'error' });
    } finally {
      setPendingSignOut(false);
    }
  }

  function handleSelectTenant(): void {
    const next = window.prompt(
      'Ingresá el tenant ID activo (UUID) para operar este estacionamiento:',
      activeTenantId ?? '',
    );
    if (next === null) return;

    const normalized = next.trim();
    if (normalized.length === 0) {
      setActiveTenantId(null);
      showToast({
        message: 'Tenant manual removido.',
        kind: 'info',
      });
      return;
    }

    setActiveTenantId(normalized);
    showToast({ message: `Tenant activo: ${normalized}`, kind: 'success' });
  }

  const entitySwitcher = !sidebarCollapsed ? (
    <div className="entity-switcher">
      <span className="entity-switcher-kicker">Estacionamiento</span>

      {memberships.length > 1 ? (
        <label className="entity-select-wrap">
          <select
            className="entity-select sidebar-entity-select"
            value={activeTenantId ?? ''}
            onChange={(event) => {
              setActiveTenantId(event.target.value);
            }}
          >
            {memberships.map((membership) => (
              <option key={membership.tenantId} value={membership.tenantId}>
                {membershipOptionLabel(membership)}
              </option>
            ))}
          </select>
        </label>
      ) : activeMembership ? (
        <div className="entity-current">
          <span className="entity-current-name">
            {activeMembership.tenantName}
          </span>
          <span className="entity-current-role">
            {translateRole(activeMembership.role)}
          </span>
        </div>
      ) : effectiveGlobalRole === 'admin' ? (
        adminParkings && adminParkings.length > 0 ? (
          <label className="entity-select-wrap">
            <select
              className="entity-select sidebar-entity-select"
              value={activeTenantId ?? ''}
              onChange={(event) => {
                setActiveTenantId(event.target.value || null);
              }}
            >
              <option value="">Elegí un estacionamiento…</option>
              {adminParkings.map((parking) => (
                <option key={parking.id} value={parking.id}>
                  {parking.name}
                </option>
              ))}
            </select>
            <span className="entity-current-role">Admin</span>
          </label>
        ) : (
          <button
            type="button"
            className="entity-current entity-current-button"
            onClick={handleSelectTenant}
          >
            <span className="entity-current-name">
              {activeTenantId
                ? `Tenant ${shortTenantId(activeTenantId)}`
                : adminParkings === null
                  ? 'Cargando estacionamientos…'
                  : 'Definir tenant'}
            </span>
            <span className="entity-current-role">Admin</span>
          </button>
        )
      ) : (
        <div className="entity-current empty">
          <span className="entity-current-name">Sin asignación</span>
          <span className="entity-current-role">Contactá al administrador</span>
        </div>
      )}
    </div>
  ) : null;

  const sectionTitle: Record<WorkspaceSection, string> = {
    dashboard: 'Panel Operativo',
    operativo: 'Panel Operativo',
    camara: 'Cámara',
    historial: 'Historial',
    rates: 'Gestión de Tasas',
    'payment-methods': 'Métodos de Pago',
    vehicles: 'Catálogo de Vehículos',
    'vehicle-types': 'Tipos de Vehículo',
    caja: 'Caja',
    impresora: 'Impresora',
    'camara-config': 'Configuración de cámara',
  };

  const sectionIcon = (s: WorkspaceSection) => {
    if (s === 'rates') return <DollarSign size={20} aria-hidden />;
    if (s === 'camara') return <Cctv size={20} aria-hidden />;
    if (s === 'historial') return <Car size={20} aria-hidden />;
    if (s === 'payment-methods') return <CreditCard size={20} aria-hidden />;
    if (s === 'vehicles') return <Truck size={20} aria-hidden />;
    if (s === 'vehicle-types') return <Layers size={20} aria-hidden />;
    if (s === 'caja') return <Archive size={20} aria-hidden />;
    if (s === 'impresora') return <Printer size={20} aria-hidden />;
    if (s === 'camara-config') return <Cctv size={20} aria-hidden />;
    return <Home size={20} aria-hidden />;
  };

  return (
    <SyncProvider
      tenantId={activeTenantId}
      accessToken={session.access_token}
      userId={session.user.id}
    >
      <div className="app-shell">
        <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-top">
            <div className="brand-lockup compact">
              <div className="brand-badge" aria-hidden="true">
                <img src={PARKIT_LOGO_URL} alt="" />
              </div>
              {!sidebarCollapsed ? <h2>Parkit</h2> : null}
            </div>

            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setSidebarCollapsed((prev) => !prev);
              }}
              aria-label={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
            >
              {sidebarCollapsed ? '»' : '«'}
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="Navegación principal">
            <button
              type="button"
              className={`nav-item ${section === 'operativo' ? 'active' : ''}`}
              onClick={() => setSection('operativo')}
            >
              <Home size={18} aria-hidden="true" />
              {!sidebarCollapsed ? <span>Operativo</span> : null}
              {cameraStatus && cameraStatus.camera !== 'ok' ? (
                <span
                  className={`nav-status-dot ${cameraStatus.camera}`}
                  aria-label={
                    cameraStatus.camera === 'initializing'
                      ? 'Cámara conectando'
                      : 'Cámara sin señal'
                  }
                />
              ) : null}
            </button>

            <button
              type="button"
              className={`nav-item ${section === 'camara' ? 'active' : ''}`}
              onClick={() => setSection('camara')}
            >
              <Cctv size={18} aria-hidden="true" />
              {!sidebarCollapsed ? <span>Cámara</span> : null}
            </button>

            <button
              type="button"
              className={`nav-item ${section === 'historial' ? 'active' : ''}`}
              onClick={() => {
                setHistorialFocus(null);
                setSection('historial');
              }}
            >
              <Car size={18} aria-hidden="true" />
              {!sidebarCollapsed ? <span>Historial</span> : null}
            </button>

            {hasMemberships || effectiveGlobalRole === 'admin' ? (
              <button
                type="button"
                className={`nav-item ${section === 'caja' ? 'active' : ''}`}
                onClick={() => setSection('caja')}
              >
                <Archive size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Caja</span> : null}
              </button>
            ) : null}

            {canShowRatesNav ? (
              <button
                type="button"
                className={`nav-item ${section === 'rates' ? 'active' : ''}`}
                onClick={() => setSection('rates')}
              >
                <DollarSign size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Tasas</span> : null}
              </button>
            ) : null}

            {canShowRatesNav ? (
              <button
                type="button"
                className={`nav-item ${section === 'payment-methods' ? 'active' : ''}`}
                onClick={() => setSection('payment-methods')}
              >
                <CreditCard size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Métodos de pago</span> : null}
              </button>
            ) : null}

            {canShowRatesNav ? (
              <button
                type="button"
                className={`nav-item ${section === 'vehicles' ? 'active' : ''}`}
                onClick={() => setSection('vehicles')}
              >
                <Truck size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Vehículos</span> : null}
              </button>
            ) : null}

            {canShowRatesNav ? (
              <button
                type="button"
                className={`nav-item ${section === 'vehicle-types' ? 'active' : ''}`}
                onClick={() => setSection('vehicle-types')}
              >
                <Layers size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Tipos de vehículo</span> : null}
              </button>
            ) : null}

            {/* Sin gating: es configuración de esta computadora, no del tenant. */}
            <button
              type="button"
              className={`nav-item ${section === 'impresora' ? 'active' : ''}`}
              onClick={() => setSection('impresora')}
            >
              <Printer size={18} aria-hidden="true" />
              {!sidebarCollapsed ? <span>Impresora</span> : null}
            </button>

            {/* Única sección oculta para el operador. La cámara es hardware del
                estacionamiento y tocarla mal deja la detección automática sin
                funcionar, así que la decisión es del dueño. `ratesManageAllowed`
                es la flag que significa "owner o admin" — NO `canShowRatesNav`,
                que no distingue owner de operator. */}
            {ratesManageAllowed ? (
              <button
                type="button"
                className={`nav-item ${section === 'camara-config' ? 'active' : ''}`}
                onClick={() => setSection('camara-config')}
              >
                <Cctv size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Configurar cámara</span> : null}
              </button>
            ) : null}
          </nav>

          <div className="sidebar-foot">
            <LprStatusIndicator collapsed={sidebarCollapsed} />
            <SyncButton collapsed={sidebarCollapsed} />

            {!sidebarCollapsed ? (
              <div className="sidebar-user">
                <p className="muted mini">
                  {session.user.email ?? session.user.id}
                </p>
              </div>
            ) : null}

            {entitySwitcher}

            <button
              className="signout-button compact"
              onClick={() => void handleSignOut()}
              disabled={pendingSignOut}
            >
              {pendingSignOut ? 'Cerrando...' : 'Salir'}
            </button>
          </div>
        </aside>

        <section className="app-main">
          {!isOnline && <OfflineBanner staleSession={sessionStale} />}

          <header className="workspace-header">
            <div className="workspace-header-main">
              <div className="workspace-header-icon">
                {sectionIcon(section)}
              </div>
              <div>
                <h1>{sectionTitle[section]}</h1>
                {activeTenantName ? (
                  <p className="workspace-header-parking">{activeTenantName}</p>
                ) : null}
              </div>
            </div>
            {section === 'operativo' ? (
              <OperationalCameraStatusBadge status={cameraStatus} />
            ) : null}
          </header>

          <div className="workspace-content">
            {section === 'operativo' ? (
              activeTenantId ? (
                activeCashSession ? (
                  <div className="operativo-layout">
                    <div className="operativo-entry-column">
                      <EntryForm
                        tenantId={activeTenantId}
                        accessToken={session.access_token}
                        parkingName={activeTenantName}
                        parkingAddress={activeTenantAddress}
                        initialDraft={
                          activeManualEntryDraftKey
                            ? (manualEntryDraftsRef.current[
                                activeManualEntryDraftKey
                              ] ?? null)
                            : null
                        }
                        onDraftChange={handleManualEntryDraftChange}
                        onDraftReset={resetManualEntryDraft}
                      />
                      <ExitControls
                        tenantId={activeTenantId}
                        accessToken={session.access_token}
                        userId={session.user.id}
                      />
                    </div>
                    <AutoEntriesColumns
                      tenantId={activeTenantId}
                      accessToken={session.access_token}
                    />
                  </div>
                ) : (
                  <NoCashSessionScreen
                    tenantId={activeTenantId}
                    accessToken={session.access_token}
                  />
                )
              ) : (
                <section
                  className={`dashboard-card ${
                    hasMemberships || isAdminWithoutMemberships ? '' : 'warning'
                  }`}
                >
                  <h2>
                    {hasMemberships
                      ? (activeMembership?.tenantName ??
                        'Estacionamiento activo')
                      : isAdminWithoutMemberships
                        ? 'Elegí un estacionamiento'
                        : 'Sin estacionamientos asignados'}
                  </h2>
                  <p className="muted">
                    {hasMemberships
                      ? `Seleccioná un estacionamiento para operar.`
                      : isAdminWithoutMemberships
                        ? 'Como administrador, elegí el estacionamiento a operar en el selector del panel lateral.'
                        : 'Tu usuario no tiene una relación owner/operator con un estacionamiento.'}
                  </p>
                </section>
              )
            ) : section === 'camara' ? (
              <CameraPanel />
            ) : section === 'historial' ? (
              activeTenantId ? (
                <EntryHistoryPanel
                  tenantId={activeTenantId}
                  userId={session.user.id}
                  accessToken={session.access_token}
                  actorRole={activeRole}
                  initialCashSessionId={
                    historialFocus?.kind === 'cashSession'
                      ? historialFocus.sessionId
                      : undefined
                  }
                  initialOnlyCurrentSession={
                    historialFocus?.kind === 'activeCashSession'
                  }
                  parkingName={activeTenantName}
                  parkingAddress={activeTenantAddress}
                  onBackToCaja={
                    historialFocus
                      ? () => {
                          setHistorialFocus(null);
                          setSection('caja');
                        }
                      : undefined
                  }
                />
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para ver el historial.
                  </p>
                </section>
              )
            ) : section === 'payment-methods' ? (
              activeTenantId ? (
                <PaymentMethodsPanel
                  accessToken={session.access_token}
                  tenantId={activeTenantId}
                  userId={session.user.id}
                  canManage={ratesManageAllowed}
                />
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para gestionar métodos de
                    pago.
                  </p>
                </section>
              )
            ) : section === 'vehicles' ? (
              activeTenantId ? (
                <VehiclesPanel
                  accessToken={session.access_token}
                  tenantId={activeTenantId}
                  userId={session.user.id}
                  canManage={ratesManageAllowed}
                />
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para ver el catálogo de
                    vehículos.
                  </p>
                </section>
              )
            ) : section === 'vehicle-types' ? (
              activeTenantId ? (
                <VehicleTypesPanel
                  accessToken={session.access_token}
                  tenantId={activeTenantId}
                  canManage={ratesManageAllowed}
                />
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para ver los tipos de
                    vehículo.
                  </p>
                </section>
              )
            ) : section === 'caja' ? (
              activeTenantId ? (
                <div className="caja-layout">
                  <CashSessionPanel
                    tenantId={activeTenantId}
                    accessToken={session.access_token}
                    onViewMovements={() => {
                      setHistorialFocus({ kind: 'activeCashSession' });
                      setSection('historial');
                    }}
                  />
                  <CashSessionHistoryPanel
                    tenantId={activeTenantId}
                    accessToken={session.access_token}
                    onSelectSession={(cashSession) => {
                      setHistorialFocus({
                        kind: 'cashSession',
                        sessionId: cashSession.id,
                      });
                      setSection('historial');
                    }}
                  />
                </div>
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para gestionar la caja.
                  </p>
                </section>
              )
            ) : section === 'camara-config' ? (
              <CameraSettingsPanel />
            ) : section === 'impresora' ? (
              <PrinterSettingsPanel
                tenantName={activeTenantName}
                tenantAddress={activeTenantAddress}
              />
            ) : section === 'dashboard' ? (
              <section
                className={`dashboard-card ${hasMemberships ? '' : 'warning'}`}
              >
                <h2>
                  {hasMemberships
                    ? (activeMembership?.tenantName ?? 'Estacionamiento activo')
                    : 'Sin estacionamientos asignados'}
                </h2>
                <p className="muted">
                  {hasMemberships
                    ? `Rol: ${activeRole ? translateRole(activeRole) : 'Sin rol'}`
                    : 'Tu usuario no tiene una relación owner/operator con un estacionamiento.'}
                </p>
              </section>
            ) : ratesAllowed ? (
              activeTenantId ? (
                <RatesPanel
                  accessToken={session.access_token}
                  tenantId={activeTenantId}
                  userId={session.user.id}
                  canManage={ratesManageAllowed}
                />
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para consultar sus tasas.
                  </p>
                </section>
              )
            ) : (
              <section className="dashboard-card warning">
                <h2>Acceso restringido</h2>
                <p className="muted">
                  Solo usuarios vinculados a este estacionamiento pueden acceder
                  al módulo de tasas.
                </p>
              </section>
            )}
          </div>
        </section>
      </div>
    </SyncProvider>
  );
}
