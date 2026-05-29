SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

CYAN  := \033[36m
RESET := \033[0m

VENV   := .venv
PYTHON := $(VENV)/bin/python
PIP    := $(VENV)/bin/pip

.PHONY: help lpr-install lpr-download-models lpr-dev lpr-build clean

help: ## Mostrar comandos disponibles
	@awk 'BEGIN {FS = ":.*?## "} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Dependencies ─────────────────────────────────────────────────────────────

$(VENV)/bin/activate: requirements.txt
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	@touch $(VENV)/bin/activate

lpr-install: $(VENV)/bin/activate ## Crear venv e instalar dependencias Python

# ── Model download ────────────────────────────────────────────────────────────

lpr-download-models: lpr-install ## Descargar pesos YOLO y modelos EasyOCR a models/
	@echo "→ Descargando detector YOLO..."
	@$(PYTHON) -c "from detector import PlateDetector; PlateDetector()"
	@echo "→ Descargando modelos EasyOCR..."
	@$(PYTHON) -c "from ocr import _get_reader; _get_reader()"
	@echo "✓ Modelos listos en models/"

# ── Development ───────────────────────────────────────────────────────────────

lpr-dev: lpr-install ## Levantar el servicio en modo desarrollo (puerto 8765)
	@$(PYTHON) main.py

# ── Build ─────────────────────────────────────────────────────────────────────

lpr-build: lpr-download-models ## Empaquetar el servicio con PyInstaller → dist/lpr-service
	@$(PYTHON) -m PyInstaller build.spec --distpath dist --workpath .build --noconfirm
	@echo "✓ Binario generado en dist/lpr-service"

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean: ## Eliminar artefactos de build y venv
	@rm -rf .build dist __pycache__ $(VENV)
	@echo "✓ Limpieza completa"