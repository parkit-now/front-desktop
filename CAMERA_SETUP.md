# Instalar una cámara IP para la detección de patentes

Guía para dejar andando una cámara IP (RTSP) con Parkit, y para dejarla segura.
Pensada para hacerse una vez por estacionamiento, en el lugar.

La app también funciona con la webcam del equipo, que es lo cómodo para probar.
Se elige con un switch en la misma pantalla, así que podés dejar la cámara IP
configurada y volver a la webcam cuando quieras sin perder los datos.

---

## Antes de empezar

- La PC y la cámara tienen que estar en **la misma red**. Wifi o cable da igual:
  lo que importa es que cuelguen del mismo router. No hace falta internet — el
  video va directo de la cámara a la PC.
- Necesitás de la cámara: **dirección IP, usuario, contraseña y ruta del stream**.
- Hay que entrar a Parkit **como dueño**. La pantalla de configuración no existe
  para el rol operador.

---

## 1. Preparar la cámara

Desde la app del fabricante (en las EZVIZ no hay panel web: todo se hace desde la
app del celular):

| Opción                | Cómo va         | Por qué                                                                                                                                                                                   |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RTSP**              | **Activado**    | Es el único camino por el que la PC recibe el video sin pasar por la nube. Si lo desactivás, Parkit no puede ver nada.                                                                    |
| **Cifrado de imagen** | **Desactivado** | Cifra el stream con el código de verificación y ningún cliente externo puede decodificarlo. Con esto prendido la cámara conecta pero no entrega video — es el error más confuso de todos. |

> **Ojo con la intuición.** Suena razonable prender el cifrado y apagar RTSP "por
> seguridad", y es exactamente al revés: el cifrado de imagen protege el camino
> hacia la nube del fabricante, no tu red, y RTSP es el camino que **no** sale de
> tu red. La seguridad se consigue con los pasos de la sección 6.

Anotá la **ruta del stream**, que cambia según la marca:

| Marca     | Ruta                                                        |
| --------- | ----------------------------------------------------------- |
| EZVIZ     | `/h264_stream`                                              |
| Hikvision | `/Streaming/Channels/101` (principal) · `/102` (secundario) |
| Dahua     | `/cam/realmonitor?channel=1&subtype=0`                      |

Usá siempre el stream **principal**: el secundario baja la resolución y ahí se
pierden justo los píxeles de la patente.

Si la cámara conecta pero no se ve imagen, el sospechoso número uno es esta ruta,
y el número dos el cifrado.

**Poné el códec en H.264 puro**, no en H.265+ ni H.264+. Los "+" son variantes
propietarias con GOP largo: rinden para grabar y molestan acá, donde tomamos
frames sueltos en tiempo real. Con GOP largo, un paquete perdido arrastra
artefactos varios segundos — justo sobre la patente.

---

## 2. Cargarla en Parkit

Sidebar → **Configurar cámara** (última opción, solo visible para el dueño).

1. Apagá el switch **"Usar la webcam de esta computadora"**.
2. Completá:

   | Campo           | Ejemplo             | De dónde sale                                                                          |
   | --------------- | ------------------- | -------------------------------------------------------------------------------------- |
   | Dirección IP    | `192.168.1.26`      | La app de la cámara, o el listado de dispositivos del router                           |
   | Puerto          | `554`               | El estándar de RTSP; casi nunca cambia                                                 |
   | Usuario         | `admin`             | El de la cámara                                                                        |
   | Contraseña      | —                   | En las EZVIZ suele ser el **código de verificación** impreso en la etiqueta del equipo |
   | Ruta del stream | `/h264_stream`      | Según la marca                                                                         |
   | Identificador   | `entrada-principal` | Lo elegís vos, ver abajo                                                               |

3. **Probar conexión.** Si da verde, muestra la resolución del video.
4. **Guardar y reconectar.** El video cambia sin reiniciar la app; se ve en la
   pantalla _Cámara_.

**Sobre el identificador**: viaja en cada detección de patente y queda en el
historial, así que conviene un nombre que te sirva ("entrada-principal",
"porton-rivadavia") y no el `cam-01` genérico. Si lo cambiás después, las
detecciones viejas conservan el anterior — no se reescriben.

La configuración queda **en ese equipo**, cifrada con el almacén de credenciales
del sistema operativo. No viaja al servidor: una IP `192.168.x.x` solo tiene
sentido dentro de esa red, y la contraseña de la cámara no gana nada estando en
la nube.

Sobrevive a cerrar y abrir la aplicación: al arrancar se le reaplica sola al
servicio de detección, tanto la cámara como los ajustes de la sección 4.

