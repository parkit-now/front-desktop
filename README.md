# front-desktop

Frontend desktop de Parkit (Electron + Vite + React).

## Stack

- Electron (main/preload)
- React + Vite (renderer)
- Bun
- ESLint + Prettier
- Supabase JS
- Tipos de API generados desde OpenAPI

## Primera ejecución

```bash
cp .env.example .env
make install
make env-check
make sync-types
make dev
```

Nota: `make sync-types` requiere backend corriendo y `OPENAPI_URL` accesible (default `http://localhost:3000/api-json`).

## Puertos de desarrollo

- `front-web`: `5173`
- `front-desktop` renderer: `5174`

Esta separación evita conflictos cuando corrés web y desktop al mismo tiempo.

## Estructura de carpetas

- `electron/main.ts`: proceso principal (ventanas, ciclo de vida).
- `electron/preload.ts`: bridge seguro hacia renderer.
- `src/`: app React (renderer).
- `src/lib/supabase/`: cliente/auth helpers.
- `src/generated/api-types.ts`: tipos API autogenerados.
- `src/test/`: tests unitarios.

## Contratos API automáticos ("DTOs" en front)

No usar DTOs manuales para requests/responses si el backend ya los expone en OpenAPI.

```bash
make sync-types
```

Regla: `src/generated/api-types.ts` siempre se regenera; no se edita a mano.

Si el backend usa otro puerto:

```bash
OPENAPI_URL=http://localhost:3001/api-json make sync-types
```

## Flujo para una feature nueva

1. Si afecta UI: trabajar en `src/features/<feature>/`.
2. Si afecta integración con sistema (ventanas, IPC): `electron/` + preload.
3. Tipar llamadas API con `src/generated/api-types.ts`.

## Linux (Electron sandbox)

Si Electron falla con `chrome-sandbox ... not configured correctly`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Servicios locales (camera + LPR)

En desarrollo los servicios Python se levantan manualmente en terminales separadas:

```bash
# Terminal 1 — LPR service (inferencia ONNX, puerto 8765)
cd services/lpr
make lpr-install          # solo la primera vez
make lpr-download-models  # solo la primera vez (descarga ~12 MB de modelos)
make lpr-dev

# Terminal 2 — Camera service (captura, storage, watchdog, puerto 8766)
cd services/camera
make camera-install       # solo la primera vez
make camera-dev
```

Electron **siempre** supervisa los sidecars con el mismo `ServiceManager`
(health check + retry + shutdown cooperativo). Lo único que cambia por entorno
es *qué ejecutable* arranca, resuelto por `electron/serviceRuntime.ts` en este
orden:

| Situación | De dónde sale el binario |
| --- | --- |
| `PARKIT_MANAGE_SERVICES=0` | Electron no gestiona nada (los corre otro) |
| `PARKIT_LPR_CMD` / `PARKIT_CAMERA_CMD` | comando explícito |
| App empaquetada | binario en `process.resourcesPath` |
| Sin empaquetar (`make prod`) | venv `python main.py` desde fuente |
| Sin empaquetar, sin venv | `services/<svc>/dist/<name>` compilado |

`app.isPackaged` solo elige el default de las últimas dos filas; no decide si
hay supervisión. Así `make prod`, la app empaquetada y `make dev` comparten el
mismo camino de código. Sin empaquetar se prefiere la fuente (es la fuente de
verdad de un working tree; el binario de `dist/` se recompila a mano y se
queda viejo). Para probar el binario compilado sin empaquetar, forzalo con
`PARKIT_LPR_CMD` / `PARKIT_CAMERA_CMD`; la paridad real con producción sale de
un bundle de verdad (`make dist-mac`).

`make dev` es la excepción deliberada: corre los servicios Python con
hot-reload y setea `PARKIT_MANAGE_SERVICES=0` para que Electron no los duplique.
Ver `PARKIT_*` en [`.env.example`](./.env.example).

## Empaquetado / Distribución

Flujo completo para generar el instalador:

