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
  await enqueuePendingOp({ entityType, operation, tenantId, entityId, payload, status: 'pending' });
}
```

**Encolar SIEMPRE con `enqueuePendingOp`** (`src/lib/sync/enqueue.ts`), nunca con
`localDb.pendingOps.add` directo: el helper completa `userId`, `createdAt` y
`retryCount`. Sin `userId` no se puede saber de qué turno salió una operación, y
en una playa con cambio de operador y arqueo de caja eso importa.

### Excepción deliberada: cerrar caja exige conexión

Todo el panel opera sin red MENOS el cierre de turno, y es a propósito, no un
pendiente.

Al cerrar, el servidor hace tres cosas en una transacción: cierra el turno, abre
el siguiente y **renumera los tickets** de los autos que siguen adentro.
Replicar esa renumeración offline crea dos fuentes de verdad para un número que
el conductor tiene impreso en la mano, y que el operador tipea en la barrera
para cobrar (`ExitControls`). Si al sincronizar el servidor recalcula distinto,
el auto queda con un ticket que no coincide con su papel.

Se evaluó mandarle al servidor los tickets ya asignados por el cliente para que
los respete. Funciona, pero arrastra casos borde caros — entries que el cliente
no vio porque estaban offline, colisiones entre el número del cliente y el
fallback del servidor — que no se justifican para el MVP.

Por eso el botón **queda habilitado y avisa por toast al tocarlo**
(`CashSessionPanel.tsx`). No se deshabilita a propósito: un botón gris no
explica nada, y encima no es focusable ni lo anuncian los lectores de pantalla.
Lo que importa es cortar en el click y no en el submit — antes el diálogo abría
igual, el operador hacía todo el arqueo, escribía las notas y recién al final
se comía un error.

Si esto se retoma, lo que hay que resolver primero es de quién es la autoridad
sobre el `ticketNumber`.

### Infraestructura de sync

| Archivo                               | Rol                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/db/localDb.ts`               | Definición Dexie — tablas, índices, tipos locales                                 |
| `src/lib/network/NetworkContext.tsx`  | `useNetwork()` — `navigator.onLine` **+ health-check contra `GET /health`**       |
| `src/lib/sync/enqueue.ts`             | `enqueuePendingOp()` — única puerta de entrada a la cola                          |
| `src/lib/sync/retryPolicy.ts`         | `classifyPushFailure()` — qué hacer con una op cuyo push falló                    |
| `src/lib/sync/SyncService.ts`         | Singleton — `pullRates()`, `pullEntries()`, `pushPendingOps()`, `fullSync()`      |
| `src/lib/sync/SyncContext.tsx`        | `useSync()` — `pendingCount`, `blockedCount`, `otherOperatorCount`, `triggerSync` |
| `src/features/sync/SyncButton.tsx`    | Botón en sidebar con badge de ops sin sincronizar                                 |
| `src/features/sync/OfflineBanner.tsx` | Banner amarillo cuando `isOnline === false`                                       |

### Detección de conectividad

`navigator.onLine` sola NO alcanza: en Chromium dice si hay una interfaz de red
levantada, no si el backend contesta. Con el router prendido y sin internet —
el escenario típico de un estacionamiento con Wi-Fi flojo — devuelve `true`,
las escrituras toman la rama online, fallan, y **no se encolan**.

`NetworkContext` compone el estado real: `isOnline = networkUp && backendReachable`,
con un probe a `GET /health` (timeout 5 s; cada 30 s si contesta, cada 10 s si
no). Expone `networkUp` y `backendReachable` por separado para poder decirle al
operador si el problema es su Wi-Fi o el servidor.

### Estados de `pendingOps`

| Estado       | Significado                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `unreviewed` | Detección LPR que el operador no resolvió todavía. Se pushea igual         |
| `pending`    | Esperando push. Con `nextAttemptAt` si viene de un fallo reintentable      |
| `in-flight`  | Push en curso. Si queda así, `recoverStalledOps()` la devuelve a `pending` |
| `conflict`   | 409: el servidor tiene algo más nuevo. Necesita a una persona              |
| `failed`     | Payload inválido o presupuesto de reintentos agotado. Terminal             |

**`failed` era el destino de CUALQUIER error** y `pushPendingOps` nunca lo volvía
a mirar. Al reconectar, el sync salía con el access token vencido y toda la cola
del corte se enterraba de una. Si tocás el manejo de errores del push, la regla
es: solo va a `failed` lo que reintentar no puede arreglar.

### Protección de sesión offline

**El primer login SIEMPRE requiere conexión — no hay login offline.** Pero una
vez que el operador se autenticó en este equipo, un access token vencido es un
problema de transporte, no de autenticación: no puede frenarlo de cobrarle a un
auto que está físicamente en la barrera. El token es una credencial de red; la
sesión es un hecho del negocio.

