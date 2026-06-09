# AGENT GUIDE (IA) — front-desktop

## Mision

Desarrollar frontend desktop manteniendo separacion estricta entre Electron (sistema) y Renderer (UI),
y siguiendo el patron **local-first** para toda feature que toque datos operativos del estacionamiento.

## Stack y limites

- Electron (main + preload) + React/Vite renderer.
- TypeScript en ambas capas.
- Cliente Auth: Supabase JS.
- Base de datos local: **Dexie.js** (IndexedDB, renderer process) — fuente de verdad en runtime.
- Tipos HTTP: `src/generated/api-types.ts` (OpenAPI).
- Este repo NO gestiona DB/migraciones/seeds.

## Reglas obligatorias

1. **`src/generated/api-types.ts`**: preferir `bun run sync-types` (requiere backend corriendo).
   Si el backend no está disponible, avisar al usuario.
2. No crear tipos HTTP manuales si existen en OpenAPI y son exactos.
3. `electron/main.ts`: ciclo de vida, ventanas, integración OS.
4. `electron/preload.ts`: único puente permitido hacia renderer.
5. `src/`: UI y lógica de producto; no acceso directo a Node/Electron.
6. Mantener dev renderer en `5174` para no chocar con `front-web` (`5173`).

## Arquitectura offline-first (OBLIGATORIO para features operativas)

Todo panel que lee o escribe datos del estacionamiento DEBE seguir este flujo:

### Lectura (siempre desde Dexie)

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../lib/db/localDb';

const items = useLiveQuery(
  () => localDb.rates.where('tenantId').equals(tenantId).toArray(),
  [tenantId],
);
```

Nunca leer directamente de la API en un `useEffect` para datos que deben estar disponibles offline.

### Escritura (online-or-queue)

```ts
if (isOnline) {
  // 1. Llamar API
  const result = await apiCall(...);
  // 2. Actualizar localDb con la respuesta del servidor
  await localDb.table.put(toLocalFormat(result));
} else {
  // 1. Escribir en localDb inmediatamente (el usuario ve el cambio al instante)
  await localDb.table.put(localRecord);
  // 2. Encolar la operación para sincronizar al reconectar
  await localDb.pendingOps.add({ entityType, operation, tenantId, entityId, payload, ... });
}
```

### Infraestructura de sync

| Archivo                               | Rol                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `src/lib/db/localDb.ts`               | Definición Dexie — tablas, índices, tipos locales                            |
| `src/lib/network/NetworkContext.tsx`  | `useNetwork()` — detecta online/offline vía eventos del browser              |
| `src/lib/sync/SyncService.ts`         | Singleton — `pullRates()`, `pullEntries()`, `pushPendingOps()`, `fullSync()` |
| `src/lib/sync/SyncContext.tsx`        | `useSync()` — expone `pendingCount`, `isSyncing`, `triggerSync` al UI        |
| `src/features/sync/SyncButton.tsx`    | Botón en sidebar con badge de ops pendientes                                 |
| `src/features/sync/OfflineBanner.tsx` | Banner amarillo cuando `isOnline === false`                                  |

### Protección de sesión offline

`App.tsx` intercepta el `onSessionChange` para NO cerrar sesión si `!navigator.onLine`.
Así el token puede expirar sin que el usuario pierda acceso mientras está offline.

### Tablas locales (Dexie)

- **`rates`**: `id, tenantId, name, hourPriceArs, stayPriceArs, fractionPriceArs, isActive, version, syncSeq, createdAt, updatedAt` (precios como `string` para evitar pérdida de precisión)
- **`entries`**: `id, tenantId, plate, color?, enteredAt, leftAt?, amountPaid?, vehicleId, rateId?, snapshot fields..., version, syncSeq, updatedAt`
- **`vehicles`**: `id, brand, model, type?`
- **`paymentMethods`**: `id, tenantId, type, name, enabled, isDefault`
- **`syncState`**: `key` = `"rates:{tenantId}"` / `"entries:{tenantId}"`, `lastSeq`, `lastSyncAt`
- **`pendingOps`**: operaciones encoladas mientras offline — `localId (++autoincrement), entityType, operation, tenantId, entityId, payload, status, createdAt, retryCount, error?`

## Seguridad Electron (mandatorio)

- Exponer al renderer solo APIs mínimas vía `contextBridge`.
- No habilitar `nodeIntegration` en renderer salvo justificación explícita.
- No pasar objetos sensibles completos por IPC si no es necesario.

## Política de contratos API

- Fuente por defecto: `OPENAPI_URL=http://localhost:3000/api-json`.
- Generar: `bun run sync-types` (requiere backend corriendo). Commitear `src/generated/api-types.ts`.
- Tipos manuales permitidos solo para estado/view-model interno O cuando sync-types no está disponible.

## Servicio LPR (`services/lpr/`)

