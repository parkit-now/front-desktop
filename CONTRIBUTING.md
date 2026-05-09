# Contributing

## Modelo de ramas

- `main`: producción
- `develop`: validación integrada
- Ramas de trabajo: `feat/*`, `fix/*`, `docs/*`, `chore/*`, `refactor/*`, `test/*`, `perf/*`

PRs siempre apuntan a `main`.

## Convención de ramas

`<tipo>/SCRUM-XXX-descripcion-kebab-case`

## Convención de commits

`<type>(scope): descripcion`

Ejemplos:

- `feat(auth): agregar login social`
- `fix(api): corregir manejo de refresh token`

## Checklist mínimo para merge

1. CI en verde.
2. Al menos 1 aprobación.
3. `make sync-types-check` pasando.
4. Sin cambios no relacionados.