```bash
# 1. Compilar los binarios Python (una vez por plataforma)
cd services/lpr    && make lpr-build    && cd ../..
cd services/camera && make camera-build && cd ../..

# 2. Empaquetar la app Electron
bun run pack   # app sin installer → dist-electron/<Parkit>-unpacked/  (rápido, para probar)
bun run dist   # instalador completo → dist-electron/*.dmg / *.exe / *.AppImage
```

> `prepack` y `predist` ejecutan `scripts/check-services.mjs` automáticamente.
> Si los binarios Python no existen, el comando falla con un mensaje claro
> antes de que electron-builder arranque.

### Build multiplataforma (mac / win / linux)

**No se puede generar el `.exe` de Windows (ni el `.AppImage` de Linux) desde
macOS.** Los binarios de `lpr-service`/`camera-service` se compilan con
PyInstaller, que empaqueta binarios nativos y no cross-compila — el `.exe`
solo sale corriendo en Windows, el `.dmg` solo corriendo en macOS, etc. Por
eso cada teammate empaqueta en su propio SO, usando el target explícito:

```bash
make dist-mac     # o: bun run dist:mac    — corre en macOS   → .dmg
make dist-win     # o: bun run dist:win    — corre en Windows → .exe (nsis)
make dist-linux   # o: bun run dist:linux  — corre en Linux   → .AppImage
```

Cada uno de estos targets corre primero `make doctor` (preflight de entorno),
después compila los binarios Python nativos (`make services-build`) y por
último empaqueta con `electron-builder` solo para ese SO — no toca los otros
targets ni requiere binarios de los otros SO.

> **`make doctor`** (podés correrlo suelto) valida en ~1 s que estén `bun`,
> `node 22`, Python 3.12 con `venv`/`ensurepip`, `bash`, GNU make, y avisa de
> cosas no bloqueantes (`upx`, `.env`, VS Build Tools). Falla con un mensaje
> accionable en vez de reventar 10 min adentro del build. Si tu Python 3.12 no
> se llama `python3.12`, el preflight te dice el `PYTHON_BIN=...` a usar.

Prerrequisitos por SO:

| SO      | Necesita además de `bun`/`make`/Python 3.12                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS   | Xcode Command Line Tools (`xcode-select --install`)                                                                                            |
| Windows | GNU make (`choco install make`, o Git Bash/WSL) — no viene preinstalado. **Modo de desarrollador ON** (o correr el build como Administrador): electron-builder extrae `winCodeSign` con symlinks y Windows los bloquea sin ese permiso. |
| Linux   | `libarchive-tools` (o equivalente) para el target `AppImage`                                                                                   |

> Python **debe ser 3.12 exacto** (numpy 1.26.4 no publica wheels para otra minor; con 3.13+ pip cae a compilar desde source y falla). Si tu 3.12 no está como `python`, pasá `PYTHON_BIN` — p. ej. `make dist-win PYTHON_BIN="py -3.12"`. `make doctor` valida todo esto.

CI (`.github/workflows/build-desktop.yml`) corre esta misma matriz en runners
nativos de GitHub Actions (`macos-latest`/`windows-latest`/`ubuntu-latest`) en
cada tag `v*.*.*` o manualmente (`workflow_dispatch`), y sube los 3
instaladores como artifacts. Sirve para validar el build sin depender de que
alguien tenga las 3 máquinas — pero **no firma los binarios**: son válidos
para pruebas internas, no para distribuir a clientes todavía (falta
Authenticode en Windows y notarización de Apple en macOS; ver comentarios al
final del workflow).

Los binarios `lpr-service[.exe]` y `camera-service[.exe]` se copian desde
`services/*/dist/` a `resources/` dentro del bundle via `extraResources`.
Electron los lee desde `process.resourcesPath` al arrancar.

La base de datos SQLite y las imágenes se guardan en el directorio de datos
del usuario (no en el bundle, que puede ser read-only):

