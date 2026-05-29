# LPR Service — Microservicio de reconocimiento de patentes

Microservicio Python que detecta la patente de un automóvil en una imagen y extrae
el texto mediante OCR. Se empaqueta como un binario standalone (PyInstaller) que el
proceso principal de Electron levanta automáticamente al iniciar la aplicación.

---

## Archivos

| Archivo | Descripción |
|---|---|
| `main.py` | Punto de entrada FastAPI. Define los endpoints `/health` y `/process`, gestiona el ciclo de vida del detector y arranca Uvicorn. |
| `detector.py` | Wrapper de YOLOv8 (`ultralytics`). Descarga el modelo de HuggingFace en el primer arranque y lo guarda en `models/plate_detector.pt`. Devuelve recortes de patente ordenados por confianza. |
| `ocr.py` | Wrapper de EasyOCR. Extrae el texto del recorte de patente, normaliza el resultado y aplica un factor de confianza según si el texto coincide con un formato de patente argentina válido. |
| `requirements.txt` | Dependencias Python con versiones fijadas (FastAPI, Uvicorn, ultralytics, EasyOCR, OpenCV headless, PyInstaller). |
| `build.spec` | Spec de PyInstaller. Empaqueta el código, los modelos (`models/`) y los imports ocultos de `ultralytics` y `easyocr` en un único binario `dist/lpr-service`. |
| `Makefile` | Targets de desarrollo y build (ver sección Comandos). |

---

## Endpoints

### `GET /health`

Indica que el servicio está corriendo. Electron lo sondea al iniciar la app para
verificar disponibilidad antes de habilitar la UI.

```json
{ "status": "ok" }
```

### `POST /process`

Recibe una imagen en base64 y devuelve la patente detectada.

**Request**
```json
{ "image": "<base64 JPG o PNG>" }
```

**Response 200**
```json
{
  "plate": "AB 123 CD",
  "text": "AB123CD",
  "confidence": 0.87
}
```

| Campo | Descripción |
|---|---|
| `plate` | Patente formateada con espacios canónicos. |
| `text` | Texto normalizado (sin espacios, en mayúsculas). |
| `confidence` | Score compuesto `[0, 1]`: confianza del detector × confianza del OCR × factor de formato. |

**Errores**
| Status | Detalle |
|---|---|
| `422` | Imagen inválida o no decodificable. |
| `404` | No se detectó ninguna patente, o no se pudo extraer texto. |

---

## Formatos de patente soportados

| Formato | Ejemplo | Patrón |
|---|---|---|
| Antiguo (pre-2016) | `ABC 123` | 3 letras + 3 dígitos |
| Mercosur (2016+) | `AB 123 CD` | 2 letras + 3 dígitos + 2 letras |

Cuando el texto extraído coincide con alguno de estos formatos, la confianza recibe un
**bonus del 15 %**. Si no coincide, recibe una **penalización del 30 %**.

---

## Confianza compuesta

```
confidence = detection_conf × ocr_conf × format_factor
```

- `detection_conf`: score del bounding-box de YOLO `[0, 1]`.
- `ocr_conf`: promedio de confianza por caracter de EasyOCR `[0, 1]`.
- `format_factor`: `1.15` si coincide con formato argentino, `0.70` en caso contrario.

---

## Comandos

### Instalación

```bash
cd services/lpr
make lpr-install
```

Crea un virtualenv en `.venv/` e instala todas las dependencias.

### Descarga de modelos

```bash
make lpr-download-models
```

Descarga los pesos del detector YOLO (`models/plate_detector.pt`, ~6 MB) y los modelos
de EasyOCR (`models/easyocr/`, ~100 MB). Requiere internet **una sola vez**; los
subsiguientes arranques son completamente offline.

### Desarrollo

```bash
make lpr-dev
```

Levanta el servicio en `http://127.0.0.1:8765`. El puerto se puede sobreescribir
pasándolo como primer argumento: `python main.py 9000`.

### Build de distribución

```bash
make lpr-build
```

Ejecuta PyInstaller con `build.spec` y genera `dist/lpr-service` (o
`dist/lpr-service.exe` en Windows). El binario incluye Python runtime, pesos YOLO y
modelos EasyOCR — no requiere Python instalado en la máquina del usuario final.

---

## Smoke test rápido

Con el servicio corriendo (`make lpr-dev`):

```bash
# 1. Health check
curl http://localhost:8765/health
# → {"status":"ok"}

# 2. Procesar una imagen
IMAGE=$(base64 -w0 /ruta/a/patente.jpg)
curl -s -X POST http://localhost:8765/process \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"$IMAGE\"}" | python3 -m json.tool
# → { "plate": "AB 123 CD", "text": "AB123CD", "confidence": 0.87 }
```

> **Tip:** En Windows (PowerShell):
> ```powershell
> $image = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\patente.jpg"))
> Invoke-RestMethod -Method POST -Uri http://localhost:8765/process `
>   -ContentType "application/json" `
>   -Body "{`"image`":`"$image`"}"
> ```

---

## Notas de empaquetado (PyInstaller)

- El `build.spec` genera un **único archivo ejecutable** (`onefile`). Electron copia
  este binario a `extraResources/lpr-service` durante el build de distribución.
- Los modelos en `models/` **deben existir antes de correr `make lpr-build`** (correr
  `make lpr-download-models` primero).
- El binario resuelve los modelos via `sys._MEIPASS` cuando corre empaquetado, y via
  `Path(__file__).parent` cuando corre desde fuente.
- Para reducir el tamaño del binario se excluyen `tkinter`, `matplotlib`, `scipy` y
  `pandas` del bundle.