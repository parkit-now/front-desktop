# Guía: dejar la cámara y la app funcionando mejor

Esta guía es para el dueño del estacionamiento. No hace falta saber de
computación: son opciones que se cambian haciendo clic, y todas se pueden
deshacer.

**Tiempo estimado:** 20 minutos la cámara, 5 minutos la app.

**Qué vas a conseguir:**

- Que la computadora deje de trabajar al pedo (hoy el programa de la cámara usa
  casi un tercio de la máquina todo el día, y la PC tiene sólo dos núcleos).
- Que lea bien las patentes al atardecer, que es cuando hoy falla más.
- Que dejen de aparecer tantas tarjetas para descartar a mano.

---

## ⚠️ Antes de empezar: anotá lo que hay

Antes de tocar cada opción, **sacale una foto con el celular a la pantalla**.
Si algo queda peor, con esa foto volvés a como estaba en un minuto.

---

# PARTE 1 — La cámara

Es la parte que más cambia las cosas. De acá sale la mayor parte de la mejora.

## Cómo entrar a la cámara

1. Abrí el navegador (Chrome, Edge, el que uses) en la computadora del
   estacionamiento.
2. En la barra de direcciones escribí la **dirección IP de la cámara** y apretá
   Enter. Es la misma que está cargada en Parkit: la ves en
   **Configuración → Cámara**, en el campo de la dirección.
3. Te va a pedir usuario y contraseña: son los mismos que cargaste en Parkit.
4. Si el navegador avisa que "la conexión no es privada", es normal en estas
   cámaras: entrá igual (Avanzado → Continuar).

> **Si no te deja entrar:** la cámara sólo acepta 6 usuarios a la vez. Cerrá la
> app del celular si la tenés abierta mirando la cámara, y probá de nuevo.

---

## 1.1 — Bajar los cuadros por segundo (de 20 a 12)

**Por qué:** la cámara manda 20 fotos por segundo y Parkit usa 10. Las otras 10
se procesan y se tiran. Es más de un tercio del trabajo de la computadora,
gastado en nada.

**No se pierde ninguna detección**: Parkit nunca miró esas fotos de más.

**Pasos:**

1. En el menú de la cámara entrá a **Configuración**.
2. Buscá **Vídeo/Audio** (puede decir "Video/Audio" o "Video Settings").
3. Arriba vas a ver un selector que dice **Tipo de secuencia** o **Stream Type**.
   Asegurate de que diga **Secuencia principal** (Main Stream).
4. Buscá el campo **Velocidad de fotogramas** (o "Frame Rate").
5. Cambialo de **20** a **12**.
6. Clic en **Guardar**.

> **Importante:** si hacés este paso, **tenés que hacer también el 1.3**
> (el obturador). Si no, las fotos de noche van a salir más movidas que ahora.
> Los dos van juntos.

---

## 1.2 — Cambiar la compresión a H.264

**Por qué:** la cámara comprime el video en un formato (H.265) que la
computadora tiene que descomprimir, y es el formato más pesado de los dos.
Cambiarlo a H.264 le saca bastante trabajo de encima, y además permite que la
placa de video ayude, cosa que con el otro formato no puede.

El video va a ocupar un poco más de red, pero como va por cable dentro del
local, no importa.

**Pasos:**

1. En la misma pantalla de **Vídeo/Audio** donde estuviste recién.
2. Buscá **Tipo de codificación de vídeo** (o "Video Encoding").
3. Cambialo a **H.264**.
   - ⚠️ **No elijas "H.264+"**, el que tiene el signo más. Elegí **H.264** a
     secas. El "+" comprime más pero le complica la vida al programa.
4. Si aparece un campo **Perfil** (Profile), dejalo en **Main** o **High**.
5. Clic en **Guardar**.

---

## 1.3 — El obturador: esto es lo que arregla las fotos movidas ⭐

**Este es el cambio más importante de toda la guía.**

**Por qué:** cuando baja la luz, la cámara deja el "ojo" abierto más tiempo para
que entre más luz. El problema es que si el auto se está moviendo, la patente
sale **barrida**, como cuando sacás una foto con pulso tembloroso. Por eso al
atardecer las lecturas se derrumban.