---

## 3. Dónde montarla

Dos restricciones que tiran para lados opuestos: **cerca sobran píxeles pero la
cámara mira demasiado picado; lejos el ángulo mejora pero falta resolución.** La
zona útil es donde se cruzan.

Con una cámara de 4 MP a 2,4 m de altura, lente de 2,8 mm:

| Distancia al auto | Píxeles en la patente | Inclinación            |
| ----------------- | --------------------- | ---------------------- |
| 2 m               | 156                   | 43° ✗ demasiado picada |
| 3 m               | 122                   | 32° ⚠                  |
| **3,5 - 4 m**     | **110 - 98**          | **28 - 25°** ✓         |
| 5 m               | 81 ✗                  | 21°                    |

Para leer bien querés **~100 px de ancho de patente y menos de 30° de
inclinación**. Con lente de 4 mm la ventana se corre a 4-6 m y da más margen,
pero necesita más distancia para cubrir el ancho del portón.

Reglas prácticas:

- **Apuntala hacia donde vienen los autos, no al piso.** El objetivo es leer
  mientras se acercan, no cuando ya están debajo.
- **Centrala respecto del portón.** Un auto corrido al costado se ve de perfil y
  el OCR confunde caracteres; centrada, el giro baja a menos de 20°.
- **Modo IR de noche, no luz blanca.** Las patentes son retrorreflectivas:
  devuelven el infrarrojo con muchísimo contraste y no encandilás a nadie.

## 4. Calibrar la detección

Todo esto se ajusta desde la misma pantalla, con el video en vivo al lado. Nada
requiere reiniciar: se aplica al guardar.

### La zona de detección (lo más importante)

Arrastrá un rectángulo sobre el video para marcar **la boca del portón**. Fuera
de esa zona no se analiza nada.

No es un detalle de rendimiento, es lo que evita registrar ingresos falsos. Si
enfrente hay autos estacionados o pasa tránsito, sus patentes entran en cuadro y
son perfectamente legibles — y el reconocimiento se queda con **la patente de
mayor confianza del cuadro**, que bien puede ser la de un auto estacionado y
quieto en vez de la del que está entrando.

El botón "Usar todo el cuadro" la borra.

### Los ajustes de detección

| Ajuste                     | Para qué                                      | Cuándo tocarlo                                                                |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Segundos entre análisis    | Cuántas veces se mira a un auto que se acerca | Bajalo a ~1 si los autos entran rápido: con 3 s puede tocarle un solo intento |
| Sensibilidad al movimiento | Qué cuenta como movimiento                    | Subilo si dispara solo con sombras o lluvia                                   |
| Confianza mínima           | Debajo de esto la lectura se marca dudosa     | Subilo si aparecen lecturas basura                                            |
| Segundos antes de repetir  | Evita registrar dos veces el mismo auto       | Subilo si el mismo auto entra duplicado                                       |

Detrás de "Mostrar ajustes avanzados" quedan los del agrupamiento de lecturas, el
watchdog y la calidad del preview. Se tocan raro.

## 5. Que la IP no se mueva

Una cámara con IP por DHCP puede volver con otra dirección después de un corte de
luz o un reinicio del router. Cuando pasa, Parkit dice "no se pudo conectar" sin
que nadie haya tocado nada — y es de los problemas que más tiempo hacen perder
porque no hay ningún cambio que lo explique.

Dos formas de evitarlo, con que hagas una alcanza:

- **Desde la app de la cámara**: Configuración → Red → IP estática. No todos los
  modelos lo ofrecen.
- **Desde el router**: reserva DHCP por MAC. Buscá "DHCP Reservation", "Address
  Reservation" o "Static Lease". Es lo más prolijo, porque además el router deja
  de ofrecerle esa IP a otro dispositivo.

Para la reserva necesitás la MAC de la cámara. Desde la PC, con la cámara
prendida:

```bash
ping -c1 192.168.1.26 >/dev/null && ip neigh show 192.168.1.26
```

---

## 6. Dejarla segura

El objetivo: **que estando en la red y con la clave se vea la imagen, y de otra
forma no.**

### 6.1 Cortarle internet a la cámara (opcional, según tu criterio)

Una cámara de marca mantiene un canal abierto contra la nube del fabricante: es
lo que te permite verla desde el celular estando afuera. El canal va cifrado, y
el video sale cuando mirás en remoto o si tenés grabación en la nube contratada
— no es un streaming permanente.

Ahí hay una decisión, no una respuesta única:

