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
  PYTHON_BIN ?= python3
endif
PYTHON  := $(VENV_BIN)/python
# `python -m pip` (no el wrapper pip.exe): en Windows el wrapper no puede
# actualizarse a sí mismo con `pip install --upgrade pip`.
PIP     := $(PYTHON) -m pip
PORT    ?= 8765
PIDFILE := .lpr.pid
LOGFILE := .lpr.log

.PHONY: help lpr-install lpr-download-models lpr-dev lpr-up lpr-down lpr-logs lpr-test lpr-build clean

help: ## Mostrar comandos disponibles
	@awk 'BEGIN {FS = ":.*?## "} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Dependencies ─────────────────────────────────────────────────────────────

$(VENV_BIN)/activate: requirements.txt
	$(PYTHON_BIN) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	@touch $(VENV_BIN)/activate

lpr-install: $(VENV_BIN)/activate ## Crear venv e instalar dependencias Python

# ── Model download ────────────────────────────────────────────────────────────

lpr-download-models: lpr-install ## Descargar modelos ONNX (detector + OCR) a la cache de fast-alpr
	@echo "→ Descargando detector + OCR ONNX (fast-alpr)..."
	@$(PYTHON) -c "from recognizer import PlateRecognizer; PlateRecognizer()"
	@echo "✓ Modelos ONNX cacheados"

# ── Development ───────────────────────────────────────────────────────────────

lpr-dev: lpr-install ## Levantar el servicio en primer plano (logs en vivo, Ctrl+C para frenar)
	@$(PYTHON) main.py $(PORT)

lpr-up: lpr-install ## Levantar el servicio en background (PID en .lpr.pid)
	@if [ -f $(PIDFILE) ] && kill -0 "$$(cat $(PIDFILE))" 2>/dev/null; then \
		echo "✓ Ya está corriendo (PID $$(cat $(PIDFILE))) en :$(PORT)"; \
	else \
		nohup $(PYTHON) main.py $(PORT) > $(LOGFILE) 2>&1 < /dev/null & echo $$! > $(PIDFILE); \
		echo "→ Arrancando en :$(PORT) (PID $$(cat $(PIDFILE)))..."; \
		curl -s --retry 30 --retry-delay 1 --retry-all-errors --retry-connrefused http://127.0.0.1:$(PORT)/health >/dev/null \
			&& echo "✓ Listo en http://127.0.0.1:$(PORT) — logs: $(LOGFILE)" \
			|| { echo "✗ No respondió. Revisá $(LOGFILE)"; exit 1; }; \
	fi

lpr-down: ## Detener el servicio levantado con lpr-up
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
		echo "⚠ No hay $(PIDFILE). El servicio no fue levantado con lpr-up (o ya está detenido)."; \
	fi

lpr-logs: ## Ver los logs del servicio en background (tail -f)
	@test -f $(LOGFILE) || { echo "✗ No hay $(LOGFILE). Levantá el servicio con: make lpr-up"; exit 1; }
	@tail -f $(LOGFILE)

# ── Test ──────────────────────────────────────────────────────────────────────

lpr-test: ## Probar /process con una imagen: make lpr-test FILE=/ruta/abs/patente.jpg
	@test -n "$(FILE)" || { echo "✗ Falta FILE. Uso: make lpr-test FILE=/ruta/abs/patente.jpg"; exit 1; }
	@test -f "$(FILE)" || { echo "✗ No existe el archivo: $(FILE)"; exit 1; }
	@curl -sf http://127.0.0.1:$(PORT)/health >/dev/null \
		|| { echo "✗ El servicio no responde en :$(PORT). Levantalo con: make lpr-dev"; exit 1; }
	@$(PYTHON) -c "import base64, json, sys; print(json.dumps({'image': base64.b64encode(open(sys.argv[1], 'rb').read()).decode()}))" "$(FILE)" \
		| curl -s -X POST http://127.0.0.1:$(PORT)/process -H "Content-Type: application/json" -d @- \
		| $(PYTHON) -m json.tool

# ── Build ─────────────────────────────────────────────────────────────────────

lpr-build: lpr-download-models ## Empaquetar el servicio con PyInstaller → dist/lpr-service
	@$(PYTHON) -m PyInstaller build.spec --distpath dist --workpath .build --noconfirm
	@echo "✓ Binario generado en dist/lpr-service"

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean: ## Eliminar artefactos de build y venv
	@rm -rf .build dist __pycache__ $(VENV) $(PIDFILE) $(LOGFILE)
	@echo "✓ Limpieza completa"