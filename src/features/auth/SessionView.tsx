import type { Session } from '@supabase/supabase-js';
import {
  Car,
  Cctv,
  CreditCard,
  DollarSign,
  Home,
  Layers,
  Truck,
  Archive,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CameraPanel } from '../camera/CameraPanel';
import { AutoEntriesColumns } from '../camera/AutoEntriesColumns';
import { EntryForm } from '../entries/EntryForm';
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
import { SyncProvider } from '../../lib/sync/SyncContext';
import { signOut } from '../../lib/supabase/session';
import { getErrorMessage } from './errors';

type Props = {
  session: Session;
};

type WorkspaceSection =
  | 'dashboard'
  | 'rates'
  | 'operativo'
  | 'camara'
  | 'historial'
  | 'payment-methods'
  | 'vehicles'
  | 'vehicle-types'
  | 'caja';

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
      left.role !== right.role
    ) {
      return false;
    }
  }
  return true;
}

export function SessionView({ session }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [section, setSection] = useState<WorkspaceSection>('operativo');
  const [historialCashSessionId, setHistorialCashSessionId] = useState<
    string | null
  >(null);
  const [profile, setProfile] = useState<MeResponseDto | null>(() =>
    readCachedProfile(session.user.id),
  );
  const [activeTenantId, setActiveTenantId] = useState<string | null>(() => {
    return readStoredValue(tenantStorageKey(session.user.id));
  });
  // Platform admins have no memberships; they pick a lot from the full list.
  const [adminParkings, setAdminParkings] = useState<ParkingDto[] | null>(null);

  const tenantKey = useMemo(
    () => tenantStorageKey(session.user.id),
    [session.user.id],
  );

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
  };

  const sectionIcon = (s: WorkspaceSection) => {
    if (s === 'rates') return <DollarSign size={20} aria-hidden />;
    if (s === 'camara') return <Cctv size={20} aria-hidden />;
    if (s === 'historial') return <Car size={20} aria-hidden />;
    if (s === 'payment-methods') return <CreditCard size={20} aria-hidden />;
    if (s === 'vehicles') return <Truck size={20} aria-hidden />;
    if (s === 'vehicle-types') return <Layers size={20} aria-hidden />;
    if (s === 'caja') return <Archive size={20} aria-hidden />;
    return <Home size={20} aria-hidden />;
  };

  return (
    <SyncProvider tenantId={activeTenantId} accessToken={session.access_token}>
      <div className="app-shell">
        <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-top">
            <div className="brand-lockup compact">
              <div className="brand-badge" aria-hidden="true">
                P
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
                setHistorialCashSessionId(null);
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
          </nav>

          <div className="sidebar-foot">
            <LprStatusIndicator collapsed={sidebarCollapsed} />
            <SyncButton collapsed={sidebarCollapsed} />

            {!sidebarCollapsed ? (
              <div className="sidebar-user">
                <p className="muted mini">
                  {session.user.email ?? session.user.id}
                </p>
                <p className="role-pill">
                  {activeRole
                    ? translateRole(activeRole)
                    : 'Sin establecimiento'}
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
          {!isOnline && <OfflineBanner />}

          <header className="workspace-header">
            <div className="workspace-header-icon">{sectionIcon(section)}</div>
            <div>
              <h1>{sectionTitle[section]}</h1>
              {activeTenantName ? (
                <p className="workspace-header-parking">{activeTenantName}</p>
              ) : null}
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
                  initialCashSessionId={historialCashSessionId ?? undefined}
                  onBackToCaja={
                    historialCashSessionId
                      ? () => {
                          setHistorialCashSessionId(null);
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
                  />
                  <CashSessionHistoryPanel
                    tenantId={activeTenantId}
                    onSelectSession={(cashSession) => {
                      setHistorialCashSessionId(cashSession.id);
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
