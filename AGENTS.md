# AGENTS — front-desktop

## Mision

Desarrollar frontend desktop manteniendo separacion estricta entre Electron (sistema) y Renderer (UI).

## Stack y limites

- Electron (main + preload) + React/Vite renderer.
- TypeScript en ambas capas.
- Cliente Auth/API: Supabase JS.
- Tipos HTTP: `src/generated/api-types.ts` (OpenAPI).
- Este repo NO gestiona DB/migraciones/seeds.

## Reglas obligatorias

1. No editar `src/generated/api-types.ts` manualmente.
2. No crear DTOs/tipos HTTP manuales si existen en OpenAPI.
3. `electron/main.ts`: ciclo de vida, ventanas, integracion OS.
4. `electron/preload.ts`: unico puente permitido hacia renderer.
5. `src/`: UI y logica de producto; no acceso directo a Node/Electron.
6. Mantener dev renderer en `5174` para no chocar con `front-web` (`5173`).

## Seguridad Electron (mandatorio)

- Exponer al renderer solo APIs minimas via `contextBridge`.
- No habilitar `nodeIntegration` en renderer salvo justificacion explicita.
- No pasar objetos sensibles completos por IPC si no es necesario.

## Politica de contratos API

- Fuente por defecto: `OPENAPI_URL=http://localhost:3000/api-json`.
- Generar: `make sync-types` (requiere backend corriendo). Commitear `src/generated/api-types.ts`.
- Tipos manuales permitidos solo para estado/view-model interno.

## Servicio LPR (`services/lpr/`)

Microservicio Python (FastAPI) de reconocimiento de patentes que corre **local**
junto a la app. Electron lo levanta como binario standalone al iniciar.

- Stack: `fast-alpr` (ONNX, **sin PyTorch**) = detector YOLO-v9 (`open-image-models`)
  - OCR CCT (`fast-plate-ocr`). Optimizado para **CPU**; **no se asume GPU**.
- OCR default: **`cct-s-v2-global-model`** (CCT global, cubre AR Mercosur `AB123CD`
  y viejo `ABC123`). Los modelos AR-específicos (`argentinian-plates-cnn-*`) están
  **deprecados** por upstream: más lentos y menos precisos. No volver a ellos sin
  benchmark que lo justifique (`LPR_OCR_MODEL=...` para probar).
- **Debe correr offline**: los modelos se descargan una sola vez (build/install) y
  se hornean en el binario; `recognizer._seed_offline_cache()` los restaura al
  arrancar. No introducir dependencias que requieran red en runtime.
- API: `GET /health`, `POST /process` (imagen base64 → `{plate, text, confidence, bbox}`)
  en `127.0.0.1:8765`.
- Reglas de trabajo: **siempre `make`** (`lpr-install`, `lpr-dev`, `lpr-up`/`lpr-down`,
  `lpr-test FILE=...`, `lpr-build`), nunca `pip`/`python` a mano. Config vía env vars,
  no hardcodear. Doc completa: [`services/lpr/README.md`](./services/lpr/README.md).

## Donde escribir codigo

- UI/features: `src/features/<feature>/`.
- Integracion supabase compartida: `src/lib/supabase/`.
- Electron main/preload: `electron/`.
- Tests: `src/test/` o colocalizados.

## Flujo de trabajo recomendado

```bash
cp .env.example .env
make install
make env-check
make sync-types
make dev
```

## Checklist antes de PR

```bash
make lint
make typecheck
make test
make build
```

## Anti-patrones

- No mezclar codigo de Electron dentro de componentes React.
- No saltear preload y hablar directo con `ipcRenderer` desde cualquier modulo.
- No cambiar puertos de dev sin actualizar scripts relacionados (`wait-on`, `VITE_DEV_SERVER_URL`).

## Manejo de errores y traduccion

Todo error que vea el usuario pasa por `src/lib/api/translate.ts`.
NUNCA mostrar `error.message` crudo: viene en ingles del backend.

### Precedencia del lookup

1. `problem.code` (estable, lo emite el backend; catalogo en
   `backend/src/utils/exceptions/error-codes.ts`).
2. `(endpoint, status)` — fallback cuando el backend no envia code.
3. `status` HTTP — fallback generico.
4. Mensaje generico "Ocurrió un error inesperado.".

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

### Inline field errors (debajo del input)

- El backend devuelve `ValidationFieldErrorDto[]` con `code` = nombre del
  constraint de class-validator (`isEmail`, `minLength`, etc.).
- Usar `translateValidationCode(field, code)` para el texto en español. Permite
  override por `(field, code)` para mensajes mas naturales (ej.
  `password:minLength` -> "La contraseña debe tener al menos 8 caracteres").
- Validacion local antes de submit en `src/features/<feature>/validation.ts`.

### Agregar un caso nuevo

1. Coordinar con backend para que emita el code apropiado del catalogo (o
   agregue uno nuevo si no existe en `error-codes.ts`).
2. `make sync-types` para refrescar `src/generated/api-types.ts`.
3. Agregar la entrada a `CODE_MESSAGES` en `src/lib/api/translate.ts` (sincronizar
   con `front-web` y `front-mobile`).

### Anti-patrones

- No hacer string matching de `error.message` ni de `problem.detail`.
- No mostrar texto del backend tal cual (esta en ingles).
- No duplicar mapeos por status en cada feature: que vivan en `translate.ts`.
- No olvidar el toast envolvente: validar cliente-side primero, luego confiar
  en el `code` del backend para inline.

## Estilo compartido (obligatorio)

- Seguir [SHARED_STYLE_GUIDE.md](./SHARED_STYLE_GUIDE.md) para colores, formas, espaciados y jerarquia visual.
- En pantallas de login: usar botones OAuth con icono de proveedor y sin texto tecnico de debug.
- No introducir variantes visuales fuera de la guia sin actualizar el documento en los 3 repos.
