import type { Session } from '@supabase/supabase-js';
import {
  AlertTriangle,
  CalendarClock,
  Car,
  Cctv,
  CreditCard,
  DollarSign,
  Home,
  Layers,
  Printer,
  Truck,
  Archive,
  ArrowLeft,
  Settings,
  ListChecks,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CameraPanel } from '../camera/CameraPanel';
import { AutoEntriesColumns } from '../camera/AutoEntriesColumns';
import { useCameraStatus, type CameraStatus } from '../camera/useCameraStatus';
import { EntryForm } from '../entries/EntryForm';
import type { ManualEntryDraft } from '../entries/EntryFormCore';
import { TodayReservationsEntry } from '../reservations/TodayReservationsEntry';
import { ArrivalNotices } from '../entries/ArrivalNotices';
import { ReservationsPanel } from '../reservations/ReservationsPanel';
import { useReservationServiceAvailability } from '../reservations/useReservationServiceAvailability';
import { useReservationsFeed } from '../reservations/useReservationsFeed';
import { ExitControls } from '../entries/ExitControls';
import { EntryHistoryPanel } from '../entries/EntryHistoryPanel';
import { PaymentMethodsPanel } from '../payment-methods/PaymentMethodsPanel';
import { RatesPanel } from '../rates/RatesPanel';
import { VehiclesPanel } from '../vehicles/VehiclesPanel';
import { VehicleTypesPanel } from '../vehicle-types/VehicleTypesPanel';
import { LprWhitelistPanel } from '../lpr-whitelist/LprWhitelistPanel';
import { CameraRulesBridge } from '../camera/CameraRulesBridge';
import { OfflineBanner } from '../sync/OfflineBanner';
import { SyncButton } from '../sync/SyncButton';
import {
  hasDesktopServiceFailure,
  useDesktopServiceFailures,
} from '../system/useDesktopServiceFailures';
import type { DesktopServiceName } from '../system/useDesktopServiceFailures';
import { getWorkspaceHeaderAlerts } from '../system/workspaceHeaderAlerts';
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
import {
  fetchEntityProfileSettings,
  type DesktopCameraConfigPayload,
} from '../../lib/api/entities';
import { translateApiError, translateRole } from '../../lib/api/translate';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { PARKIT_LOGO_URL } from '../../lib/brand';
import {
  normalizeTicketTemplateSettings,
  writeTicketTemplateSettings,
} from '../../lib/print/ticketTemplate';
import { SyncProvider } from '../../lib/sync/SyncContext';
import {
  onTenantDeleted,
  setPendingAuthNotice,
  TENANT_DELETED_NOTICE,
} from '../../lib/sync/tenantDeleted';
import { signOut } from '../../lib/supabase/session';
import { ConfigNavGroup, type ConfigNavItem } from './ConfigNavGroup';
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
  | 'lpr-whitelist'
  | 'caja'
  | 'reservas'
  | 'impresora';

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
      className={`workspace-alert-badge operational-camera-badge ${
        status.camera === 'down' ? 'danger' : 'warning'
      } ${status.camera}`}
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

