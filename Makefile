SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

CYAN  := \033[36m
RESET := \033[0m

.PHONY: help install dev build lint typecheck test format env-check sync-types sync-types-check clean

help: ## Mostrar comandos disponibles
	@awk 'BEGIN {FS = ":.*?## "} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-16s$(RESET) %s\\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Instalar dependencias y activar pre-commit
	@command -v bun >/dev/null 2>&1 || { echo "✗ Falta bun"; exit 1; }
	@bun install
	@git config core.hooksPath .githooks
	@echo "✓ Dependencias instaladas + hook activado"

dev: ## Levantar app en modo desarrollo
	@bun run dev

build: ## Build de producción
	@bun run build

lint: ## Ejecutar ESLint
	@bun run lint

typecheck: ## Ejecutar TypeScript sin emitir
	@bun run typecheck

test: ## Ejecutar tests
	@bun run test

format: ## Formatear archivos
	@bun run format

env-check: ## Validar variables mínimas de Supabase
	@if [ ! -f .env ]; then \
		echo "✗ Falta .env (copiá .env.example)"; exit 1; fi
	@set -a; . ./.env; set +a; \
	if [ -z "$${VITE_SUPABASE_URL:-}" ] && [ -z "$${EXPO_PUBLIC_SUPABASE_URL:-}" ]; then \
		echo "✗ Falta URL de Supabase: VITE_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_URL"; exit 1; \
	fi; \
	if [ -z "$${VITE_SUPABASE_ANON_KEY:-}" ] && [ -z "$${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then \
		echo "✗ Falta ANON key: VITE_SUPABASE_ANON_KEY o EXPO_PUBLIC_SUPABASE_ANON_KEY"; exit 1; \
	fi; \
	if [ -z "$${OPENAPI_URL:-}" ]; then \
		echo "⚠ OPENAPI_URL no seteada. Se usará http://localhost:3000/api-json"; \
	fi
	@echo "✓ .env validado"

sync-types: ## Generar tipos TypeScript desde OpenAPI
	@bun run sync-types

sync-types-check: ## Verificar drift entre OpenAPI y src/generated/api-types.ts
	@bun run sync-types:check

clean: ## Limpiar artefactos locales
	@rm -rf dist dist-electron coverage .expo .vite
	@echo "✓ Limpieza completa"
