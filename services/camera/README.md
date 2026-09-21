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

### Pipeline de detección

```
CameraCapture thread (10 FPS)
    │  cv2.VideoCapture → deque(maxlen=1)
    ▼
MotionDetector.check(frame)          ← cada 100 ms desde el asyncio loop
    │  absdiff sobre ROI configurable
    │  descarta warmup inicial (10 frames) y cooldown entre triggers (3 s)
    │  retorna snapshot capturado en el instante exacto del trigger
    ▼ (solo si hay movimiento significativo)
LPR inference — run_in_executor(pool_size=1)
    │  snapshot → base64 → POST /process al lpr-service
    │  descarta si lpr_busy (como máximo 1 inferencia simultánea)
    ▼
Filtros de calidad
    │  confianza < MIN_CONFIDENCE → descarta
    │  misma patente dentro de COOLDOWN s → actualiza _last_detection sin guardar
    ▼
LocalStorage.save(snapshot, ...)
    │  JPEG a disco → INSERT en SQLite (valida imwrite antes del INSERT)
    ▼
_last_detection actualizado → UI lo consulta por GET /detection/latest

Fallback (cada FALLBACK_INTERVAL = 300 s)
    Fuerza un scan LPR aunque no haya habido movimiento detectado.
    Cubre vehículos presentes al iniciar el servicio o durante gaps de detección.
```

### Archivos

| Archivo            | Descripción                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `main.py`          | Punto de entrada FastAPI. Config, lifespan, pipeline de detección, endpoints.                 |
| `capture.py`       | Hilo de captura continua via `cv2.VideoCapture`. Soporta USB (índice) y RTSP (URL).           |
| `motion.py`        | Detector de movimiento por absdiff. ROI configurable, cooldown propio, warmup de startup.     |
| `storage.py`       | Persiste imágenes en `images/<tenantId>/<fecha>/` y metadata en SQLite (modo WAL).            |
| `watchdog.py`      | Detecta ausencia de frames y dispara reconexión con backoff exponencial (1→2→4→8→30 s).       |
| `lpr_client.py`    | Codifica el frame en base64 y hace POST al LPR service. Devuelve `None` ante cualquier falla. |
| `requirements.txt` | Dependencias con versiones fijadas.                                                           |
| `build.spec`       | Spec de PyInstaller para generar el binario standalone.                                       |
| `Makefile`         | Targets de desarrollo y build.                                                                |

### Variables de entorno

| Variable                   | Default                 | Descripción                                                                                      |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `CAMERA_SOURCE`            | `0`                     | Índice USB (`0`, `1`, ...) o URL RTSP. En la app la setea Electron desde `userData/camera.json`. |
| `CAMERA_FPS`               | `10`                    | FPS objetivo de captura.                                                                         |
| `CAMERA_WIDTH`             | `1280`                  | Ancho del frame en píxeles.                                                                      |
| `CAMERA_HEIGHT`            | `720`                   | Alto del frame en píxeles.                                                                       |
| `CAMERA_ID`                | `cam-01`                | Identificador lógico de la cámara (guardado en metadata).                                        |
| `CAMERA_TENANT_ID`         | `default`               | ID del tenant para el path de imágenes y la DB.                                                  |
| `CAMERA_LOCATION`          | `entrada`               | `entrada` o `salida` — guardado en metadata de cada captura.                                     |
| `CAMERA_MOTION_THRESHOLD`  | `1.5`                   | Diferencia media de píxeles `[0–255]` para detectar movimiento.                                  |
| `CAMERA_MOTION_COOLDOWN`   | `3.0`                   | Segundos mínimos entre disparos de LPR por movimiento.                                           |
| `CAMERA_ROI`               | `""`                    | Región de interés `"x1,y1,x2,y2"`. Vacío = frame completo.                                       |
| `CAMERA_FALLBACK_INTERVAL` | `300`                   | Segundos entre scans de respaldo (captura vehículos sin movimiento).                             |
| `CAMERA_MIN_CONFIDENCE`    | `0.60`                  | Confianza mínima `[0–1]` para guardar una detección.                                             |
| `CAMERA_COOLDOWN`          | `5`                     | Segundos entre guardados de la misma patente (dedup a nivel de patente).                         |
| `CAMERA_DB_PATH`           | `./camera.db`           | Path del archivo SQLite local.                                                                   |
| `CAMERA_IMAGES_DIR`        | `./images`              | Directorio base para las imágenes.                                                               |
| `CAMERA_WATCHDOG_TIMEOUT`  | `5`                     | Segundos sin frames antes de declarar la cámara caída.                                           |
| `LPR_URL`                  | `http://127.0.0.1:8765` | URL base del LPR service.                                                                        |

