# Camera Service — Microservicio de captura de patentes

Microservicio Python que captura frames de una cámara USB o IP (RTSP),
los envía al [LPR service](../lpr/README.md) para reconocer la patente,
persiste los resultados en disco y SQLite, y expone una API HTTP para
que la app Electron consulte el estado de la cámara y la última patente
detectada.

---

## Prerrequisitos del sistema

| Requisito       | Versión         | Notas                                                                         |
| --------------- | --------------- | ----------------------------------------------------------------------------- |
| **Python**      | 3.10 o superior | Probado con 3.12.                                                             |
| **pip + venv**  | —               | En Debian/Ubuntu: `sudo apt install python3-pip python3-venv`.                |
| **make**        | GNU Make 4.x    | Ver nota de Windows más abajo.                                                |
| **LPR service** | corriendo       | El camera-service le delega la inferencia. Puerto default: 8765.              |
| **macOS**       | cámara FaceTime | Requiere permiso en _System Settings → Privacy → Camera_ para el terminal.    |
| **Linux**       | V4L2            | El usuario debe pertenecer al grupo `video` (`sudo usermod -aG video $USER`). |

---

## Instalación y puesta en marcha

```bash
# 1. Instalar dependencias
make camera-install

# 2. Levantar el LPR service (en otra terminal)
cd ../lpr && make lpr-dev

# 3. Levantar el camera-service
make camera-dev        # primer plano — logs en vivo, Ctrl+C para frenar
# ó
make camera-up         # background — PID en .camera.pid
make camera-down       # detener
make camera-logs       # seguir logs
```

El servicio levanta en `http://127.0.0.1:8766`. Al arrancar abre la cámara,
inicia el watchdog y comienza a capturar.

---

## Probar que funciona

```bash
# Health check
curl http://localhost:8766/health
# → {"status":"ok"}

# Estado de la cámara
curl http://localhost:8766/stream/status
# → {"camera":"ok","down_since":null,"reconnect_attempts":0}

# Última patente detectada (404 si aún no hubo ninguna)
curl http://localhost:8766/detection/latest
# → {"capture_id":"uuid","plate":"AB 123 CD","text":"AB123CD",
#    "confidence":0.91,"location":"entrada","camera_id":"cam-01"}
```

---

## Empaquetar el binario de distribución

```bash
make camera-build
```

Genera `dist/camera-service` (o `.exe` en Windows) con el runtime de Python
y todas las dependencias adentro. Electron lo distribuye junto al
`lpr-service` como parte del instalador — el usuario final no necesita
Python ni ningún setup adicional.

---

## Comandos disponibles

| Comando               | Qué hace                                                  |
| --------------------- | --------------------------------------------------------- |
| `make help`           | Lista los targets disponibles.                            |
| `make camera-install` | Crea el venv e instala dependencias.                      |
| `make camera-dev`     | Levanta el servicio en primer plano (logs en vivo).       |
| `make camera-up`      | Levanta el servicio en background (PID en `.camera.pid`). |
| `make camera-down`    | Detiene el servicio levantado con `camera-up`.            |
| `make camera-logs`    | Sigue los logs del servicio en background (`tail -f`).    |
| `make camera-test`    | Verifica `/health` y `/stream/status`.                    |
| `make camera-build`   | Empaqueta el binario standalone con PyInstaller.          |
| `make clean`          | Borra `.venv`, `.build`, `dist` y `__pycache__`.          |

---

## Referencia técnica

### Arquitectura

```
Electron main
   ├── lpr-service    (:8765)  — inferencia ONNX (detector + OCR)
   └── camera-service (:8766)  — captura, storage, watchdog

camera-service
   ├── CameraCapture  (thread) — lee frames de la cámara vía OpenCV
   ├── CameraWatchdog (thread) — detecta caídas y reconecta con backoff
   ├── LocalStorage           — persiste frames en disco + metadata en SQLite
   └── lpr_client             — llama al lpr-service para reconocer patentes
```

### Archivos

| Archivo            | Descripción                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `main.py`          | Punto de entrada FastAPI. Config, lifespan, loop de captura, endpoints.                       |
| `capture.py`       | Hilo de captura continua via `cv2.VideoCapture`. Soporta USB (índice) y RTSP (URL).           |
| `storage.py`       | Persiste imágenes en `images/<tenantId>/<fecha>/` y metadata en SQLite (modo WAL).            |
| `watchdog.py`      | Detecta ausencia de frames y dispara reconexión con backoff exponencial (1→2→4→8→30 s).       |
| `lpr_client.py`    | Codifica el frame en base64 y hace POST al LPR service. Devuelve `None` ante cualquier falla. |
| `requirements.txt` | Dependencias con versiones fijadas.                                                           |
| `build.spec`       | Spec de PyInstaller para generar el binario standalone.                                       |
| `Makefile`         | Targets de desarrollo y build.                                                                |