| SO      | Ruta userData                           |
| ------- | --------------------------------------- |
| macOS   | `~/Library/Application Support/Parkit/` |
| Windows | `%APPDATA%\Parkit\`                     |
| Linux   | `~/.config/Parkit/`                     |

## Cómo probar los cambios recientes

### P0-1 — Captura sobrevive arranque sin cámara

```bash
cd services/camera && make camera-dev
# Con la cámara desconectada:
#   log: camera_open_failed  → el servicio sigue corriendo (antes moría)
#   log: camera_down / camera_reconnect con backoff 1→2→4→8→30 s
# Conectar la cámara USB (o levantar el stream RTSP):
#   log: camera_opened / camera_recovered
curl http://localhost:8766/stream/status
# → {"camera":"ok","down_since":null,"reconnect_attempts":N}
```

### P0-2+P0-3 — Storage: imwrite validado y event_id persistido

```bash
# Con el servicio corriendo y una patente detectada:
sqlite3 services/camera/camera.db \
  "SELECT id, plate, confidence, event_id FROM captures ORDER BY timestamp DESC LIMIT 3;"
# event_id aparece como NULL hasta que el backend lo proporcione (columna lista).

# Para verificar que imwrite falla limpiamente (sin corromper la DB):
# apuntar CAMERA_IMAGES_DIR a un path sin permisos de escritura y observar
# el log  capture_save_failed  sin que se inserte la fila en SQLite.
```

### P1-1 — Binarios empaquetados con electron-builder

```bash
# Prerrequisito: tener los binarios Python compilados (ver arriba)
bun run pack
# Verificar que los binarios llegaron al bundle:
ls dist-electron/*/Parkit-linux-unpacked/resources/   # Linux
ls dist-electron/*/Parkit-mac-unpacked/Contents/Resources/  # macOS
# Debe aparecer: lpr-service  camera-service (+ lpr-service.exe en Windows)
```

### P1-2 — Paths writables en app empaquetada

```bash
bun run pack
# Ejecutar el binario generado en dist-electron/
# Al arrancar, Electron pasa al camera-service:
#   CAMERA_DB_PATH   → <userData>/camera.db
#   CAMERA_IMAGES_DIR → <userData>/images/
# Verificar tras detectar una patente:
# macOS: ls ~/Library/Application\ Support/Parkit/
# Linux: ls ~/.config/Parkit/
# → camera.db  images/
```

### P1-3 — Health IPC visible en devtools

> **Nota:** el health check y los eventos IPC solo se activan en la app
> **empaquetada** (`app.isPackaged === true`). En `make dev` el `ServiceManager`
> es un no-op y `getFailedServices()` devuelve siempre `[]`.

Para probar, usar la app empaquetada con un servicio faltante:

```bash
# 1. Compilar solo el camera-service (omitir lpr-build para simular binario faltante)
cd services/camera && make camera-build && cd ../..

# 2. Empaquetar (prepack detectará que falta lpr-service y abortará — correcto)
#    Para forzar el empaquetado sin el binario, comentar temporalmente prepack en package.json
bun run pack

# 3. Ejecutar el binario generado y abrir DevTools (Ctrl+Shift+I) → Console:
await window.parkitDesktop.getFailedServices()
# → ["lpr-service"]  ← timeout de 30 s al no encontrar /health en :8765
```

Para probar crashes post-arranque, escuchar el evento:

```javascript
// En DevTools → Console:
window.parkitDesktop.onServiceCrashed((name) => console.warn('crashed:', name));
// Luego matar el proceso manualmente: kill <pid del lpr-service>
// → crashed: lpr-service
```

## Checklist antes de PR

```bash
make lint
make typecheck
make test
make build
```

## Comandos diarios

```bash
make help
make dev
make sync-types
make lint
make typecheck
make test
make build
```

## Git/PR

- PR siempre a `main`.
- `develop` se usa para validación integrada.
- Conventional Commits.

Ver [CONTRIBUTING.md](./CONTRIBUTING.md).
