SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

CYAN  := \033[36m
RESET := \033[0m

ENV_LOCAL := .env.local
ENV_PROD  := .env.production

.PHONY: help install install-all dev prod build lint typecheck test format \
        env-check env-use-local env-use-prod doctor \
        sync-types clean \
        services-build dist-mac dist-win dist-linux

help: ## Mostrar comandos disponibles
	@awk 'BEGIN {FS = ":.*?## "} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-16s$(RESET) %s\\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Instalar dependencias y activar pre-commit
	@command -v bun >/dev/null 2>&1 || { echo "✗ Falta bun"; exit 1; }
	@bun install
	@git config core.hooksPath .githooks
	@echo "✓ Dependencias instaladas + hook activado"

env-use-local: ## Activar entorno local (copia .env.local → .env)
	@if [ ! -f $(ENV_LOCAL) ]; then \
		echo "✗ Falta $(ENV_LOCAL). Copialo desde .env.example y completá los valores locales."; \
		exit 1; \
	fi
	@cp $(ENV_LOCAL) .env
	@echo "✓ .env apunta a entorno LOCAL ($(ENV_LOCAL))"

env-use-prod: ## Activar entorno produccion (copia .env.production → .env)
	@if [ ! -f $(ENV_PROD) ]; then \
		echo "✗ Falta $(ENV_PROD). Copialo desde .env.example y completá los valores de prod."; \
		exit 1; \
	fi
	@cp $(ENV_PROD) .env
	@echo "✓ .env apunta a entorno PRODUCCION ($(ENV_PROD))"

install-all: install ## Instalar dependencias de los 3 servicios (bun + camera + lpr)
	@$(MAKE) -C services/camera camera-install
	@$(MAKE) -C services/lpr lpr-install

dev: install-all sync-types env-use-local ## Instalar todo, sync tipos y levantar los 3 servicios juntos
	@echo "→ Levantando camera (:8766), lpr (:8765) y electron/vite (:5174)..."
	@$(MAKE) -C services/camera camera-dev & \
	$(MAKE) -C services/lpr lpr-dev & \
	bun run dev; \
	wait

prod: env-use-prod ## Build de prod + abrir la app empaquetada con Electron
	@bun run build
	@bunx electron dist/main/main.js

build: ## Build con el .env actual (sin tocar el entorno activo)
	@bun run build

lint: ## Ejecutar ESLint
	@bun run lint

typecheck: ## Ejecutar TypeScript sin emitir
	@bun run typecheck

test: ## Ejecutar tests
	@bun run test

format: ## Formatear archivos
	@bun run format

env-check: ## Validar variables mínimas del .env activo
	@if [ ! -f .env ]; then \
		echo "✗ Falta .env activo. Corré: make env-use-local  ó  make env-use-prod"; exit 1; fi
	@set -a; . ./.env; set +a; \
	if [ -z "$${VITE_SUPABASE_URL:-}" ] && [ -z "$${EXPO_PUBLIC_SUPABASE_URL:-}" ]; then \
		echo "✗ Falta URL de Supabase: VITE_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_URL"; exit 1; \
	fi; \
	if [ -z "$${VITE_SUPABASE_ANON_KEY:-}" ] && [ -z "$${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then \
		echo "✗ Falta ANON key: VITE_SUPABASE_ANON_KEY o EXPO_PUBLIC_SUPABASE_ANON_KEY"; exit 1; \
	fi; \
	if [ -z "$${VITE_API_URL:-}" ] && [ -z "$${EXPO_PUBLIC_API_URL:-}" ]; then \
		echo "✗ Falta URL del backend: VITE_API_URL o EXPO_PUBLIC_API_URL"; exit 1; \
	fi; \
	if [ -z "$${OPENAPI_URL:-}" ]; then \
		echo "⚠ OPENAPI_URL no seteada. Se usará http://localhost:3000/api-json"; \
	fi
	@echo "✓ .env validado"

sync-types: ## Generar tipos TypeScript desde OpenAPI
	@bun run sync-types

doctor: ## Preflight: valida que el entorno puede correr make dist-<os> (rápido, no buildea)
	@node scripts/check-build-env.mjs

services-build: ## Compilar binarios NATIVOS de lpr/camera para el SO actual (PyInstaller no cross-compila)
	@$(MAKE) -C services/lpr lpr-build
	@$(MAKE) -C services/camera camera-build

# CSC_IDENTITY_AUTO_DISCOVERY=false: mismo valor que usa CI. Todavía no hay
# certificados, así que evitamos que electron-builder intente descubrir/usar
# uno (los binarios quedan sin firmar, válidos para pruebas internas).
dist-mac: doctor services-build ## Empaquetar .dmg — solo funciona corriendo en macOS
	@CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:mac

dist-win: doctor services-build ## Empaquetar .exe (nsis) — solo funciona corriendo en Windows
	@CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:win

dist-linux: doctor services-build ## Empaquetar AppImage — solo funciona corriendo en Linux
	@CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:linux

clean: ## Limpiar artefactos locales
	@rm -rf dist dist-electron coverage .expo .vite
	@echo "✓ Limpieza completa"
