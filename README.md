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