- **Si alcanza con que vaya cifrado**, no hay nada que hacer.
- **Si el requisito es que la imagen no salga de la red**, la única forma de
  garantizarlo es negarle salida a internet en el router (control parental /
  filtrado por MAC / access control), dejándole la LAN. La cámara le sigue
  sirviendo RTSP a Parkit y la app del celular deja de verla desde afuera.

En una playa real, con patentes de clientes y video de la vía pública, esta
decisión merece pensarse mejor que en una prueba de escritorio.

### 6.2 Que no quede publicada a internet

En el router:

- **Apagá UPnP.** Es el mecanismo por el que un dispositivo se auto-publica a
  internet sin que nadie se lo pida. Suele estar en Avanzado o NAT.
- Revisá **Port forwarding** / "Virtual server": que no haya nada apuntando a los
  puertos 554, 8000 ni 9010 de la cámara.

Para comprobarlo desde afuera: con el celular **sin wifi**, en datos móviles,
probá tu IP pública en el puerto 554. Si no responde, no hay nada expuesto.

### 6.3 Lo que ya te protege

- **La clave del wifi es, en los hechos, la primera puerta.** Quien esté adentro
  de la red puede al menos hablarle a la cámara.
- **La contraseña de la cámara es la segunda.** Verificá que use autenticación
  **Digest** y no solo Basic: con Digest la contraseña no viaja por la red, va un
  hash con un nonce distinto por sesión. Se comprueba así:

  ```bash
  printf 'DESCRIBE rtsp://CAMARA:554/h264_stream RTSP/1.0\r\nCSeq: 1\r\n\r\n' \
    | timeout 5 nc CAMARA 554 | grep WWW-Authenticate
  ```

  Si aparece `Digest`, estás bien. Si solo apareciera `Basic`, la contraseña
  viaja en claro y cualquiera con la clave del wifi puede capturarla.

---

## 7. Cuando algo no anda

### El panel dice…

| Mensaje                                   | Qué pasa                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| "No se pudo conectar"                     | IP, puerto, usuario o contraseña mal, o la cámara apagada. También aparece si le cambió la IP — ver sección 5 |
| "Conecta pero no entrega video"           | Ruta del stream equivocada, o **cifrado de imagen activado** en la cámara                                     |
| "El servicio de cámara no está corriendo" | Reiniciá la aplicación                                                                                        |
| "Conectando…" en la pantalla Cámara       | Normal en los primeros segundos: una cámara IP tarda más en abrir que una webcam                              |

### Registra autos que nunca entraron

Está leyendo patentes de la calle: autos estacionados enfrente o que pasan. No
es un error de lectura — están dentro del cuadro y se leen bien.

Se arregla con **la zona de detección** (sección 4): marcá solo la boca del
portón. Es el motivo principal por el que esa zona existe.

### Ver el video pero no detectar patentes

Son dos cosas distintas. El servicio escribe un log que lo dice:

```
motion → scanning...  (calls=47, saved=2)
POST /process 404     ← no había patente en ese frame. NORMAL
DETECTED  AB 123 CD   ← se guardó y quedó pendiente en el panel Operativo
```

El número a mirar es **`saved=N`**. Si crece, funciona. Los 404 son la respuesta
normal cuando no hay nada que leer; con la cámara apuntando a la calle vas a ver
muchos.

Si `saved` se queda clavado en 0 con la cámara bien apuntada, revisá que el
servicio de LPR esté vivo:

```bash
curl localhost:8765/health     # LPR
curl localhost:8766/stream/status   # cámara
```

### Qué expone la cámara en la red

Para ver qué puertos tiene abiertos (útil para el paso 6.2):

```bash
for p in 80 443 554 8000 9010; do
  timeout 2 bash -c "echo > /dev/tcp/CAMARA/$p" 2>/dev/null \
    && echo "$p abierto" || echo "$p cerrado"
done
```

En una EZVIZ típica: `554` es RTSP, `8000` y `9010` son servicios propios del
fabricante, y `80`/`443` están cerrados porque no tiene panel web.

---

## Volver a la webcam

Prendé el switch **"Usar la webcam de esta computadora"**, elegí cuál del
desplegable y guardá. Los datos de la cámara IP quedan guardados, contraseña
incluida: cuando apagues el switch vuelven solos.

Un detalle del desplegable: si ya estás en modo webcam, los nombres reales de las
cámaras no se pueden leer (el sistema no los revela mientras la cámara está en
uso por la detección) y aparecen como "Cámara 1", "Cámara 2". Estando en modo IP
sí se ven los nombres. En cualquier caso, **"Probar conexión" es lo que confirma
cuál es cuál**: el número de cámara es una posición, no una identificación
garantizada.
