# LPR Service — Microservicio de reconocimiento de patentes

Microservicio Python de **reconocimiento de patentes** (License Plate Recognition)
para Parkit. Detecta la patente de un auto en una imagen y devuelve el texto leído.

Usa el stack **ONNX** de [`fast-alpr`](https://github.com/ankandrew/fast-alpr)
(detector YOLO-v9 + OCR CCT), **sin PyTorch**, pensado para correr en las CPUs
modestas de los puestos de los estacionamientos: **no requiere GPU** y, una vez
instalado, **no requiere internet** para funcionar. Se empaqueta como un binario
standalone (PyInstaller) que el proceso principal de Electron levanta
automáticamente al iniciar la aplicación.

---

## Prerrequisitos del sistema

| Requisito      | Versión            | Notas                                                                   |
| -------------- | ------------------ | ----------------------------------------------------------------------- |
| **Python**     | 3.10 o superior    | Probado con 3.12.3.                                                     |
| **pip + venv** | —                  | En Debian/Ubuntu: `sudo apt install python3-pip python3-venv`.          |
| **make**       | GNU Make 4.x       | Para usar los targets. En Windows ver la nota más abajo.                |
| **GPU**        | _no necesaria_     | Corre todo en CPU. (GPU/OpenVINO son opt-in, ver variables de entorno.) |
| **Internet**   | solo para instalar | Necesario para `lpr-install` y `lpr-download-models`. Después, offline. |

Espacio en disco aproximado: **~360 MB** el entorno virtual + **~12 MB** los modelos.

---

## Instalación paso a paso

> Todos los comandos se corren parados en `front-desktop/services/lpr`.

### 1. Instalar dependencias

```bash
make lpr-install
```

Crea el virtualenv en `.venv/` e instala todo (FastAPI, Uvicorn, `fast-alpr[onnx]`,
OpenCV, etc.). La primera vez en una máquina nueva descarga ~25 MB de paquetes;
si pip ya los tiene cacheados, tarda unos segundos.

### 2. Descargar los modelos

```bash
make lpr-download-models
```

Baja los modelos ONNX (detector + OCR, ~12 MB) desde GitHub Releases y los deja
cacheados en `~/.cache/open-image-models/` y `~/.cache/fast-plate-ocr/`.
**Esto necesita internet una sola vez** — luego el servicio arranca offline.

### 3. Levantar el servicio

Hay dos formas:

```bash
# A) Primer plano — ves los logs en vivo, se frena con Ctrl+C
make lpr-dev

# B) Background (daemon) — devuelve la terminal
make lpr-up      # arranca en background (PID en .lpr.pid)
make lpr-down    # lo detiene
make lpr-logs    # sigue los logs (tail -f)
```

En ambos casos levanta en `http://127.0.0.1:8765`. Al arrancar carga los modelos
y hace un _warmup_ (~2-3 s) para que el primer pedido no sea lento.

Para usar otro puerto, pasá `PORT=`: `make lpr-up PORT=9000` (o `make lpr-dev PORT=9000`).

---

## Probar que funciona (smoke test)

Con el servicio corriendo (`make lpr-dev`), en otra terminal:

```bash
# Health check
curl http://localhost:8765/health
# → {"status":"ok"}

# Procesar una imagen con una patente (ruta absoluta)
make lpr-test FILE=/ruta/abs/patente.jpg
# → {"plate": "AD 786 BN", "text": "AD786BN", "confidence": 0.886, "bbox": [210, 554, 344, 617]}
```

`lpr-test` codifica la imagen en base64, la manda a `/process` y muestra la
respuesta formateada. Avisa con un error claro si falta `FILE`, si el archivo no
existe o si el servicio no está levantado.

Performance de referencia (CPU, sin GPU): carga + warmup ~2.6 s (una vez),
**inferencia ~25-30 ms por imagen** (con el OCR `cct-s-v2-global-model`).

---

## Empaquetar el binario de distribución

```bash
make lpr-build
```

Usa **PyInstaller** (configurado en `build.spec`) para generar un único binario
autónomo `dist/lpr-service` (o `dist/lpr-service.exe` en Windows) que **incluye el
runtime de Python y los modelos ONNX adentro**. Esto es lo que se distribuye con la
app Electron: el usuario final no necesita Python ni internet para ejecutarlo.

Cómo garantiza el offline: el `build.spec` copia las cachés
(`~/.cache/open-image-models` y `~/.cache/fast-plate-ocr`) dentro del bundle bajo
`models/`. Al arrancar empaquetado, `recognizer._seed_offline_cache()` las restaura
en la máquina del usuario, dejando el binario **100 % offline**. Para achicar el
tamaño se excluyen `tkinter`, `matplotlib`, `scipy`, `pandas`, `torch`,
`torchvision` y `easyocr`.

> ⚠️ Correr `make lpr-download-models` **antes** de buildear: el `build.spec` toma
> los modelos de la caché y los hornea en el binario. Falla con un mensaje claro si
> la caché no existe.
>
> ⚠️ PyInstaller **no** hace cross-compile: para obtener un `.exe` de Windows hay
> que correr `make lpr-build` en una máquina/CI Windows.

---

## Comandos disponibles

| Comando                    | Qué hace                                                  |
| -------------------------- | --------------------------------------------------------- |
| `make help`                | Lista los targets disponibles.                            |
| `make lpr-install`         | Crea el venv e instala dependencias.                      |
| `make lpr-download-models` | Descarga los modelos ONNX a la caché.                     |
| `make lpr-dev`             | Levanta el servicio en primer plano (logs en vivo).       |
| `make lpr-up`              | Levanta el servicio en background (PID en `.lpr.pid`).    |
| `make lpr-down`            | Detiene el servicio levantado con `lpr-up`.               |
| `make lpr-logs`            | Sigue los logs del servicio en background (`tail -f`).    |
| `make lpr-test FILE=...`   | Manda una imagen a `/process` y muestra la patente leída. |
| `make lpr-build`           | Empaqueta el binario standalone con PyInstaller.          |
| `make clean`               | Borra `.venv`, `.build`, `dist` y `__pycache__`.          |

---

## Nota para Windows

`make` no viene de fábrica en Windows. Opciones:

- Instalarlo (p. ej. `choco install make` o vía Git Bash / WSL), **o**
- Correr los comandos equivalentes a mano dentro de `services/lpr`:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -c "from recognizer import PlateRecognizer; PlateRecognizer()"   # descarga modelos
.venv\Scripts\python main.py                                                          # levanta el servicio
```

---

# Referencia técnica

## Archivos

| Archivo            | Descripción                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.py`          | Punto de entrada FastAPI. Define los endpoints `/health` y `/process`, gestiona el ciclo de vida del reconocedor (carga + warmup) y arranca Uvicorn.                                   |
| `recognizer.py`    | Wrapper de `fast-alpr`. Combina el detector ONNX (`open-image-models`, YOLO-v9) y el OCR ONNX (`fast-plate-ocr`, CCT). Normaliza/formatea la patente argentina y compone la confianza. |
| `requirements.txt` | Dependencias Python con versiones fijadas (FastAPI, Uvicorn, fast-alpr[onnx], OpenCV headless, PyInstaller).                                                                           |
| `build.spec`       | Spec de PyInstaller. Empaqueta el código, los modelos ONNX cacheados y los imports ocultos en un único binario `dist/lpr-service`.                                                     |
| `Makefile`         | Targets de desarrollo y build (ver sección Comandos).                                                                                                                                  |

---

## Modelos

| Rol      | Default                               | Librería            | Tamaño  |
| -------- | ------------------------------------- | ------------------- | ------- |
| Detector | `yolo-v9-t-384-license-plate-end2end` | `open-image-models` | ~7.8 MB |
| OCR      | `cct-s-v2-global-model`               | `fast-plate-ocr`    | ~4 MB   |

Ambos corren sobre `onnxruntime` en CPU.

### ¿Por qué el OCR global y no un modelo "dedicado a Argentina"?

`fast-plate-ocr` **tuvo** modelos solo-AR (`argentinian-plates-cnn-model`,
`argentinian-plates-cnn-synth-model`), pero su autor los marcó como **legacy** y
**dejó de recomendarlos**. La generación nueva es la familia **CCT v2 global**,
entrenada con >114.000 muestras de **65+ países (Argentina incluida)**:

| Modelo                                | Arquitectura      | Cobertura  | Latencia | plate_acc              | Estado             |
| ------------------------------------- | ----------------- | ---------- | -------- | ---------------------- | ------------------ |
| `argentinian-plates-cnn-synth-model`  | CNN (solo AR)     | Argentina  | ~2.1 ms  | 94.19 %                | ⚠️ Legacy          |
| `argentinian-plates-cnn-model`        | CNN (solo AR)     | Argentina  | ~2.1 ms  | 94.05 %                | ⚠️ Legacy          |
| `cct-xs-v2-global-model`              | CCT (transformer) | 65+ países | ~0.47 ms | alta                   | ✅ Vigente         |
| **`cct-s-v2-global-model`** (default) | CCT (transformer) | 65+ países | ~0.68 ms | alta (>0.99 region F1) | ✅ **Recomendado** |

El modelo CCT global es a la vez **más rápido** (~0.7 ms vs 2.1 ms del CNN AR) y
**igual o más preciso**, por eso es el default. La diferencia de velocidad entre
`xs` y `s` (~0.2 ms) es despreciable frente a los ~25-30 ms totales por imagen, así
que usamos la variante `s` (más precisa).

> **Si querés validar empíricamente sobre tus propias cámaras**, podés correr el
> modelo AR legacy con `LPR_OCR_MODEL=argentinian-plates-cnn-synth-model` y comparar
> resultados. Pero salvo que midas una mejora real, el global `cct-s-v2` es la
> opción mantenida y recomendada.

### Variables de entorno (opcionales)

| Variable             | Default                 | Para qué                                                                                                                         |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `LPR_DETECTOR_MODEL` | `yolo-v9-t-384-...`     | Cambiar el detector.                                                                                                             |
| `LPR_OCR_MODEL`      | `cct-s-v2-global-model` | Cambiar el OCR (p. ej. `argentinian-plates-cnn-synth-model` para benchmarkear el AR legacy).                                     |
| `LPR_DETECTOR_CONF`  | `0.4`                   | Umbral de confianza del detector `[0, 1]`.                                                                                       |
| `LPR_ONNX_PROVIDERS` | `CPUExecutionProvider`  | Habilitar aceleración donde exista: `OpenVINOExecutionProvider,CPUExecutionProvider` (Intel) o `CUDAExecutionProvider` (NVIDIA). |
| `LPR_OCR_DEVICE`     | `cpu`                   | `cpu` / `cuda` / `auto`.                                                                                                         |

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
  "confidence": 0.84,
  "bbox": [307, 187, 387, 210]
}
```

| Campo        | Descripción                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| `plate`      | Patente formateada con espacios canónicos.                                     |
| `text`       | Texto normalizado (sin espacios, en mayúsculas).                               |
| `confidence` | Score compuesto `[0, 1]`: confianza del detector × confianza del OCR.          |
| `bbox`       | Caja `[x1, y1, x2, y2]` de la patente en la imagen original (útil para la UI). |

**Errores**

| Status | Detalle                                |
| ------ | -------------------------------------- |
| `422`  | Imagen inválida o no decodificable.    |
| `404`  | No se detectó ninguna patente legible. |

---

## Formatos de patente soportados

| Formato            | Ejemplo     | Patrón                          |
| ------------------ | ----------- | ------------------------------- |
| Antiguo (pre-2016) | `ABC 123`   | 3 letras + 3 dígitos            |
| Mercosur (2016+)   | `AB 123 CD` | 2 letras + 3 dígitos + 2 letras |

Si el texto reconocido coincide con alguno de estos formatos, se le agregan los
espacios canónicos en el campo `plate`. **No** se aplica un bonus/penalización de
confianza por formato: el modelo OCR ya conoce el alfabeto de patentes, así que la
confianza reportada es directa (detector × OCR).

---

## Confianza compuesta

```
confidence = detection_conf × ocr_conf
```

- `detection_conf`: score del bounding-box del detector `[0, 1]`.
- `ocr_conf`: confianza promedio por caracter del OCR `[0, 1]`.
