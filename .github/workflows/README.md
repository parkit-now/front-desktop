# CI Workflow

Pipeline único para PR y pushes a `develop/main`.

Orden estricto:

1. `lint`
2. `typecheck`
3. `test`
4. `build`
5. `sync-types-check`

`sync-types-check` corre contra `openapi/openapi.snapshot.json` en CI.
En desarrollo diario podés usar `OPENAPI_URL=http://localhost:3000/api-json make sync-types`.
