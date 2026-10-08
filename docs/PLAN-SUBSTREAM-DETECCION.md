# Plan: detectar el movimiento sobre el sub-stream y pedir la foto grande bajo demanda

> **Estado: NO implementado.** Es un plan para el futuro, escrito mientras el
> contexto estaba fresco. Antes de empezar, leer "Cuándo hacer esto" al final:
> hay condiciones que pueden volverlo innecesario.

## El problema

`camera-service` abre el stream principal de la cámara (2560×1440) y lo
decodifica **entero y en continuo** en `capture.py:run()`. El consumidor
—`_process_loop` en `main.py`— lo mira **10 veces por segundo** y lo único que
decide con eso es un sí o un no: "¿se movió algo?".

O sea que se descomprimen 44 millones de píxeles por segundo para responder una
pregunta binaria, y la resolución completa sólo hace falta en el instante del
disparo, para recortar el ROI y mandárselo al reconocedor.

Medido en la instalación de referencia (Pentium G4400, 2 núcleos), después de
todas las optimizaciones de ajuste: **24% de CPU sostenido**. El piso de esa vía
ya se tocó; lo que queda es inherente a descomprimir 4 MP por software.

## La idea

Dos fuentes en vez de una:

| Para qué            | De dónde                   | Costo                   |
| ------------------- | -------------------------- | ----------------------- |
| Detectar movimiento | **Sub-stream** (640×360)   | ~16× menos píxeles      |
| Imagen para el LPR  | **Foto HTTP bajo demanda** | Sólo cuando hay disparo |

El stream principal **no se abre nunca**. La cámara ya tiene la foto a
resolución completa y la sirve comprimida: en Hikvision,
`GET /ISAPI/Streaming/channels/101/picture`.

**Ahorro estimado: de 24% a 5-8%.** El `lpr-service` no cambia — eso es
inferencia y se dispara igual.

## El riesgo principal

Hoy la sincronización es perfecta **por construcción**: `motion.check()`
(`motion.py:75-121`) devuelve `frame.copy()` del mismo array que acaba de
analizar. La evidencia que se guarda **es** el cuadro que disparó.

Con una foto por HTTP hay **100-300 ms de ida y vuelta**. Un auto a 5 km/h
recorre entre 14 y 42 cm en ese tiempo.

Hay un argumento de que podría ser **mejor**: el disparo ocurre cuando el auto
recién entra a la zona, o sea cuando está más lejos y la patente más chica; 200
ms después está más cerca. Pero es una hipótesis. **Hay que medirla antes de
decidir**, comparando la confianza media de las lecturas con una vía y con la
otra.

## Los cambios

### 1. `capture.py` — la fuente pasa a ser el sub-stream

Sólo cambia qué URL se abre. El loop, el `deque(maxlen=1)`, el chequeo de
`_generation` (`capture.py:145-147`) y el backoff del stream mudo quedan igual.

**Invariante que NO se puede romper:** `latest_frame()` devuelve **sin copia**
(`capture.py:156-158`), y es correcto sólo porque `cap.read()` asigna un
ndarray nuevo cada vez. Si alguien "optimiza" con un buffer preasignado, el
thread de captura va a sobrescribir cuadros que otro está leyendo, y el síntoma
es una franja con contenido de otro cuadro en una foto que después se audita.

### 2. Módulo nuevo: cliente de la foto

```
services/camera/snapshot.py
```

- `fetch(url, timeout) -> np.ndarray | None`
- Autenticación **digest** (Hikvision la usa; `httpx` la trae).
- La contraseña se redacta en todo log: reusar `redact_source` de `capture.py`.
- Timeout **corto**, 1,5 s. Más que eso y la foto ya no sirve. Y tiene que ser
  menor que `CAMERA_WATCHDOG_TIMEOUT` por el mismo motivo que `LPR_TIMEOUT_S`
  (ver `lpr_client.py`): el loop espera bloqueado, y si tarda lo mismo que el
  watchdog, éste cree que la cámara se cayó y reinicia la conexión en cascada.
- Si falla, **caer al cuadro del sub-stream**. Una lectura mala es mejor que
  ninguna, y el agrupamiento ya descarta lo que no sirve.

### 3. `main.py` — el loop

En `_process_loop`, donde hoy dice `snapshot = roi_crop(snapshot, ROI)`
(~`main.py:1065`):

```
disparo sobre el cuadro chico
  → pedir la foto grande
      → si llega:    recortar el ROI escalado a resolución completa
      → si no llega: recortar el ROI del cuadro chico (degradado, pero sigue)
```

### 4. El ROI — la parte más delicada

El ROI se guarda en **píxeles del cuadro principal** (`main.py:_parse_roi`), y
el editor lo dibuja contra el `naturalWidth` de lo que llega por
`/stream/mjpeg`. Con dos resoluciones en juego hay que escalarlo en dos lados:

- **Para el movimiento**: del espacio principal al del sub-stream.
- **Para el recorte**: queda en espacio principal, que es lo que devuelve la
  foto. Sin cambios.

> **Hacer esto en serio significa guardar el ROI en coordenadas relativas
> (0-1).** Es la forma de que deje de importar qué resolución tiene cada vía.
> Hoy ya hay un parche por este mismo motivo: el editor pide `maxWidth=0` para
> recibir el cuadro sin achicar (ver el docstring de `stream_mjpeg`), porque
> achicar el preview rompió el ROI en silencio. Si se migra a relativas, ese
> override sobra y este plan se simplifica bastante.
>
> La migración necesita convertir los ROI ya guardados: hay que conocer la
> resolución con la que se dibujaron, que **no se guarda**. Lo más seguro es
> aceptar las dos formas —enteros = píxeles heredados, decimales = relativas— y
> convertir la primera vez que el servicio vea la resolución real.