Los números lo confirman: a las 4 de la tarde la cámara lee bien 9 de cada 10
veces; a las 7 de la tarde falla 6 de cada 10.

**La solución** es ponerle un límite: "nunca dejes el ojo abierto más de este
tiempo, aunque esté oscuro".

**Pasos:**

1. En el menú de la cámara, entrá a **Configuración → Imagen** (o "Image").
2. Buscá la solapa **Ajuste de exposición** (o "Exposure Settings").
3. Vas a ver un campo que dice **Tiempo de exposición**, **Obturador** o
   **Shutter**. Probablemente diga **Auto**.
4. Cambialo a **1/250**.
5. Clic en **Guardar**.

**Ahora mirá el video en vivo:**

- Si se ve **bien**, listo.
- Si de noche se ve **muy oscuro**, buscá en la misma pantalla **Ganancia**
  (Gain) y subila de a poco hasta que se vea. Puede quedar con un poco de
  "ruido" (granulado): eso no molesta a la lectura de patentes, el movimiento sí.
- Si aun así queda muy oscuro, probá con **1/125** en vez de 1/250. Sigue siendo
  mucho mejor que Auto.

---

## 1.4 — El infrarrojo de noche

**Por qué:** las patentes son reflectantes, como los carteles de la ruta. De
noche la cámara prende luces infrarrojas y la patente devuelve toda esa luz de
golpe: en la foto sale un **rectángulo blanco** sin letras.

**Pasos:**

1. **Configuración → Imagen**, solapa **Luz complementaria** o **Infrarrojo**
   (puede decir "Supplement Light" o "IR Light").
2. Si el modo está en **Auto**, cambialo a **Manual**.
3. Bajá la **Intensidad** (Brightness/Strength) a la mitad, más o menos **50**.
4. Guardá y mirá un auto entrando de noche.
5. Si la patente **todavía sale blanca**, seguí bajando de a 10.
   Si la patente **se lee pero el resto está muy oscuro**, no importa: lo que
   nos interesa es la patente.

---

## 1.5 — Para el bache del mediodía

**Por qué:** alrededor de las 13-14h las lecturas también empeoran. Con el sol
alto suele ser contraluz: el fondo queda blanco y el auto, negro.

**Pasos:**

1. **Configuración → Imagen**, solapa **Ajuste de exposición** o **Modo día/noche**.
2. Buscá **WDR** (a veces "Amplio rango dinámico").
3. Ponelo en **Activado** y dejá el nivel en el valor del medio.
4. Guardá y mirá el video al mediodía siguiente.

> Si notás que con WDR prendido la imagen queda "lavada" o rara, apagalo: este
> paso es el menos importante de todos y es el único que podés saltear.

---

# PARTE 2 — La app

## 2.1 — Actualizar Parkit

1. Cerrá Parkit si está abierto.
2. Instalá la versión nueva como siempre.
3. Abrila. Los ajustes que tenías cargados se mantienen.

## 2.2 — Qué cambió solo, sin que hagas nada

La app nueva ya viene con estas mejoras aplicadas:

- **El video de vista previa se envía más chico.** La imagen que ves en la
  pantalla de Cámara se achica antes de mandarse. Se ve prácticamente igual y
  la computadora trabaja siete veces menos. **No afecta** ni a la detección ni
  a las fotos que se guardan: esas siguen saliendo del video original.
- **Busca el movimiento en una versión reducida.** Para preguntarse "¿se movió
  algo?" ya no analiza la imagen completa. Decide exactamente lo mismo y cuesta
  16 veces menos.
- **Reparte mejor el trabajo entre los dos núcleos** de la computadora.
- **Un par de arreglos de fondo**: antes, si el lector de patentes se
  demoraba, la app creía que la cámara se había caído y la reconectaba sola —
  por eso aparecía "Cámara sin señal · reintento 46" sin que la cámara tuviera
  nada. Eso ya no pasa.

## 2.3 — Ajustes nuevos que vas a ver

En **Configuración → Cámara → Ajustes** aparecen dos campos nuevos y uno cambió
de valor:

### "Descartar por debajo de" — nuevo, viene en 0,60

