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

En producción Electron los levanta automáticamente como binarios empaquetados;
en dev el `ServiceManager` es un no-op (`app.isPackaged === false`).

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

Los binarios `lpr-service[.exe]` y `camera-service[.exe]` se copian desde
`services/*/dist/` a `resources/` dentro del bundle via `extraResources`.
Electron los lee desde `process.resourcesPath` al arrancar.

La base de datos SQLite y las imágenes se guardan en el directorio de datos
del usuario (no en el bundle, que puede ser read-only):

| SO      | Ruta userData                                           |
| ------- | ------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Parkit/`                 |
| Windows | `%APPDATA%\Parkit\`                                     |
| Linux   | `~/.config/Parkit/`                                     |

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

```bash
# Iniciar la app sin haber levantado el LPR service:
make dev
# En DevTools (Ctrl+Shift+I) → Console:
#   [services:failed] ["lpr-service"]  ← evento IPC enviado desde main

# Verificar también la API de consulta:
# En DevTools → Console:
await window.parkitDesktop.getFailedServices()
# → ["lpr-service"]  (o [] si todos están ok)
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
