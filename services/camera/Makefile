SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

CYAN  := \033[36m
RESET := \033[0m

VENV    := .venv
ifeq ($(OS),Windows_NT)
  VENV_BIN   := $(VENV)/Scripts
  PYTHON_BIN ?= python
else
  VENV_BIN   := $(VENV)/bin
  PYTHON_BIN ?= python3.12
endif
PYTHON  := $(VENV_BIN)/python
# `python -m pip` (no el wrapper pip.exe): en Windows el wrapper no puede
# actualizarse a sí mismo con `pip install --upgrade pip`.
PIP     := $(PYTHON) -m pip
PORT    ?= 8766
PIDFILE := .camera.pid
LOGFILE := .camera.log

# macOS: OpenCV's AVFoundation backend requires this flag to skip the
# authorization dialog (which can't be shown from a background thread).
# On Linux the variable is ignored — V4L2 handles permissions via the
# video group, no env var needed.
UNAME := $(shell uname)
ifeq ($(UNAME), Darwin)
  OPENCV_ENV := OPENCV_AVFOUNDATION_SKIP_AUTH=1
else
  OPENCV_ENV :=
endif

.PHONY: help camera-install camera-dev camera-up camera-down camera-logs camera-test camera-build clean

help: ## Mostrar comandos disponibles
	@awk 'BEGIN {FS = ":.*?## "} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-24s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Dependencies ──────────────────────────────────────────────────────────────

$(VENV_BIN)/activate: requirements.txt
	$(PYTHON_BIN) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	@touch $(VENV_BIN)/activate

camera-install: $(VENV_BIN)/activate ## Crear venv e instalar dependencias Python

# ── Development ───────────────────────────────────────────────────────────────

camera-dev: camera-install ## Levantar el servicio en primer plano (logs en vivo, Ctrl+C para frenar)
	@$(OPENCV_ENV) $(PYTHON) main.py $(PORT)

camera-up: camera-install ## Levantar el servicio en background (PID en .camera.pid)
	@if [ -f $(PIDFILE) ] && kill -0 "$$(cat $(PIDFILE))" 2>/dev/null; then \
		echo "✓ Ya está corriendo (PID $$(cat $(PIDFILE))) en :$(PORT)"; \
	else \
		nohup $(OPENCV_ENV) $(PYTHON) main.py $(PORT) > $(LOGFILE) 2>&1 < /dev/null & echo $$! > $(PIDFILE); \
		echo "→ Arrancando en :$(PORT) (PID $$(cat $(PIDFILE)))..."; \
		curl -s --retry 30 --retry-delay 1 --retry-all-errors --retry-connrefused http://127.0.0.1:$(PORT)/health >/dev/null \
			&& echo "✓ Listo en http://127.0.0.1:$(PORT) — logs: $(LOGFILE)" \
			|| { echo "✗ No respondió. Revisá $(LOGFILE)"; exit 1; }; \
	fi

camera-down: ## Detener el servicio levantado con camera-up
	@if [ -f $(PIDFILE) ]; then \
		PID=$$(cat $(PIDFILE)); \
		if kill "$$PID" 2>/dev/null; then \
			timeout 5 tail --pid="$$PID" -f /dev/null 2>/dev/null || true; \
			echo "✓ Servicio detenido (PID $$PID)"; \
		else \
			echo "⚠ El proceso (PID $$PID) ya no estaba vivo"; \
		fi; \
		rm -f $(PIDFILE); \
	else \
		echo "⚠ No hay $(PIDFILE). El servicio no fue levantado con camera-up (o ya está detenido)."; \
	fi

camera-logs: ## Ver los logs del servicio en background (tail -f)
	@test -f $(LOGFILE) || { echo "✗ No hay $(LOGFILE). Levantá el servicio con: make camera-up"; exit 1; }
	@tail -f $(LOGFILE)

# ── Test ──────────────────────────────────────────────────────────────────────

camera-test: ## Verificar /health y /stream/status: make camera-test
	@curl -sf http://127.0.0.1:$(PORT)/health >/dev/null \
		|| { echo "✗ El servicio no responde en :$(PORT). Levantalo con: make camera-dev"; exit 1; }
	@curl -s http://127.0.0.1:$(PORT)/stream/status | $(PYTHON) -m json.tool

# ── Build ─────────────────────────────────────────────────────────────────────

camera-build: camera-install ## Empaquetar el servicio con PyInstaller → dist/camera-service
	@$(PYTHON) -m PyInstaller build.spec --distpath dist --workpath .build --noconfirm
	@echo "✓ Binario generado en dist/camera-service"

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean: ## Eliminar artefactos de build y venv
	@rm -rf .build dist __pycache__ $(VENV) $(PIDFILE) $(LOGFILE)
	@echo "✓ Limpieza completa"