### Cámaras IP (RTSP)

`CAMERA_SOURCE` acepta una URL `rtsp://usuario:clave@host:554/ruta`. Tres cosas
que el código hace por vos y conviene saber:

- **Se fuerza TCP** (`rtsp_transport;tcp`). Por UDP, un Wi-Fi flojo entrega
  frames con artefactos y el OCR lee patentes rotas.
- **Timeouts de 5 s** al abrir y al leer. Sin ellos, una IP inalcanzable deja el
  thread de captura colgado adentro de `cv2.VideoCapture()` para siempre, y ni
  el watchdog lo puede rescatar.
- **La contraseña se redacta** en todo log y en toda respuesta HTTP
  (`redact_source` en `capture.py`). Si agregás un log que muestre la fuente,
  usá ese helper.

`CAMERA_WIDTH`, `CAMERA_HEIGHT` y `CAMERA_FPS` **no aplican** a una cámara IP: la
resolución y el framerate los manda la cámara. Solo valen para webcams USB.

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
  "reconnect_attempts": 0,
  "source": "rtsp://admin:***@192.168.1.26:554/h264_stream"
}
```

`camera` puede ser `ok`, `down` o `initializing` (abriendo la fuente; con RTSP
tarda unos segundos). `source` viene siempre con la contraseña enmascarada.

#### `POST /probe`

Prueba una fuente **sin tocar la captura en curso**: abre, lee un frame y cierra.
Es lo que usa el botón "Probar conexión" del panel de configuración.

```json
{ "source": "rtsp://usuario:clave@192.168.1.26:554/h264_stream" }
→ { "ok": true, "width": 1920, "height": 1080 }
→ { "ok": false, "error": "no_se_pudo_conectar" }
→ { "ok": false, "error": "conecta_pero_no_entrega_video" }
```

El segundo error distingue el caso más confuso: la cámara responde en el puerto
pero la ruta del stream está mal, o tiene el cifrado de imagen activado.

#### `POST /config/source`

Apunta a otra cámara sin reiniciar el proceso.

```json
{ "source": "rtsp://...", "cameraId": "cam-entrada", "location": "entrada" }
```

#### `GET /detections?limit=20`

Historial de las últimas `limit` detecciones persistidas en SQLite (máximo 100).
Útil para que la UI muestre un log reciente de accesos.

```json
[
  {
    "id": "3f2a1b...",
    "path": "/abs/path/images/default/2026-05-31/3f2a1b....jpg",
    "timestamp": "2026-05-31T21:00:00+00:00",
    "camera_id": "cam-01",
    "location": "entrada",
    "plate": "AB123CD",
    "confidence": 0.91,
    "event_id": null
  }
]
```

#### `GET /detection/latest`

Última patente detectada en memoria desde que el servicio arrancó. La UI
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

#### `DELETE /detection/latest`

Limpia la detección en memoria. La UI debe llamar a este endpoint después
de que el operario confirme el ingreso, para que el formulario no se
pre-complete con una patente vieja en el próximo acceso.
Devuelve `204 No Content`.

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

**Arranque sin cámara**: si la cámara no está disponible al iniciar, el hilo
de captura no muere — queda en modo idle y aplica el mismo backoff en cuanto
el watchdog detecta que no llegan frames. Conectar la cámara después del
arranque es suficiente para que el servicio la retome automáticamente.

## Notas de storage

- `cv2.imwrite` se valida: si la escritura falla (disco lleno, permisos), el
  servicio loguea `capture_save_failed` y no inserta la fila en SQLite. Nunca
  queda un registro apuntando a un archivo inexistente.
- La columna `event_id` en SQLite está disponible para ser completada por el
  backend una vez que asocie el acceso a un evento. El campo se incluye en el
  INSERT desde el primer guardado; por defecto es `NULL` hasta que se asigne.
- En producción (app empaquetada) Electron inyecta `CAMERA_DB_PATH` y
  `CAMERA_IMAGES_DIR` apuntando a `app.getPath('userData')`. Las variables de
  entorno de la tabla de abajo sólo aplican cuando se corre el servicio
  directamente (dev / make camera-dev).

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