Microservicio Python (FastAPI) de reconocimiento de patentes que corre local
junto a la app. Electron lo levanta como binario standalone al iniciar.

- Stack: `fast-alpr` (ONNX, sin PyTorch), con detector YOLO-v9 y OCR CCT.
- OCR default: `cct-s-v2-global-model`, compatible con patentes Mercosur y antiguas.
- Debe funcionar offline: los modelos se descargan durante build/install y se
  incluyen en el binario.
- API local: `GET /health` y `POST /process` en `127.0.0.1:8765`.
- Trabajar mediante los targets `make lpr-*`, no ejecutar `pip` o `python` a mano.
- Documentación completa: [`services/lpr/README.md`](./services/lpr/README.md).

## Donde escribir código

```
src/
  features/
    <feature>/           # UI/lógica de cada feature
    entries/             # Ingresos, egresos, historial (offline-first)
    rates/               # Gestión de tarifas (offline-first)
    sync/                # SyncButton, OfflineBanner
  lib/
    api/                 # Funciones HTTP (entries.ts, rates.ts, vehicles.ts, auth.ts...)
    db/
      localDb.ts         # Definición Dexie — ÚNICA fuente de verdad local
    network/
      NetworkContext.tsx # Detección online/offline
    sync/
      SyncService.ts     # Lógica de pull/push
      SyncContext.tsx    # Provider + useSync() hook
    supabase/            # Integración supabase compartida
    format/              # argentina.ts — formateo ARS, fechas locales
    notifications/       # ToastProvider
    ui/                  # ConfirmDialog y otros shared UI
  generated/
    api-types.ts         # OpenAPI types — editar con sync-types, o manualmente si es necesario
electron/                # main.ts, preload.ts
```

## Flujo de trabajo recomendado

```bash
cp .env.example .env
bun install
bun run dev
```

Para sincronizar tipos desde el backend (requiere backend corriendo en :3000):

```bash
bun run sync-types
```

## Checklist antes de PR

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Anti-patrones

- No mezclar código de Electron dentro de componentes React.
- No saltear preload y hablar directo con `ipcRenderer` desde cualquier módulo.
- No cambiar puertos de dev sin actualizar scripts relacionados (`wait-on`, `VITE_DEV_SERVER_URL`).
- **No leer datos operativos directamente de la API en un `useEffect`** — usar `useLiveQuery` sobre Dexie.
- **No mutar datos sin actualizar localDb** — la UI es reactiva a Dexie, no al estado de React.
- **No encolar un `pendingOp` sin también aplicar el cambio a localDb inmediatamente** — el usuario debe ver el cambio al instante.

## Manejo de errores y traducción

Todo error que vea el usuario pasa por `src/lib/api/translate.ts`.
NUNCA mostrar `error.message` crudo: viene en inglés del backend.

### Precedencia del lookup

1. `problem.code` (estable, lo emite el backend; catálogo en
   `backend/src/utils/exceptions/error-codes.ts`).
2. `(endpoint, status)` — fallback cuando el backend no envía code.
3. `status` HTTP — fallback genérico.
4. Mensaje genérico "Ocurrió un error inesperado.".

### Uso desde una feature

```tsx
import { useToast } from '../../lib/notifications/ToastProvider';
import { translateApiError } from '../../lib/api/translate';

const { showToast } = useToast();

try {
  await callApi();
} catch (error) {
  showToast({
    message: translateApiError(error, { endpoint: 'auth.login' }),
    kind: 'error',
  });
}
```

### Errores inline de campos

- El backend devuelve `ValidationFieldErrorDto[]`, usando en `code` el nombre
  del constraint de class-validator.
- Usar `translateValidationCode(field, code)` para mostrar el texto en español.
- Validar localmente antes del submit en `src/features/<feature>/validation.ts`.

### Agregar un caso nuevo

1. Coordinar con backend para que emita el code apropiado del catálogo (o
   agregue uno nuevo si no existe en `error-codes.ts`).
2. `bun run sync-types` para refrescar `src/generated/api-types.ts`.
3. Agregar la entrada a `CODE_MESSAGES` en `src/lib/api/translate.ts` (sincronizar
   con `front-web` y `front-mobile`).

### Anti-patrones

- No hacer string matching de `error.message` ni de `problem.detail`.
- No mostrar texto del backend tal cual (está en inglés).
- No duplicar mapeos por status en cada feature: que vivan en `translate.ts`.

## Estilo compartido (obligatorio)

- Seguir [SHARED_STYLE_GUIDE.md](./SHARED_STYLE_GUIDE.md) para colores, formas, espaciados y jerarquía visual.
- En pantallas de login: usar botones OAuth con ícono de proveedor y sin texto técnico de debug.
- No introducir variantes visuales fuera de la guía sin actualizar el documento en los 3 repos.
