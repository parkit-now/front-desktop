# CI Workflow

Pipeline único para PR y pushes a `develop/main`.

Orden estricto:

1. `lint`
2. `typecheck`
3. `test`
4. `build`

Generación de tipos OpenAPI (`make sync-types`) es local: requiere el backend corriendo en `OPENAPI_URL` (default `http://localhost:3000/api-json`). El archivo regenerado (`src/generated/api-types.ts`) se commitea.