Hasta ahora, **toda** lectura que hacía el sistema te llegaba como tarjeta,
aunque la hubiera leído con un 17% de seguridad. Por eso se te juntaban tantas
para descartar.

Mirando lo que pasó en tu estacionamiento: de las lecturas por debajo de 0,60,
**vos descartaste 147 de 158**. Eran ruido casi siempre.

Ahora, si de un auto no se consigue ninguna lectura que llegue a 0,60, no
aparece la tarjeta y el operador carga la patente a mano, como haría sin
cámara.

- **Si se te escapan autos** que antes sí detectaba: bajalo a 0,50.
- **Si todavía te llegan muchas para descartar**: subilo a 0,70.

### "Confianza mínima" — pasó de 0,60 a 0,85

Es el que enciende el aviso **⚠ Verificar patente** en la tarjeta.

Estaba tan bajo que el aviso casi nunca aparecía, así que no servía de nada.
En 0,85 el aviso aparece justo cuando conviene mirar con atención.

**No descarta nada**: sólo avisa.

### "Ancho del preview" — nuevo, viene en 960

Es el tamaño al que se achica el video de la pantalla de Cámara. Si querés
verlo más grande y no te importa el consumo, subilo. Con **0** se manda
completo, como antes.

---

# Cómo saber si funcionó

## El consumo de la computadora

1. Abrí Parkit y **quedate en la pantalla de Operativo** (no en la de Cámara).
2. Clic derecho en la barra de abajo → **Administrador de tareas**.
3. Buscá **Parkit desktop app** y miralo 30 segundos.

| Momento                                 | Qué deberías ver |
| --------------------------------------- | ---------------- |
| Antes de todo esto                      | ~30%             |
| Después de los pasos 1.1 y 1.2 (cámara) | **15–18%**       |
| Con la app nueva además                 | **menos de 15%** |

> Si lo mirás con la pantalla de **Cámara** abierta va a dar más alto, y está
> bien: ahí hay un video corriendo. Medí siempre desde Operativo.

## Las lecturas de patentes

Esto **no se nota el primer día**: hay que dejar pasar una semana.

Lo que tiene que mejorar es **el atardecer**. Hoy entre las 18 y las 19 es
cuando peor lee. Si después de los cambios ves que a esa hora las patentes
salen bien, el obturador hizo su trabajo.

Y deberías ver **muchas menos tarjetas para descartar**. Hoy descartás más de 3
por cada una que registrás.

---

# Si algo sale mal

**Todo esto se deshace.** Por eso te pedí las fotos al principio.

| Qué pasó                                       | Qué hacer                                                     |
| ---------------------------------------------- | ------------------------------------------------------------- |
| El video se ve muy oscuro de noche             | Subí la **Ganancia** (paso 1.3), o poné el obturador en 1/125 |
| Las patentes salen blancas de noche            | Bajá más la **intensidad del infrarrojo** (paso 1.4)          |
| Se escapan autos que antes detectaba           | Bajá **"Descartar por debajo de"** a 0,50                     |
| Siguen llegando muchas tarjetas para descartar | Subí **"Descartar por debajo de"** a 0,70                     |
| El video se entrecorta                         | Volvé el códec a H.265 (paso 1.2)                             |
| La imagen quedó rara al mediodía               | Apagá el **WDR** (paso 1.5)                                   |
| La CPU no bajó                                 | Fijate que en la cámara hayan quedado guardados los 12 fps    |

**El orden importa si querés saber qué sirvió:** hacé primero la cámara
(pasos 1.1 y 1.2), medí la computadora, y recién después el resto. Si cambiás
todo junto y algo queda mal, no vas a saber qué fue.

---

# Resumen para imprimir y tener al lado

**En la cámara (Configuración → Vídeo/Audio):**

- Velocidad de fotogramas: **12**
- Codificación de vídeo: **H.264** (sin el "+")

**En la cámara (Configuración → Imagen):**

- Tiempo de exposición / Obturador: **1/250** ⭐ el más importante
- Intensidad del infrarrojo: **50** (y bajar más si las patentes salen blancas)
- WDR: **activado** (opcional)

**En Parkit (Configuración → Cámara → Ajustes):**

- Descartar por debajo de: **0,60**
- Confianza mínima: **0,85**
- Ancho del preview: **960**