function DesktopServiceFailureBadge({ label }: { label: string }) {
  return (
    <div
      className="workspace-alert-badge danger"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function WorkspaceHeaderAlerts({
  cameraStatus,
  failedServices,
}: {
  cameraStatus: CameraStatus | null;
  failedServices: readonly DesktopServiceName[];
}) {
  const alerts = getWorkspaceHeaderAlerts({ cameraStatus, failedServices });

  if (alerts.length === 0) return null;

  return (
    <div className="workspace-header-alerts" aria-label="Alertas del sistema">
      {alerts.includes('camera-service') ? (
        <DesktopServiceFailureBadge label="Servicio de cámara no disponible" />
      ) : null}
      {alerts.includes('lpr-service') ? (
        <DesktopServiceFailureBadge label="Servicio LPR no disponible" />
      ) : null}
      {alerts.includes('camera-signal') ? (
        <OperationalCameraStatusBadge status={cameraStatus} />
      ) : null}
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

function desktopCameraInputFromSettings(
  config: DesktopCameraConfigPayload,
): DesktopCameraConfigInput {
  return {
    mode: config.mode,
    deviceIndex: config.deviceIndex,
    host: config.host,
    port: config.port,
    username: config.username,
    streamPath: config.streamPath,
    cameraId: config.cameraId,
    location: config.location,
    ...(config.tuning
      ? { tuning: config.tuning as unknown as DesktopCameraTuning }
      : {}),
  };
}

export function SessionView({ session, sessionStale = false }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const cameraStatus = useCameraStatus();
  const failedServices = useDesktopServiceFailures();
  const cameraServiceDown = hasDesktopServiceFailure(
    failedServices,
    'camera-service',
  );
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [section, setSection] = useState<WorkspaceSection>('operativo');
  const [cameraSettingsOpen, setCameraSettingsOpen] = useState(false);
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
  const activeAdminParking =
    adminParkings?.find((parking) => parking.id === activeTenantId) ?? null;
  const activeTenantAddress =
    activeMembership?.tenantAddress ?? activeAdminParking?.address ?? null;
  const activeTenantCuit = activeAdminParking?.cuit ?? null;
  const activeRole = entityRoleForRates(profile, activeMembership);
  const ratesAllowed = canAccessRates(
    profile,
    activeMembership,
    activeTenantId,
  );
  const ratesManageAllowed = canManageRates(profile, activeMembership);
  const canViewCashSessionHistory =
    activeRole === 'admin' || activeRole === 'owner';
  const hasMemberships = memberships.length > 0;
  const canShowRatesNav =
    hasMemberships ||
    (effectiveGlobalRole === 'admin' && activeTenantId !== null);
  const reservationsAvailable = useReservationServiceAvailability({
    tenantId: activeTenantId,
    accessToken: session.access_token,
  });
  // Reservas: el dueño y el operador ven y responden (el backend no restringe
  // por rol), siempre que la playa tenga el servicio configurado.
  const canShowReservasNav =
    activeTenantId !== null && canShowRatesNav && reservationsAvailable;
  const reservationsFeed = useReservationsFeed({
    tenantId: canShowReservasNav ? activeTenantId : null,
    accessToken: session.access_token,
  });

  useEffect(() => {
    if (section !== 'camara' || !ratesManageAllowed) {
      setCameraSettingsOpen(false);
    }
  }, [ratesManageAllowed, section]);

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
    if (!activeTenantId) return;

    let mounted = true;
    void fetchEntityProfileSettings(activeTenantId, session.access_token)
      .then((settings) => {
        if (!mounted) return;
        if (settings.ticketTemplate) {
          writeTicketTemplateSettings(
            normalizeTicketTemplateSettings(
              activeTenantId,
              settings.ticketTemplate,
            ),
          );
        }
        if (
          settings.desktopCameraConfig &&
          window.parkitDesktop &&
          typeof window.parkitDesktop.setCameraConfig === 'function'
        ) {
          void window.parkitDesktop
            .setCameraConfig(
              desktopCameraInputFromSettings(settings.desktopCameraConfig),
            )
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [activeTenantId, session.access_token]);

  useEffect(() => {
    if (!ratesAllowed && section === 'rates') {
      setSection('operativo');
    }
  }, [ratesAllowed, section]);

  useEffect(() => {
    if (!canShowReservasNav && section === 'reservas') {
      setSection('operativo');
    }
  }, [canShowReservasNav, section]);

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

  /**
   * El estacionamiento activo fue dado de baja desde el panel.
   *
   * Lo dispara `apiRequest` al cosechar un 410 `ENTITY_DELETED` — o sea que
   * llega solo, por el pull de fondo o por el sync al reconectar, sin polling
   * nuevo. Sin red no llega nada y la sesión offline se respeta: un corte de
   * internet no es una baja.
   *
   * SE CIERRA LA SESIÓN SÓLO SI NO QUEDA OTRA SUCURSAL. Con más de una, se
   * cambia de sucursal y se avisa: cerrarle la sesión a un operador
   * multi-sucursal porque se dio de baja UNA playa lo dejaría afuera de las
   * otras, que siguen funcionando.
   *
   * No se toca Dexie. La baja es reversible hasta la purga, y limpiar acá
   * perdería para siempre lo que el operador no alcanzó a sincronizar.
   */
  useEffect(() => {
    return onTenantDeleted((deletedTenantId) => {
      if (deletedTenantId !== activeTenantId) return;

      const remaining = memberships.filter(
        (item) => item.tenantId !== deletedTenantId,
      );

      if (remaining.length > 0) {
        setActiveTenantId(remaining[0].tenantId);
        showToast({
          message: `Este estacionamiento fue eliminado. Cambiamos a ${remaining[0].tenantName}.`,
          kind: 'error',
        });
        return;
      }

      setPendingAuthNotice(TENANT_DELETED_NOTICE);
      void signOut().catch(() => {
        // Si el backend no contesta, `signOut` igual limpia la sesión local.
        // Lo importante es que el operador no siga operando contra un tenant
        // que ya no existe.
      });
    });
  }, [activeTenantId, memberships, showToast]);

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
    <div className="sidebar-session-card">
      <p className="sidebar-session-email">
        {session.user.email ?? session.user.id}
      </p>
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
    rates: 'Gestión de Tarifas',
    'payment-methods': 'Métodos de Pago',
    vehicles: 'Catálogo de Vehículos',
    'vehicle-types': 'Tipos de Vehículo',
    'lpr-whitelist': 'Lista blanca',
    caja: 'Caja',
    reservas: 'Reservas',
    impresora: 'Impresora',
  };

  const sectionIcon = (s: WorkspaceSection) => {
    if (s === 'rates') return <DollarSign size={20} aria-hidden />;
    if (s === 'camara') return <Cctv size={20} aria-hidden />;
    if (s === 'historial') return <Car size={20} aria-hidden />;
    if (s === 'payment-methods') return <CreditCard size={20} aria-hidden />;
    if (s === 'vehicles') return <Truck size={20} aria-hidden />;
    if (s === 'vehicle-types') return <Layers size={20} aria-hidden />;
    if (s === 'lpr-whitelist') return <ListChecks size={20} aria-hidden />;
    if (s === 'caja') return <Archive size={20} aria-hidden />;
    if (s === 'reservas') return <CalendarClock size={20} aria-hidden />;
    if (s === 'impresora') return <Printer size={20} aria-hidden />;
    return <Home size={20} aria-hidden />;
  };

  const configNavItems: ConfigNavItem<WorkspaceSection>[] = [
    ...(canShowRatesNav
      ? [
          {
            section: 'rates' as const,
            label: 'Tarifas',
            icon: <DollarSign size={18} aria-hidden="true" />,
          },
          {
            section: 'payment-methods' as const,
            label: 'Métodos de pago',
            icon: <CreditCard size={18} aria-hidden="true" />,
          },
          {
            section: 'vehicles' as const,
            label: 'Vehículos',
            icon: <Truck size={18} aria-hidden="true" />,
          },
          {
            section: 'vehicle-types' as const,
            label: 'Tipos de vehículo',
            icon: <Layers size={18} aria-hidden="true" />,
          },
        ]
      : []),
    {
      section: 'impresora' as const,
      label: 'Impresora',
      icon: <Printer size={18} aria-hidden="true" />,
    },
    ...(ratesManageAllowed
      ? [
          {
            section: 'lpr-whitelist' as const,
            label: 'Lista blanca',
            icon: <ListChecks size={18} aria-hidden="true" />,
          },
        ]
      : []),
  ];

  return (
    <SyncProvider
      tenantId={activeTenantId}
      accessToken={session.access_token}
      userId={session.user.id}
    >
      <CameraRulesBridge
        key={activeTenantId ?? 'none'}
        tenantId={activeTenantId}
      />
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
              {cameraServiceDown ? (
                <span
                  className="nav-status-dot down"
                  aria-label="Servicio de cámara no disponible"
                />
              ) : cameraStatus && cameraStatus.camera !== 'ok' ? (
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

            {canShowReservasNav ? (
              <button
                type="button"
                className={`nav-item ${section === 'reservas' ? 'active' : ''}`}
                onClick={() => setSection('reservas')}
                aria-label={
                  reservationsFeed.pendingCount > 0
                    ? `Reservas, ${reservationsFeed.pendingCount} por aceptar`
                    : undefined
                }
              >
                <CalendarClock size={18} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Reservas</span> : null}
                {reservationsFeed.pendingCount > 0 ? (
                  <span
                    // La key reinicia la animación con cada reserva nueva.
                    key={reservationsFeed.pulseKey}
                    className={`nav-badge${
                      reservationsFeed.pulseKey > 0 ? ' nav-badge--pulse' : ''
                    }`}
                    aria-hidden="true"
                  >
                    {reservationsFeed.pendingCount}
                  </span>
                ) : null}
              </button>
            ) : null}

            {/* Grupo desplegable. Cada hija conserva su regla de visibilidad:
                Impresora es configuración de esta computadora (sin gating) y
                el resto sigue a `canShowRatesNav`. La configuración de la
                cámara ya no es un ítem: vive en el engranaje de Cámara
                (sólo owner/admin). */}
            <ConfigNavGroup
              label="Configuración"
              items={configNavItems}
              activeSection={section}
              collapsed={sidebarCollapsed}
              onSelect={setSection}
            />
          </nav>

          <div className="sidebar-foot">
            <SyncButton collapsed={sidebarCollapsed} />

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
            <div className="workspace-header-side">
              {section === 'camara' && ratesManageAllowed ? (
                <button
                  type="button"
                  className={`workspace-header-action ${
                    cameraSettingsOpen ? 'secondary' : ''
                  }`}
                  onClick={() => setCameraSettingsOpen((open) => !open)}
                >
                  {cameraSettingsOpen ? (
                    <ArrowLeft size={16} aria-hidden="true" />
                  ) : (
                    <Settings size={16} aria-hidden="true" />
                  )}
                  {cameraSettingsOpen ? 'Ver cámara' : 'Ajustes'}
                </button>
              ) : null}
              <WorkspaceHeaderAlerts
                cameraStatus={cameraStatus}
                failedServices={failedServices}
              />
            </div>
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
                        parkingCuit={activeTenantCuit}
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
                      <ArrivalNotices tenantId={activeTenantId} />
                      <ExitControls
                        tenantId={activeTenantId}
                        accessToken={session.access_token}
                        userId={session.user.id}
                        actorRole={activeRole}
                        parkingName={activeTenantName}
                        parkingAddress={activeTenantAddress}
                        parkingCuit={activeTenantCuit}
                      />
                      {canShowReservasNav ? (
                        <TodayReservationsEntry
                          tenantId={activeTenantId}
                          accessToken={session.access_token}
                          feed={reservationsFeed}
                          onOpenReservations={() => setSection('reservas')}
                        />
                      ) : null}
                    </div>
                    <AutoEntriesColumns
                      tenantId={activeTenantId}
                      accessToken={session.access_token}
                      parkingName={activeTenantName}
                      parkingAddress={activeTenantAddress}
                      parkingCuit={activeTenantCuit}
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
              <CameraPanel
                tenantId={activeTenantId}
                accessToken={session.access_token}
                canConfigure={ratesManageAllowed}
                failedServices={failedServices}
                settingsOpen={cameraSettingsOpen}
                onSettingsOpenChange={setCameraSettingsOpen}
              />
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
                  parkingCuit={activeTenantCuit}
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
            ) : section === 'lpr-whitelist' ? (
              activeTenantId && ratesManageAllowed ? (
                <LprWhitelistPanel
                  key={activeTenantId}
                  tenantId={activeTenantId}
                  accessToken={session.access_token}
                  userId={session.user.id}
                  canManage={ratesManageAllowed}
                />
              ) : null
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
                  {canViewCashSessionHistory ? (
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
                  ) : null}
                </div>
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para gestionar la caja.
                  </p>
                </section>
              )
            ) : section === 'reservas' ? (
              activeTenantId ? (
                <ReservationsPanel
                  tenantId={activeTenantId}
                  accessToken={session.access_token}
                  feed={reservationsFeed}
                />
              ) : (
                <section className="dashboard-card warning">
                  <h2>Falta estacionamiento activo</h2>
                  <p className="muted">
                    Seleccioná un estacionamiento para ver sus reservas.
                  </p>
                </section>
              )
            ) : section === 'impresora' ? (
              <PrinterSettingsPanel
                tenantId={activeTenantId}
                tenantName={activeTenantName}
                tenantAddress={activeTenantAddress}
                tenantCuit={activeTenantCuit}
                actorRole={activeRole}
                accessToken={session.access_token}
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
                    Seleccioná un estacionamiento para consultar sus tarifas.
                  </p>
                </section>
              )
            ) : (
              <section className="dashboard-card warning">
                <h2>Acceso restringido</h2>
                <p className="muted">
                  Solo usuarios vinculados a este estacionamiento pueden acceder
                  al módulo de tarifas.
                </p>
              </section>
            )}
          </div>
        </section>
      </div>
    </SyncProvider>
  );
}