Dos mecanismos, uno por camino:

1. **App ya abierta** — `App.tsx` intercepta `onSessionChange` y no cierra sesión
   si `!navigator.onLine`.
2. **Arranque en frío** — `restoreSession()` (`src/lib/supabase/session.ts`), NO
   `getSession()`. `supabase.auth.getSession()` devuelve `null` cuando el refresh
   falla, **incluso si falla solo por falta de red**, aunque los tokens sigan
   intactos en storage (supabase-js solo los borra ante errores no reintentables).
   Confiar en ese `null` deja al operador en una pantalla de login que sin
   conexión no puede usar: la app queda inservible una hora después del corte,
   con solo reiniciarla.

La recuperación al volver la red no necesita nada extra: el ticker de
auto-refresh de supabase-js relee la sesión del storage cada 30 s y emite
`TOKEN_REFRESHED`.

**Ventana de gracia:** 7 días desde el último login o refresh exitoso, sellados en
`parkit.desktop.lastOnlineAuthAt`. La política vive en `judgeCachedSession()`,
pura y testeada. Vencida, se limpian las credenciales y se pide login real: el
tope acota el riesgo de un equipo robado o un operador desvinculado.

**`AUTH_STORAGE_KEY`** (`src/lib/supabase/client.ts`) se fija explícitamente para
poder leer la sesión del storage sin depender de la clave que supabase-js deriva
del hostname (distinta en dev y en prod). Hay una migración one-shot desde la
clave derivada: si se saca, los equipos ya instalados se deslogean al actualizar.

### Tablas locales (Dexie)

- **`rates`**: `id, tenantId, name, hourPriceArs, stayPriceArs, fractionPriceArs, isActive, version, syncSeq, createdAt, updatedAt` (precios como `string` para evitar pérdida de precisión)
- **`entries`**: `id, tenantId, plate, color?, enteredAt, leftAt?, amountPaid?, vehicleId, rateId?, snapshot fields..., version, syncSeq, updatedAt`
- **`vehicles`**: `id, brand, model, type?`
- **`paymentMethods`**: `id, tenantId, type, name, enabled, isDefault`
- **`syncState`**: `key` = `"rates:{tenantId}"` / `"entries:{tenantId}"`, `lastSeq`, `lastSyncAt`
- **`pendingOps`**: operaciones encoladas mientras offline — `localId (++autoincrement), entityType, operation, tenantId, entityId, payload, status, createdAt, retryCount, error?, userId?, nextAttemptAt?`

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
make install   # dependencias + activa los hooks de .githooks/
bun run dev
```

> Los dos activan los hooks: `make install` y `bun install` (`bun install` lo hace
> por el script `prepare` del `package.json`). Los hooks viven en `.githooks/`,
> que se versiona, pero git no los usa hasta que el clon tiene
> `core.hooksPath` apuntado ahí — y esa config es local, no viaja en el repo.
> Por eso lo setea el instalador y no hace falta que cada uno lo corra a mano.

Para sincronizar tipos desde el backend (requiere backend corriendo en :3000):

```bash
bun run sync-types
```

## Commits y versionado (obligatorio)

La versión del desktop y los instaladores los genera semantic-release al pushear
a `main`, y la calcula **leyendo los mensajes de commit**. Conventional Commits
no es una preferencia de estilo acá: es la entrada del release.

```
<tipo>(<alcance opcional>): <descripción>
```

| Tipo          | Efecto en la versión  |
| ------------- | --------------------- |
| `feat`        | MINOR (1.1.0 → 1.2.0) |
| `fix`, `perf` | PATCH (1.1.0 → 1.1.1) |
| el resto      | ninguno               |

**El error que ya nos costó una release**: un mensaje que no matchea el patrón
no es "un commit sin tipo", es un commit que el analizador **ignora por
completo**, sin avisar. La v1.1.1 salió como PATCH aunque traía tres features
porque estaban escritas `feat (desktop): ...` — con un espacio antes del
paréntesis. Va `feat(desktop): ...`, pegado.

Lo valida el hook `commit-msg` y el job `Commit messages` del CI (que corre
sobre los commits del PR, así que `--no-verify` no alcanza para saltearlo). El
hook se activa solo al instalar (ver _Flujo de trabajo recomendado_).

Corolario: si una release "no sale", el problema son los mensajes. **No** crear
un commit vacío ni un archivo trigger para forzarla — así aparecieron
`.release-trigger` y `.trigger-release` en `main`.

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
- **No usar `localDb.pendingOps.add` directo** — usar `enqueuePendingOp()`, o la op queda sin autor.
- **No mandar todo a `failed` en el catch de un push** — es terminal; ver la tabla de estados.
- **No usar `getSession()` para decidir si hay sesión al arrancar** — usar `restoreSession()`.

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