### 5. Preview MJPEG

Pasa a salir del sub-stream, y el `imencode` se vuelve casi gratis.

**Pero el editor de ROI necesita el cuadro a resolución completa** mientras el
ROI siga en píxeles. O se migra a relativas (y se dibuja sobre el sub-stream
sin problema), o el editor tiene que pedir una foto fija por HTTP en vez de un
stream. Resolver esto antes de tocar el preview.

### 6. Configuración — **todo esto tiene que ser configurable**

| Clave               | Default                                 | Para qué                                      |
| ------------------- | --------------------------------------- | --------------------------------------------- |
| `detectionSource`   | `main`                                  | `main` = como hoy; `substream` = la vía nueva |
| `substreamPath`     | `/Streaming/Channels/102`               | Ruta del stream chico                         |
| `snapshotPath`      | `/ISAPI/Streaming/channels/101/picture` | Foto a resolución completa                    |
| `snapshotTimeoutMs` | `1500`                                  | Techo de espera                               |

Se suman a `_TUNABLES` y `_GLOBAL_BY_KEY` (`main.py`), y al panel
(`CameraSettingsPanel.tsx` + `DesktopCameraTuning` en `electron.d.ts`).

**Las rutas van configurables y no fijas**, igual que ya pasa con la del stream
principal: `CAMERA_SETUP.md` soporta Hikvision, Dahua y EZVIZ, y cada una usa
las suyas. La de ISAPI es de Hikvision; Dahua usa `/cgi-bin/snapshot.cgi`.

> **`detectionSource` en `main` por defecto es lo que hace seguro todo esto.**
> La vía nueva se prende en una instalación, se mide, y si algo anda mal se
> vuelve cambiando un valor en el panel — sin reinstalar ni revertir. En una
> playa que depende de esto para registrar autos, no hay otra forma responsable
> de entregarlo.

### 7. Watchdog y `/probe`

El watchdog (`watchdog.py`) mira el sub-stream, que es el continuo. La foto no
tiene watchdog: si falla, se cae al cuadro chico y se loguea.

`/probe` (`main.py:1295`) tiene que poder probar las tres cosas —stream
principal, sub-stream y foto— porque el botón "Probar conexión" es lo único que
tiene el dueño para saber si cargó bien las rutas.

## Lo que NO se toca

El agrupamiento de lecturas, la supresión de repetidos y conocidas, el piso de
confianza, el guardado en disco y SQLite, el aviso por SSE al panel. Toda esa
mitad del pipeline recibe un `result` y una imagen y no le importa de dónde
salieron.

## Verificación

**Tests** (`services/camera/tests/`, hoy 126):

- Que el ROI escale bien entre resoluciones, ida y vuelta, incluyendo que un
  ROI que se sale del cuadro se recorte (`roi_crop` ya lo cubre).
- Que una foto que falla **caiga al cuadro del sub-stream** y no tire la
  detección.
- Que el timeout de la foto sea menor que el del watchdog. Es una aserción
  sobre constantes y evita revivir la cascada de `LPR_TIMEOUT_S`.
- Que con `detectionSource=main` el camino viejo quede **idéntico**.

**A mano, que es lo que de verdad decide:**

1. Medir el CPU desde **Operativo** (nunca desde Cámara: el preview suma ~8
   puntos) con `detectionSource=main`. Es la línea de base.
2. Cambiar a `substream`, reiniciar el servicio —los parámetros del video se
   acuerdan al conectar— y medir igual.
3. **Dejarlo una semana y comparar la confianza media por hora** contra la
   semana anterior. Es la única forma de saber si los 100-300 ms de la foto
   costaron lecturas. La consulta está en el historial: agrupar
   `lpr_detection_events` por hora y promediar `confidence`.

Si la confianza baja, **el ahorro de CPU no lo justifica**: el problema que
importa es que el operador descarta 3 tarjetas por cada una buena, no el
Administrador de tareas.

## Cuándo hacer esto

**No antes de responder estas tres**, porque cualquiera puede volverlo
innecesario:

1. **¿El obturador en 1/100 arregló las lecturas del amanecer?** Es donde está
   el 60% de las lecturas malas y la mitad del tráfico. Si las arregló, el
   problema grande ya no existe.
2. **¿La aceleración por hardware aporta algo?** Se mide con
   `CAMERA_HW_ACCEL=0` y comparando. Si no aporta, apagarla baja el uso de GPU
   gratis; si aporta, parte de este plan ya está cobrada.
3. **¿24% de CPU molesta de verdad?** La máquina tiene dos núcleos. Si la playa
   opera sin tirones, esto es optimizar por deporte.

**Y si lo que se busca es bajar el CPU, antes de este refactor hay dos
alternativas más baratas:**

- **Comprar una cámara con reconocimiento embebido** (en Hikvision, modelos con
  `/P` o serie `iDS-`). Elimina el decodificado **y** la inferencia: el
  `lpr-service` entero sobra. Verificar que soporte patentes Mercosur.
- **Bajar la resolución del stream principal.** Suena obvio y **es una
  trampa**: el detector achica todo a 384 px de lado, así que lo que decide es
  qué _fracción_ del cuadro ocupa la patente, y eso no cambia al bajar la
  resolución. Lo que sí la agranda es acercar el ROI o un lente con zoom. Está
  explicado en `CAMERA_SETUP.md`.
