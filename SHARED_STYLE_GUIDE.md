# SHARED STYLE GUIDE

Reglas visuales obligatorias para mantener consistencia entre `front-web`, `front-desktop` y `front-mobile`.

## Objetivo

Mantener una interfaz coherente en color, forma, espaciado y jerarquia visual entre plataformas.

## Tokens base

- Fondo app: `#eef4ff` -> `#f7faff` (gradiente o equivalente).
- Superficie principal (cards): `#ffffff`.
- Texto principal: `#101828`.
- Texto secundario: `#475467`.
- Borde neutro: `#d0d9e6`.
- Color marca: `#0e5fd8`.
- Estado error: texto `#b42318`, fondo `#fff1ef`, borde `#f6c7bf`.

## Forma y dimensiones

- Card principal auth: ancho maximo `460px` (o equivalente en mobile), radius `20px`, padding `24px`.
- Botones primarios/acciones: alto minimo `48px`, radius `14px`.
- Pill de usuario/sesion: radius `10px`.

## Espaciado

Escala base: `8, 12, 16, 24`.

- Entre logo y texto de marca: `16`.
- Entre titulo/subtitulo: `8`.
- Entre botones OAuth: `10-12`.
- Separacion vertical de bloques grandes: `16-24`.

## Tipografia

- Titulo marca (`Parkit`): 26 / 700.
- Encabezado de seccion (`Iniciar sesion`, `Welcome`): 20 / 700.
- Texto secundario: 14 / 400.
- Texto boton: 15 / 600.

## Pantalla de login

- Mostrar branding `Parkit` con badge de marca.
- Mostrar dos botones OAuth:
  - `Continuar con Google`
  - `Continuar con GitHub`
- Botones OAuth deben incluir icono del proveedor.
- No mostrar texto tecnico en la UI principal (por ejemplo: nombre del repo, variables env, debug interno).

## Pantalla autenticada

- Mostrar `Welcome`.
- Mostrar identificador del usuario (`email` o `id`) en una pill.
- Mostrar accion de `Cerrar sesion` con estilo consistente.

## Regla para agentes IA

1. Antes de proponer estilos nuevos, revisar este archivo.
2. No introducir nueva paleta ni nuevos radios sin actualizar este documento en los 3 repos.
3. Si una plataforma requiere excepcion tecnica, documentarla en el PR.
