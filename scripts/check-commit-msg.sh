#!/usr/bin/env bash
#
# Valida que un mensaje de commit sea Conventional Commits.
#
# POR QUÉ EXISTE
#
# La versión del desktop la calcula semantic-release a partir de los mensajes
# de commit (`@semantic-release/commit-analyzer`, preset angular). Su parser usa
# este patrón para la primera línea:
#
#     /^(\w*)(?:\((.*)\))?!?: (.*)$/
#
# Un mensaje que NO matchea no es "un commit sin tipo": es un commit que el
# analizador IGNORA POR COMPLETO. No rompe nada, no avisa, simplemente no cuenta
# para la versión.
#
# Ya nos costó una release: la v1.1.1 salió como PATCH aunque traía tres
# features (identidad visual, persistencia de filtros y tarifas de CABA). Los
# tres estaban escritos `feat (desktop): ...` con un espacio antes del
# paréntesis, y el patrón exige `feat(desktop): ...` sin espacio. Lo único que
# bumpeó la versión fue un `fix(release): ...` bien escrito. La v1.1.0, en
# cambio, sí fue MINOR porque su `feat(impresión): ...` iba sin espacio.
#
# USO
#
#   scripts/check-commit-msg.sh <archivo-con-el-mensaje>
#   scripts/check-commit-msg.sh --text "feat(algo): hace algo"

set -euo pipefail

# Tipos del preset angular. `feat` dispara MINOR, `fix` y `perf` disparan PATCH;
# el resto no cambia la versión pero sigue siendo un mensaje válido.
TYPES='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'

# Mismo patrón que usa el parser de semantic-release.
HEADER_RE="^(${TYPES})(\([^)]+\))?!?: .+"

if [[ "${1:-}" == "--text" ]]; then
  header="$(printf '%s' "${2:-}" | head -1)"
else
  msg_file="${1:-}"
  [[ -f "$msg_file" ]] || { echo "✗ Falta el archivo del mensaje de commit" >&2; exit 1; }
  # Ignora comentarios que git agrega al template.
  header="$(grep -v '^#' "$msg_file" | sed '/^[[:space:]]*$/d' | head -1)"
fi

# Commits que no los escribe una persona o que no participan del versionado.
case "$header" in
  Merge\ *|Revert\ *|fixup!*|squash!*|"chore(release):"*)
    exit 0
    ;;
esac

if [[ -z "$header" ]]; then
  echo "✗ El mensaje de commit está vacío." >&2
  exit 1
fi

if [[ "$header" =~ $HEADER_RE ]]; then
  exit 0
fi

# ── El mensaje no sirve: explicar exactamente qué está mal ───────────────────
echo "" >&2
echo "✗ Mensaje de commit no válido para el versionado automático:" >&2
echo "" >&2
echo "    $header" >&2
echo "" >&2

# El error que ya nos costó una release: espacio entre el tipo y el scope.
if [[ "$header" =~ ^(${TYPES})[[:space:]]+\( ]]; then
  tipo="${BASH_REMATCH[1]}"
  sugerido="$(printf '%s' "$header" | sed -E "s/^(${TYPES})[[:space:]]+\(/\1(/")"
  echo "  El problema es el ESPACIO entre '$tipo' y el paréntesis." >&2
  echo "  semantic-release ignora el commit entero y no cuenta para la versión." >&2
  echo "" >&2
  echo "  Escribilo así:" >&2
  echo "    $sugerido" >&2
# Tipo válido pero sin los dos puntos: "fix fav icon".
elif [[ "$header" =~ ^(${TYPES})[[:space:]] ]]; then
  tipo="${BASH_REMATCH[1]}"
  resto="$(printf '%s' "$header" | sed -E "s/^${tipo}[[:space:]]+//")"
  echo "  Falta el ':' después del tipo." >&2
  echo "" >&2
  echo "  Escribilo así:" >&2
  echo "    $tipo: $resto" >&2
else
  echo "  Formato: <tipo>(<alcance opcional>): <descripción>" >&2
  echo "  Tipos:   ${TYPES//|/, }" >&2
  echo "" >&2
  echo "  Ejemplos:" >&2
  echo "    feat(tarifas): agrega el tope de media estadía   → sube la MINOR" >&2
  echo "    fix(impresión): corrige el ancho del ticket      → sube la PATCH" >&2
  echo "    chore(deps): actualiza vitest                    → no cambia la versión" >&2
fi

echo "" >&2
exit 1
