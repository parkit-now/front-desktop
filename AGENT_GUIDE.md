# AGENT GUIDE (IA) — front-desktop

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
- Generar: `make sync-types`.
- Verificar drift: `make sync-types-check`.
- Tipos manuales permitidos solo para estado/view-model interno.

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
make sync-types-check
```

## Anti-patrones

- No mezclar codigo de Electron dentro de componentes React.
- No saltear preload y hablar directo con `ipcRenderer` desde cualquier modulo.
- No cambiar puertos de dev sin actualizar scripts relacionados (`wait-on`, `VITE_DEV_SERVER_URL`).

## Estilo compartido (obligatorio)

- Seguir [SHARED_STYLE_GUIDE.md](./SHARED_STYLE_GUIDE.md) para colores, formas, espaciados y jerarquia visual.
- En pantallas de login: usar botones OAuth con icono de proveedor y sin texto tecnico de debug.
- No introducir variantes visuales fuera de la guia sin actualizar el documento en los 3 repos.