### Variables de entorno

| Variable                  | Default                 | Descripción                                                  |
| ------------------------- | ----------------------- | ------------------------------------------------------------ |
| `CAMERA_SOURCE`           | `0`                     | Índice USB (`0`, `1`, ...) o URL RTSP.                       |
| `CAMERA_FPS`              | `10`                    | FPS objetivo de captura.                                     |
| `CAMERA_WIDTH`            | `1280`                  | Ancho del frame en píxeles.                                  |
| `CAMERA_HEIGHT`           | `720`                   | Alto del frame en píxeles.                                   |
| `CAMERA_ID`               | `cam-01`                | Identificador lógico de la cámara (guardado en metadata).    |
| `CAMERA_TENANT_ID`        | `default`               | ID del tenant para el path de imágenes y la DB.              |
| `CAMERA_LOCATION`         | `entrada`               | `entrada` o `salida` — guardado en metadata de cada captura. |
| `CAMERA_CAPTURE_INTERVAL` | `2`                     | Segundos entre llamadas al LPR.                              |
| `CAMERA_MIN_CONFIDENCE`   | `0.60`                  | Confianza mínima `[0–1]` para guardar una detección.         |
| `CAMERA_COOLDOWN`         | `5`                     | Segundos entre guardados de la misma patente (dedup).        |
| `CAMERA_DB_PATH`          | `./camera.db`           | Path del archivo SQLite local.                               |
| `CAMERA_IMAGES_DIR`       | `./images`              | Directorio base para las imágenes.                           |
| `CAMERA_WATCHDOG_TIMEOUT` | `5`                     | Segundos sin frames antes de declarar la cámara caída.       |
| `LPR_URL`                 | `http://127.0.0.1:8765` | URL base del LPR service.                                    |

### Endpoints

#### `GET /health`

Indica que el servicio está corriendo. Electron lo sondea al iniciar.

```json
{ "status": "ok" }
```

#### `GET /stream/status`

Estado actual de la cámara. Electron lo usa para mostrar alertas en la UI
cuando la cámara lleva más de 1 minuto caída.

```json
{
  "camera": "ok",
  "down_since": null,
  "reconnect_attempts": 0
}
```

#### `GET /detection/latest`

Última patente detectada desde que el servicio arrancó. La UI Electron
la consulta para pre-completar el formulario de ingreso al operario.
Devuelve `404` si todavía no hubo ninguna detección.

```json
{
  "capture_id": "3f2a1b...",
  "plate": "AB 123 CD",
  "text": "AB123CD",
  "confidence": 0.91,
  "location": "entrada",
  "camera_id": "cam-01"
}
```

### Storage local

**Disco:**

```
images/
  <tenantId>/
    <yyyy-mm-dd>/
      <uuid>.jpg    ← JPEG calidad 85, solo frames con patente detectada
```

**SQLite** (`camera.db`, modo WAL):

```sql
captures(
  id          TEXT PRIMARY KEY,   -- uuid, coincide con el nombre del archivo
  path        TEXT,               -- path absoluto en disco
  timestamp   TEXT,               -- ISO 8601 UTC
  camera_id   TEXT,
  location    TEXT,               -- "entrada" | "salida"
  plate       TEXT,               -- texto normalizado, ej: "AB123CD"
  confidence  REAL,               -- score compuesto [0, 1]
  event_id    TEXT                -- reservado para referenciar eventos del backend
)
```

### Reconexión automática (watchdog)

El watchdog verifica cada segundo si llegaron frames nuevos. Si no llega
ninguno durante `CAMERA_WATCHDOG_TIMEOUT` segundos, declara la cámara caída
y reintenta con backoff exponencial:

```
1 s → 2 s → 4 s → 8 s → 30 s → 30 s → ...
```

Al recuperar frames, resetea el contador y marca la cámara como `ok`.

---

## Nota para Windows

`make` no viene de fábrica en Windows. Opciones:

- Instalarlo (`choco install make` o vía Git Bash / WSL), **o**
- Correr los comandos equivalentes dentro de `services/camera`:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python main.py
```
