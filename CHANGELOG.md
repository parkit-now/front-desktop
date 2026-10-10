# [1.24.0](https://github.com/parkit-now/front-desktop/compare/v1.23.0...v1.24.0) (2026-10-10)


### Features

* **desktop:** agregar vista previa configurable e impresión del cierre de caja ([65e38a1](https://github.com/parkit-now/front-desktop/commit/65e38a149765d822d05e25e2790860f4fc8aafb1))
* **facturacion:** incorporar cuenta ARCA secundaria y emisores externos ([f9123ab](https://github.com/parkit-now/front-desktop/commit/f9123ab768fd7dec3e89ec15b4b34e495f2a1314))

# [1.23.0](https://github.com/parkit-now/front-desktop/compare/v1.22.0...v1.23.0) (2026-10-10)


### Features

* **facturacion:** elegir pagos al facturar un cobro dividido ([30565cb](https://github.com/parkit-now/front-desktop/commit/30565cb6c4e30d7afda0e7872ac7db56a82d0faf))

# [1.22.0](https://github.com/parkit-now/front-desktop/compare/v1.21.0...v1.22.0) (2026-10-10)


### Features

* **invoice:** add invoice status reminder feature and related UI components ([9012a11](https://github.com/parkit-now/front-desktop/commit/9012a118fdbb718a0bdfed7c526b974280c0294e))

# [1.21.0](https://github.com/parkit-now/front-desktop/compare/v1.20.0...v1.21.0) (2026-10-09)


### Bug Fixes

* **camara:** evitar que la sincronización desvincule fotos de ingresos ([78bc5fc](https://github.com/parkit-now/front-desktop/commit/78bc5fc2ac00c30316362f3ff47b3e11b49e4987))


### Features

* **data-table:** implement proportional column widths and fixed layout for DataTable ([c71e0cc](https://github.com/parkit-now/front-desktop/commit/c71e0ccf3aca520f55e4b2a5417f9bb779dfce90))

# [1.20.0](https://github.com/parkit-now/front-desktop/compare/v1.19.0...v1.20.0) (2026-10-09)


### Bug Fixes

* **camara:** el editor de ROI vuelve a recibir el cuadro sin achicar ([cde8da8](https://github.com/parkit-now/front-desktop/commit/cde8da8aa093b7561a52ac67c38840b774d7ad3a))
* **camara:** poder apagar la decodificación por hardware para poder medirla ([6c703d6](https://github.com/parkit-now/front-desktop/commit/6c703d6391a7d41ea27a792a4b1b636b52357951))
* **servicios:** cerrar la app mata de verdad a los dos servicios en Windows ([1fb377f](https://github.com/parkit-now/front-desktop/commit/1fb377fffe48def3d7dea9755ce8ffa6f06db4ac))
* **servicios:** no adoptar un servicio de otra versión tras actualizar ([f96578f](https://github.com/parkit-now/front-desktop/commit/f96578f1dbd6befbb95cd4f785f431115932d131))


### Features

* **facturacion:** agregar factura externa y modo manual con pendiente ([11040c0](https://github.com/parkit-now/front-desktop/commit/11040c0057eb3960951cb90fa7563457595a4675))

# [1.19.0](https://github.com/parkit-now/front-desktop/compare/v1.18.0...v1.19.0) (2026-10-08)


### Bug Fixes

* **desktop:** evitar facturar a consumidor final por omisión al recuperar pagos QR ([cf62167](https://github.com/parkit-now/front-desktop/commit/cf62167d48b8dba2a996197d37fbf2342230075c))


### Features

* **camara:** bajar el CPU a la mitad y cortar el ruido de detecciones ([2d7a0a9](https://github.com/parkit-now/front-desktop/commit/2d7a0a9ea88801a93cca6329d75576a6288e9696))
* **DateRangeFilter:** enhance positioning logic and useLayoutEffect for better performance ([a654446](https://github.com/parkit-now/front-desktop/commit/a654446854855f1a190ff368c405222805788c82))
* **reportes:** panel de estadísticas y auditoría en el desktop ([30438a5](https://github.com/parkit-now/front-desktop/commit/30438a50f1415ee5d31f903a7fb96e163e31db82))

# [1.18.0](https://github.com/parkit-now/front-desktop/compare/v1.17.0...v1.18.0) (2026-10-08)


### Features

* enhance DetectionImageDialog with tenantId and accessToken props ([3ffd74a](https://github.com/parkit-now/front-desktop/commit/3ffd74a47c09dde863be34e2665cff4164ecd347))
* implement Mercado Pago QR payment recovery and enhance exit payment handling ([0f7facb](https://github.com/parkit-now/front-desktop/commit/0f7facb5dd249e25bca712e9bd72e8286613ab84))

# [1.17.0](https://github.com/parkit-now/front-desktop/compare/v1.16.0...v1.17.0) (2026-10-08)


### Features

* **data-table:** enhance column visibility management and add filter-only functionality ([f2017d2](https://github.com/parkit-now/front-desktop/commit/f2017d2a3fbfe67daaae12c0c32033cd9e135646))

# [1.16.0](https://github.com/parkit-now/front-desktop/compare/v1.15.0...v1.16.0) (2026-10-08)


### Features

* **clientes:** gestionar fichas y mostrar contactos al facturar ([1802e5e](https://github.com/parkit-now/front-desktop/commit/1802e5e4b5d652cab524baaeece4de4391cacec8))
* implement discard all detections functionality with confirmation dialog and toast notifications ([7a3e205](https://github.com/parkit-now/front-desktop/commit/7a3e205d177d5e1b14b48846a27bcc9081e0e855))
* update invoice status handling and improve documentation for payment methods ([aff32e9](https://github.com/parkit-now/front-desktop/commit/aff32e9d2e768036884acaa658d4171526f2fa0b))

# [1.15.0](https://github.com/parkit-now/front-desktop/compare/v1.14.0...v1.15.0) (2026-10-08)


### Features

* add Excel export functionality to DataTable ([9aa3e79](https://github.com/parkit-now/front-desktop/commit/9aa3e79ae633dec741c23aa6645473b2582820fc))
* add InlineEntryField component for editable fields in entry dialogs ([c602da8](https://github.com/parkit-now/front-desktop/commit/c602da828c0247feae5b828c82c7b4144e7cfd8b))
* **api-types:** add manualInvoiceNumber field to components for invoice tracking ([399f9ef](https://github.com/parkit-now/front-desktop/commit/399f9efec89a4362997d30238a39eb01f65b307a))
* **cash-session:** refactor cash session components and add movements dialog ([6734d77](https://github.com/parkit-now/front-desktop/commit/6734d770db8b0201af55eea7495804f651388823))
* **data-table:** add dateTimeSorting utility and apply to relevant components ([9c183f9](https://github.com/parkit-now/front-desktop/commit/9c183f9241c3c7401c9934696216af43cf9d96e3))
* **data-table:** add VehicleCell component and enhance vehicle display in tables ([9b824b9](https://github.com/parkit-now/front-desktop/commit/9b824b977d26e6f4f3d66021ef5b767634bcda5d))
* **facturacion:** autocompletar el CUIT del pagador QR al cobrar y facturar ([7b6fd15](https://github.com/parkit-now/front-desktop/commit/7b6fd15f6c188037357e356fa183d00847195a02))
* implement entry deletion functionality with confirmation dialog ([7e0f499](https://github.com/parkit-now/front-desktop/commit/7e0f499203133a087210d5deebbdd2f10087f0e4))
* **invoice-confirmation:** implement useInvoiceConfirmation hook for managing invoice issuance and preview ([9d09e36](https://github.com/parkit-now/front-desktop/commit/9d09e3656d7b146fd601cf3468da559ca1a57893))
* **invoice-history:** implement invoice history refresh functionality and related tests ([0e6b39c](https://github.com/parkit-now/front-desktop/commit/0e6b39c238fb0f965e5aeec36ed601c26217bdfd))
* **invoice:** update PDF filename format and handle missing data gracefully ([d04afe4](https://github.com/parkit-now/front-desktop/commit/d04afe4d929dce313cd66a27ae9cfe3c5b292549))
* **saved-files:** implement functionality to remember and show saved files in folder ([8a19fb7](https://github.com/parkit-now/front-desktop/commit/8a19fb78a4c86cf7dd39ba387d558dabd3b70f05))
* **SessionView:** enhance workspace content styling for history section ([d68f30a](https://github.com/parkit-now/front-desktop/commit/d68f30a567c0f971c342e45d9e76f06170e857b0))

# [1.14.0](https://github.com/parkit-now/front-desktop/compare/v1.13.0...v1.14.0) (2026-10-06)


### Features

* **lista blanca:** se agregó la lista blanca de patentes por estacionamiento ([0050152](https://github.com/parkit-now/front-desktop/commit/00501522e56a313f09adbc7cdfa46f0c33c745eb))

# [1.13.0](https://github.com/parkit-now/front-desktop/compare/v1.12.0...v1.13.0) (2026-10-06)


### Features

* **auto-entries:** add parking details to AutoEntriesColumns and AutoEntryCard components ([c9c58ab](https://github.com/parkit-now/front-desktop/commit/c9c58ab4b4b1c9dcde45fdfd5772fe180807c9ca))
* **factura:** al egresar un vehículo se autocompleta el cuit usado para la última factura a esa patente ([caa72f0](https://github.com/parkit-now/front-desktop/commit/caa72f037b244a83fbc36bc53ca70d07ee494035))

# [1.12.0](https://github.com/parkit-now/front-desktop/compare/v1.11.0...v1.12.0) (2026-10-06)


### Features

* **camera-settings:** add password visibility toggle and style adjustments ([3688e92](https://github.com/parkit-now/front-desktop/commit/3688e92ecb05908c57bc43d5167b9d1ff23da9f3))

# [1.11.0](https://github.com/parkit-now/front-desktop/compare/v1.10.0...v1.11.0) (2026-10-06)


### Bug Fixes

* **panel-operativo:** se invirtió el orden de reservas y egresos y se mejoró el ingreso para autocompletado del tip de vehiculo ([f16c564](https://github.com/parkit-now/front-desktop/commit/f16c56440696cb966e86e390503fe7c4e2b02762))


### Features

* **active-vehicles-dialog:** add photo detection feature and enhance entry display ([4530658](https://github.com/parkit-now/front-desktop/commit/4530658e2dc630b3be6e7344287a9916e0b9b90b))
* **advertencias y cambios de UX + reinicio de servicios desde config de cámara:** Advertencias Globales En Header Desktop (camara, camara service, lpr service fuera de sevicio) ([96d6aba](https://github.com/parkit-now/front-desktop/commit/96d6aba4549d5365177f4791d11a12025aba4eb4))
* **egreso:** se autocompleta el monto al bajar un auto de la db ([d3b8cb1](https://github.com/parkit-now/front-desktop/commit/d3b8cb15439c2477c032ed3f666d9ee2f23beb94))
* **entry-edit-dialog:** add ticket number display to entry edit form ([b576d6f](https://github.com/parkit-now/front-desktop/commit/b576d6fb3db228de2d84e15401860fff362a4078))
* **entry-history-panel:** enhance invoice display with improved layout and additional information ([f6fd4d7](https://github.com/parkit-now/front-desktop/commit/f6fd4d7060b990c4b54bfd19c369481dcc16f62d))
* **entry-history-panel:** update invoice state and letter filter options to reflect available entries ([32ecc38](https://github.com/parkit-now/front-desktop/commit/32ecc38252505d5099a1c65be4db4b8950981162))
* **reservation-service:** implement reservation service availability checks and related hooks ([f394509](https://github.com/parkit-now/front-desktop/commit/f3945095fa7b9a35072950b09f4188a23f2d3f39))
* **session-view:** add camera settings toggle and update styles for workspace header ([0a7d0b3](https://github.com/parkit-now/front-desktop/commit/0a7d0b32829e5b504e1378061ddc7975a4ff078b))

# [1.10.0](https://github.com/parkit-now/front-desktop/compare/v1.9.0...v1.10.0) (2026-10-04)


### Bug Fixes

* **camara:** ya no se abre una nueva conexion a la camara cada vez que se entra a esa tab ([81a9389](https://github.com/parkit-now/front-desktop/commit/81a9389dbd6fed163d47bec0c438e015747074a2))
* **impresora:** nuevo driver generico para impresoras termicas ([a143a59](https://github.com/parkit-now/front-desktop/commit/a143a59197a80f565132fb51036430accf450ac6))


### Features

* **refinement:** implement second detection pass to improve license plate recognition accuracy ([c0f3fe8](https://github.com/parkit-now/front-desktop/commit/c0f3fe8ce70186c2f9ee8e3865864a9ec5e95cc4))
* **testing-mode:** implement camera testing mode to display all detections without suppression ([20a908f](https://github.com/parkit-now/front-desktop/commit/20a908fa41ee87854b98eab8ebd41ef4020ac63c))

# [1.9.0](https://github.com/parkit-now/front-desktop/compare/v1.8.0...v1.9.0) (2026-10-04)


### Features

* **desktop:** correcciones de la revisión general ([75d68a9](https://github.com/parkit-now/front-desktop/commit/75d68a9abfdad1838c8e61f8090fba8dde36c6cc))

# [1.8.0](https://github.com/parkit-now/front-desktop/compare/v1.7.0...v1.8.0) (2026-10-04)


### Bug Fixes

* **egresos:** la salida con reserva separa la reserva del cobro, con chip de llegada y montos alineados; el modal scrollea si no entra ([9e471f5](https://github.com/parkit-now/front-desktop/commit/9e471f53f7b1ea1a72236d36911f4103c0a73e36))
* **ingresos:** el aviso de reserva más tarde dice hoy o mañana (campo upcoming, próximas 24 h) ([4a02cd8](https://github.com/parkit-now/front-desktop/commit/4a02cd81a97fa0309c8993a0adc954874d555aa7))
* **reservas:** aclarar quién canceló en el chip de estado ([5083c78](https://github.com/parkit-now/front-desktop/commit/5083c78eb8ee234539596da5f416868bc3f9c9f2))
* **reservas:** el diálogo de rechazo resuelto en otro lado no pide motivo ([2846c62](https://github.com/parkit-now/front-desktop/commit/2846c62b15fafae352f527327a36e667aade87f5))
* **sync:** el banner sin conexión no estira el encabezado de la sección ([3af6ea9](https://github.com/parkit-now/front-desktop/commit/3af6ea97a00ef476c7c491689d8240b791c47e00))


### Features

* **cobro:** excedente de una estadía con reserva prepaga ([49634b6](https://github.com/parkit-now/front-desktop/commit/49634b655cfc7b8273f2022b70abfa6f4ec82e8e))
* **desktop:** ejemplo bajo el campo de email del registro ([1d23866](https://github.com/parkit-now/front-desktop/commit/1d238664c4b5f4331be3a2a9c7ab5e1b4a23ac61))
* **desktop:** extraer PasswordInput con botón para ver la contraseña ([466c4a9](https://github.com/parkit-now/front-desktop/commit/466c4a9001466f838565cb412a0292db39f7268d))
* **desktop:** pedir nombre y apellido en el registro ([85f39a6](https://github.com/parkit-now/front-desktop/commit/85f39a6e850ae7fe819eb6df55e33817cbafcd3a))
* **desktop:** pedir repetir contraseña y ver contraseña en el registro ([bccd86a](https://github.com/parkit-now/front-desktop/commit/bccd86a4f2cb96ca681b352d4e3d9d0c5d0493f7))
* **desktop:** validar la repetición de contraseña en el registro ([ad8e120](https://github.com/parkit-now/front-desktop/commit/ad8e120deff2d2e5e9ec7c9223ffa58873cd5c33))
* **desktop:** validar nombre y apellido en el registro ([463ecfa](https://github.com/parkit-now/front-desktop/commit/463ecfaa3ae1972964f2192a1924eddcff863c74))
* **egresos:** con reserva se cobra sólo el excedente ([78279fc](https://github.com/parkit-now/front-desktop/commit/78279fce2d3cc26e146e3383d35af326199bd9f2))
* **egresos:** desglose de tiempo reservado y tiempo extra al salir con reserva ([fd376f1](https://github.com/parkit-now/front-desktop/commit/fd376f13a0cefd013d6c04e0247a22e4c980c7ea))
* **ingresos:** banner "Tiene reserva" al cargar la patente ([182fbb4](https://github.com/parkit-now/front-desktop/commit/182fbb45a39ecce8ae61e36ff4286f869a7ff806))
* **ingresos:** el banner avisa si llega antes o tarde, y si la reserva de hoy todavía no se vincula ([f8d36c4](https://github.com/parkit-now/front-desktop/commit/f8d36c40a892507f9cd48885cd857ca5af978f03))
* **ingresos:** el ingreso guarda tipo y categoría y avisa si no se acepta en caja ([8a25624](https://github.com/parkit-now/front-desktop/commit/8a256240da2348a1f793e722321e66195c3798bc))
* **reservas:** aceptar y rechazar reservas desde la API de la caja ([99ac2de](https://github.com/parkit-now/front-desktop/commit/99ac2de6ae638d67f8ddb58ac5a131d3febe38b8))
* **reservas:** API para desvincular la reserva y la foto local guarda cómo llegó el auto ([a083e40](https://github.com/parkit-now/front-desktop/commit/a083e40723c70d01d8e1de7f1a922b8d55fa5abc))
* **reservas:** aviso no bloqueante de llegada anticipada o tardía con botón Desvincular ([650a3df](https://github.com/parkit-now/front-desktop/commit/650a3dfd1f7a13670e396aec9e1d191197ed0b76))
* **reservas:** contar sólo las vigentes en el ítem Reservas de hoy y ordenar el modal ([5fc7109](https://github.com/parkit-now/front-desktop/commit/5fc7109d5f4f510c9f75114d9dd2b6fcc204ea4a))
* **reservas:** el chip En curso dice si llegó antes o tarde ([775d7dc](https://github.com/parkit-now/front-desktop/commit/775d7dc1dbde68ddba474ef35d59095b5174a4ca))
* **reservas:** foto local de reservas y aviso de nuevas por aceptar (Dexie v19) ([d03f20c](https://github.com/parkit-now/front-desktop/commit/d03f20c52a014d3609e3b158c6ff79f7657a0719))
* **reservas:** panel "Reservas de hoy" en la caja ([4ef06ce](https://github.com/parkit-now/front-desktop/commit/4ef06cef4607902cc21438c7e7a84d3ed8414aa4))
* **reservas:** Reservas de hoy pasa a un ítem del operativo que abre un modal con detalle y aceptar/rechazar ([3e7539e](https://github.com/parkit-now/front-desktop/commit/3e7539e86a4e9db9ad84044d1cbce004eb8618ce))
* **reservas:** sección Reservas en la caja para aceptar y rechazar ([8936026](https://github.com/parkit-now/front-desktop/commit/89360262ab9e964c32a20bd804bee881f06dbaf7))
* **reservas:** textos de llegada anticipada o tardía, desglose de la salida y reglas para desvincular ([566a1a8](https://github.com/parkit-now/front-desktop/commit/566a1a80cf45fd68118182d162e8efbb44d83166))
* **sync:** ingresos con reserva y prepago en la base local (Dexie v18) ([70dc765](https://github.com/parkit-now/front-desktop/commit/70dc765e2d7c2357c1c979ca29e98b588aae849c))
* **sync:** sincroniza la categoría de los tipos y la lista de categorías ([bcb91e4](https://github.com/parkit-now/front-desktop/commit/bcb91e44a1de53bac3c730bb8d1d79750eb26d11))
* **tipos-de-vehiculo:** pide categoría al crear o editar un tipo ([b989f95](https://github.com/parkit-now/front-desktop/commit/b989f956df42a020bca31d01c33a5c62af652e5a))

# [1.7.0](https://github.com/parkit-now/front-desktop/compare/v1.6.0...v1.7.0) (2026-10-01)


### Features

* **impresión:** se agregó el comprobante no fiscal y más ajustes de impresión ([66d6fb4](https://github.com/parkit-now/front-desktop/commit/66d6fb4df967057441f0739b30a5f956af947a03))

# [1.6.0](https://github.com/parkit-now/front-desktop/compare/v1.5.1...v1.6.0) (2026-10-01)


### Bug Fixes

* **impresora:** los tickets ahora se amoldan al tamaño del driver de la impresora ([9885219](https://github.com/parkit-now/front-desktop/commit/9885219f038e29377d58b05392e1943d1663407e))


### Features

* **facturas:** el PDF de la factura se arma en el desktop ([edd4e7a](https://github.com/parkit-now/front-desktop/commit/edd4e7a8fa7e6277a35b00b0acf4a1a319c088fa))

## [1.5.1](https://github.com/parkit-now/front-desktop/compare/v1.5.0...v1.5.1) (2026-09-28)


### Bug Fixes

* **camara-service:** el servicio de cámara ya no muere al arrancar en Windows ([84e9085](https://github.com/parkit-now/front-desktop/commit/84e9085443b4a364487b5eb6da76eb49bc3a521a))

# [1.5.0](https://github.com/parkit-now/front-desktop/compare/v1.4.0...v1.5.0) (2026-09-28)


### Bug Fixes

* **entries:** en efectivo no se confirma el cobro sin el monto recibido completo ([0d53033](https://github.com/parkit-now/front-desktop/commit/0d53033315d7e43e1473f66235595fd02cda1f43))
* **entries:** medios de pago en orden alfabético al cobrar ([8768692](https://github.com/parkit-now/front-desktop/commit/8768692c630359c50a4ec86f7ed50f1d892354fd))
* **entries:** mensaje corto de la factura en el resumen del egreso ([34b5b45](https://github.com/parkit-now/front-desktop/commit/34b5b45daf2cf16c1ad34dc8723cb9eaf4a7617b))
* **entries:** no duplicar el punto final del motivo de la factura ([1e33f43](https://github.com/parkit-now/front-desktop/commit/1e33f436d615783d65fd9f235e437c9a896a4d12))
* **entries:** resumen del egreso parejo y confirmación antes de emitir la factura ([d3b4070](https://github.com/parkit-now/front-desktop/commit/d3b407066dae574de08602eaed9a5d229925eedb))


### Features

* **arca:** aviso de facturación pausada por certificado vencido ([f4f0296](https://github.com/parkit-now/front-desktop/commit/f4f02967771f270818a317983fcfcb8fe21b3f75))
* botón para ver contraseña en login ([730c56c](https://github.com/parkit-now/front-desktop/commit/730c56c348c08ce29e3b7e960282ccd765972d01))
* **cámara:** una tarjeta por auto y foto completa del vehículo ([36e1dc0](https://github.com/parkit-now/front-desktop/commit/36e1dc020ed80cf63f428f92d413d1908f4f5372))
* **camera:** implement ROI cropping for improved detection accuracy ([17ee7dc](https://github.com/parkit-now/front-desktop/commit/17ee7dc246560d0aefbb39aeb4ac5edacf9de1f9))
* **cobro:** factura con CUIT decidida por el padrón ([79179d4](https://github.com/parkit-now/front-desktop/commit/79179d46215d09016f488790d998b30a33f01edc))
* **data-table:** filtro por rango numérico y columnas ocultas al inicio ([a068016](https://github.com/parkit-now/front-desktop/commit/a0680161a1838d27a7fd2a6502ed1ee41e5bf6a7))
* **electron:** «Guardar como…» por IPC (file:saveAs) ([48d7d34](https://github.com/parkit-now/front-desktop/commit/48d7d343a29162e7e74c9ba78e9d337f0331155e))
* **entries:** elegir factura A o B al cobrar y emitir factura después del cobro ([752b0c8](https://github.com/parkit-now/front-desktop/commit/752b0c824f60dd3804f54b7c5763c528b49d9f3e))
* **entries:** mensaje para la factura que no sale por certificado sin autorizar ([7179610](https://github.com/parkit-now/front-desktop/commit/7179610a344267407d9325d235aae7cf9235c850))
* **entries:** mostrar el resultado de la factura al registrar el egreso ([ea2cc7b](https://github.com/parkit-now/front-desktop/commit/ea2cc7bb5ceaaf0217c7ee9a599f5e159b9aedd0))
* **historial:** facturación en el historial del desktop ([4f36cf4](https://github.com/parkit-now/front-desktop/commit/4f36cf46b88d750a879c5be50d77a7bade28a528))
* **sync:** sincronizar solo y poder curar la base local ([1885868](https://github.com/parkit-now/front-desktop/commit/1885868112df4bd4139422d43aaa3dbcc490efcb))

# [1.4.0](https://github.com/parkit-now/front-desktop/compare/v1.3.0...v1.4.0) (2026-09-22)


### Bug Fixes

* el operador no puede ver cajas anteriores ni historial de ingresos de cajas anteriores ([ecdf76b](https://github.com/parkit-now/front-desktop/commit/ecdf76b8a01be1381e94a43c77daa125b705bb94))


### Features

* ahora la app es más responsive en cualquier tamaño de pantalla ([2e55a2a](https://github.com/parkit-now/front-desktop/commit/2e55a2a63f50e1fc8e86723f7dfa1c5729bc2197))
* ahora se puede editar autos en base. Además se puede buscar por marca y modelo y se mejoró partes del front ([0fa270c](https://github.com/parkit-now/front-desktop/commit/0fa270cab57137279abf5326f1d277b16b2f89ca))
* al cerrar una caja no se inicia la siguiente automáticamente ([84be0b4](https://github.com/parkit-now/front-desktop/commit/84be0b43646adc874676b6833bd0f136a366e69b))
* mejoras en el diseño del panel operativo ([3f9ba43](https://github.com/parkit-now/front-desktop/commit/3f9ba43a6e3c605319ebf3c0e68c90967304d25d))
* se agregó un sistema para configurar qué campos se quieren imprimir en el ticket. Además los campos de configuración de impresion y de cámara del tenant se persisten en el backend ([d95f0ac](https://github.com/parkit-now/front-desktop/commit/d95f0ac5deba0ad7e3802f8c71352860fd53a448))

# [1.3.0](https://github.com/parkit-now/front-desktop/compare/v1.2.0...v1.3.0) (2026-09-21)


### Features

* **egreso:** cobrar con QR de Mercado Pago desde el modal de salida ([66ba7f7](https://github.com/parkit-now/front-desktop/commit/66ba7f7b46538d053d5a7a0711d2697e667a6c91))
* **errores:** traducir los codes de los cobros con QR de Mercado Pago ([eef975e](https://github.com/parkit-now/front-desktop/commit/eef975e3f385526af8afb61ed3cb6c3e6c549a2f))
* **errores:** traducir PAYMENT_INTENT_NOT_CONSUMABLE en el desktop ([6f3459e](https://github.com/parkit-now/front-desktop/commit/6f3459eef1b54d827b667951f8827dec80a8d117))
* **mercado-pago:** agregar el cliente HTTP de los cobros con QR ([c8e68b5](https://github.com/parkit-now/front-desktop/commit/c8e68b5c182fcdd06d6ec3a50330ee095338de43))
* se agregó cámara IP ([b042dcf](https://github.com/parkit-now/front-desktop/commit/b042dcf6ecd8e152193f79ef15b1a6e7f6e65b5e))
* se agregó configuración de cámara completa, tanto para webCam como para cámaras IP ([9e6c527](https://github.com/parkit-now/front-desktop/commit/9e6c527280d36eb705b970c9c059e5b8858b400e))

# [1.2.0](https://github.com/parkit-now/front-desktop/compare/v1.1.1...v1.2.0) (2026-09-21)


### Bug Fixes

* **payment-methods:** impedir marcar como predeterminado un medio integrado ([569f161](https://github.com/parkit-now/front-desktop/commit/569f161f70b3446060af88080d2fe6748f4dde19))
* precommit y pipelines ([5935725](https://github.com/parkit-now/front-desktop/commit/5935725e9950ff80b13c74aa2f1b32c8dc7a01e3))


### Features

* **errores:** traducir los codes de Mercado Pago y medios integrados ([f2bafd2](https://github.com/parkit-now/front-desktop/commit/f2bafd2dfa1ad5da8a2a8bb2ba44b6abe98387ee))
* **errores:** traducir PAYMENT_METHOD_NOT_FOUND en el desktop ([b4a4e98](https://github.com/parkit-now/front-desktop/commit/b4a4e989c10f0e78af445a876f9ad783c07712b3))
* **payment-methods:** marcar los medios integrados como solo lectura ([ec3140b](https://github.com/parkit-now/front-desktop/commit/ec3140b2e83e71a29f6a52d946f31c6705ee0e3b))

## [1.1.1](https://github.com/parkit-now/front-desktop/compare/v1.1.0...v1.1.1) (2026-09-16)


### Bug Fixes

* **release:** trigger desktop release build ([ee50ee1](https://github.com/parkit-now/front-desktop/commit/ee50ee1390918b7cd854a52727b29917406fefbe))

# [1.1.0](https://github.com/parkit-now/front-desktop/compare/v1.0.4...v1.1.0) (2026-09-15)


### Features

* **impresión:** reimpresión de tickets desde el historial ([d7b4d98](https://github.com/parkit-now/front-desktop/commit/d7b4d9802fb70e3be1bbca37534219a31e3a2425))

## [1.0.4](https://github.com/parkit-now/front-desktop/compare/v1.0.3...v1.0.4) (2026-09-14)


### Bug Fixes

* **hooks:** acota prettier del pre-commit a los archivos staged ([69d9189](https://github.com/parkit-now/front-desktop/commit/69d918921de99f5480a366152b83b3ba84566a51))

## [1.0.3](https://github.com/parkit-now/front-desktop/compare/v1.0.2...v1.0.3) (2026-09-14)


### Bug Fixes

* **ci:** agrega .env.test con las variables de Supabase que el suite necesita ([611b458](https://github.com/parkit-now/front-desktop/commit/611b45841cc9690c7129fe141647d6315abf6f21))

## [1.0.2](https://github.com/parkit-now/front-desktop/compare/v1.0.1...v1.0.2) (2026-09-13)


### Bug Fixes

* **arqueo:** contar el efectivo por el tipo del medio y no por su nombre ([3e4e2c8](https://github.com/parkit-now/front-desktop/commit/3e4e2c84b8013929ad75daede88cc6490d6405bc))
* **sync:** no pisar cambios locales pendientes en los pull incrementales ([24f25a5](https://github.com/parkit-now/front-desktop/commit/24f25a5b85b70dcc315163cafffe1772f3963512))

## [1.0.1](https://github.com/parkit-now/front-desktop/compare/v1.0.0...v1.0.1) (2026-09-12)


### Bug Fixes

* **build:** disable electron-builder's own publish auto-detection ([89b17b1](https://github.com/parkit-now/front-desktop/commit/89b17b1a567ff72d1226b912a0d0550173521615))
* **release:** chain the build job inside release.yml, not a tag-triggered workflow ([5256bf9](https://github.com/parkit-now/front-desktop/commit/5256bf988e929fd2a38378d937e82cff5d68ed4e))

# 1.0.0 (2026-09-12)


* feat(vehicles)!: catálogo por estacionamiento y ABM de tipos ([884dc9f](https://github.com/parkit-now/front-desktop/commit/884dc9f94806bdeb33aedefaf6e13a855a1b6352))


### Bug Fixes

* bug introducido por CameraAlert que deformaba toda la pantalla ([7568120](https://github.com/parkit-now/front-desktop/commit/7568120896d867a1f096948c0bd9a75aecea2d88))
* **build:** CSC_IDENTITY_AUTO_DISCOVERY=false + doctor chequea symlinks (win) ([e7af04e](https://github.com/parkit-now/front-desktop/commit/e7af04e870900e131b8db2f110b557fe7bf77a54))
* **build:** forzar wheels en pip + doctor exige Python 3.12 exacto ([eb3d821](https://github.com/parkit-now/front-desktop/commit/eb3d821b10488f398a4e8b1542606778212fa9c1))
* **build:** set vite base to relative path for packaged app ([b27b516](https://github.com/parkit-now/front-desktop/commit/b27b516c56f1de99206cb32e0e60f6a81d664013))
* **build:** stamp propio para deps del venv + .DELETE_ON_ERROR ([f072a7f](https://github.com/parkit-now/front-desktop/commit/f072a7f5d3aeb80cee58c2ee92c9298845db4893))
* **build:** usar `python -m pip` en vez del wrapper pip ([655623e](https://github.com/parkit-now/front-desktop/commit/655623e2a4c636de779e5751e5d83aac42e0dd71))
* **build:** venv cross-plataforma en Makefiles de servicios ([2ec5004](https://github.com/parkit-now/front-desktop/commit/2ec5004cf6b0b3c4b358c2e11cd6d8abbf44e114))
* cambios estéticos ([8061680](https://github.com/parkit-now/front-desktop/commit/8061680472ef85f9da8f68d85136e2d66fe910eb))
* **camera:** keep capture thread alive when camera absent at startup ([cc8f60d](https://github.com/parkit-now/front-desktop/commit/cc8f60d21bd8ad20164115fde4dc78ac44f16cba))
* **camera:** pin numpy and include it in PyInstaller bundle ([a6679bb](https://github.com/parkit-now/front-desktop/commit/a6679bb5e9d04ab9a90cb32e1d83c7931ef0044d))
* **camera:** stale-frame guard, motion reset on reconnect, resource leak ([cea6344](https://github.com/parkit-now/front-desktop/commit/cea6344482902ddb87c2f9f0aeef3dcdb2b7b056))
* **camera:** stop resending imageStoragePath/imageUrl on upsert ([3e1be54](https://github.com/parkit-now/front-desktop/commit/3e1be54877fe9f480a1cec5277d8299ae09633d7)), closes [#15](https://github.com/parkit-now/front-desktop/issues/15)
* **camera:** use result['plate'] in storage and null _cap after stop ([64400bb](https://github.com/parkit-now/front-desktop/commit/64400bbc9c5c32bcf4aac15047ca3c62a0e09faf))
* **camera:** validate imwrite result and persist event_id in captures ([cfa8e5e](https://github.com/parkit-now/front-desktop/commit/cfa8e5e6123e64006543bfaeb3545e5d2d3c6426))
* **ci:** resolve leftover merge markers ([65edab4](https://github.com/parkit-now/front-desktop/commit/65edab40b6d8679d2471540f07f427f95da19376))
* **desktop:** patient startup wait for slow-booting sidecars ([1f84418](https://github.com/parkit-now/front-desktop/commit/1f84418066e9bd7721f94c92047050f78e1235a5))
* **desktop:** social login via parkit:// deep link + CJS preload ([4a79fc3](https://github.com/parkit-now/front-desktop/commit/4a79fc3f5a9b05a2acf6c5dd984692cae54a6a91))
* **docs:** improve formatting of userData paths in README and package.json ([5266576](https://github.com/parkit-now/front-desktop/commit/52665764c9cc90c021a2280dbdf8ad26ff037483))
* el confirmar un cobro ya no es necesario escribir el monto recibido. Con simplemente tocar enter se asume que se pagó justo ([158939a](https://github.com/parkit-now/front-desktop/commit/158939a0c0c0e827052f9e22cd074a9a2928e9c5))
* **electron:** spawn error handler, crash IPC, and pack preflight ([18e5e31](https://github.com/parkit-now/front-desktop/commit/18e5e312f5adf340e1a6595891f1127d6d12db39))
* **electron:** writable storage paths and service health IPC ([00c0492](https://github.com/parkit-now/front-desktop/commit/00c0492cdff934cf837db647df749d543e4762ad))
* **entries:** el catálogo de vehículos deja de depender de una lista hardcodeada ([c3e8859](https://github.com/parkit-now/front-desktop/commit/c3e88595d88e49d66f871f11f41a2152a0da00f0))
* **i18n:** ortografía española en UI (tildes, ñ, signos, voseo) ([ef57569](https://github.com/parkit-now/front-desktop/commit/ef57569d59e9b8bbb2fc3d27b472145436d14dff))
* los ingresos detectados sin confirmar o descartar ya no aparecen como cambios pendientes de sincronización ([3100cf7](https://github.com/parkit-now/front-desktop/commit/3100cf70113d9224a449347ba0fb3d657b2349e5))
* **lpr:** correct image upload api type ([9a82379](https://github.com/parkit-now/front-desktop/commit/9a82379aa7b788e22b84e9269dad94e9c159fb62))
* **lpr:** skip suppressed duplicate image uploads ([f7b7f23](https://github.com/parkit-now/front-desktop/commit/f7b7f2397d6e18f3bdb2a7cfe3ec763d1d99ca9a))
* model working fix to allow system to download and work ([d6372ab](https://github.com/parkit-now/front-desktop/commit/d6372abd00916e04c62ddedcac4d0db7314ea0d3))
* no se permite que un mismo vehículo (patente) esté 2 veces en la base activa ([b87f9d8](https://github.com/parkit-now/front-desktop/commit/b87f9d8333d1b37d8d85140463e13ebe09ae509e))
* normalización de scroll bars ([8952bb0](https://github.com/parkit-now/front-desktop/commit/8952bb06246f307cc0125f2a9104e75f9a5a704f))
* scroll bar en ingreso/egreso del panel operativo ([4a1f4ef](https://github.com/parkit-now/front-desktop/commit/4a1f4effd9e25beb18ed9b5ea331f81c9bb9a3d3))
* **services:** graceful shutdown for local Python microservices ([5067771](https://github.com/parkit-now/front-desktop/commit/506777185522721a40d5d414d462244e62664f1a))
* **sync:** la baja de tasas offline ya no queda marcada como fallida ([66ad012](https://github.com/parkit-now/front-desktop/commit/66ad012e8dd8c18f2c9f5ee586354ae0a55e653f))
* **sync:** procesar las bajas de tasas en el pull incremental ([0a7d88c](https://github.com/parkit-now/front-desktop/commit/0a7d88cf6d34c938acf7f3769cce8514cf68352e))
* **sync:** stop re-uploading LPR images purged by retention ([bbe3e45](https://github.com/parkit-now/front-desktop/commit/bbe3e45cdc638222944a0687a4ec962f8c9ffade))
* **ui:** el desplegable ya no se cierra al scrollear sus propias opciones ([3db265b](https://github.com/parkit-now/front-desktop/commit/3db265b601ee4f8dffe8d1b63aec9aebadf5633d))
* **ui:** live elapsed time in CameraAlert, unsubscribe for onServiceCrashed, Set for failed ([560cd9e](https://github.com/parkit-now/front-desktop/commit/560cd9e4473569a2c6d70e3709cae4448e2c9e99))


### Features

* add color constants, enhance local database schema, and implement AppSelect component ([dc45c65](https://github.com/parkit-now/front-desktop/commit/dc45c65b89f25da005f86b1caafb7cbd8fad371e))
* add ConfirmDialog component with customizable variants and actions ([b85af35](https://github.com/parkit-now/front-desktop/commit/b85af35191851f69b1353d4a18cdd8d34fd35f46))
* add offline  and sync button ([e2432b6](https://github.com/parkit-now/front-desktop/commit/e2432b663afdef9cff604e79e2d9ee1c5b093a6e))
* ahora de ingreso en card de detecciones automáticas ([711f181](https://github.com/parkit-now/front-desktop/commit/711f181b1d5eaf81ca1e4e1ab09d9ffa066ce3c9))
* ahora el historial permite filtrar por caja actual y por vehículos en base ([cd5a47f](https://github.com/parkit-now/front-desktop/commit/cd5a47f76a741c7f638728d3687bd6d335c6d669))
* **api:** add rates and users API endpoints; ([bc3bea5](https://github.com/parkit-now/front-desktop/commit/bc3bea5c4dd36918e97051f31c7d26f661e3c383))
* **auth:** adapt register and role model to global admin|user ([22eb8ca](https://github.com/parkit-now/front-desktop/commit/22eb8ca246dbb34ac3cab24dde02429040181151))
* **auth:** add forgot password request flow ([7c215de](https://github.com/parkit-now/front-desktop/commit/7c215de1b05491b39616b7b71f9d57e482caf821))
* **auth:** conectar login/register/logout con backend Parkit ([5b7cce8](https://github.com/parkit-now/front-desktop/commit/5b7cce8b9f5ad44258617fe22f64be134ff9d90f))
* **auth:** manejo de errores con toasts + inline field errors ([6ea3ff8](https://github.com/parkit-now/front-desktop/commit/6ea3ff89027fd9bf116ca4e551a44a49cfea49fa))
* **auth:** translate entity role codes and role labels ([1b6601d](https://github.com/parkit-now/front-desktop/commit/1b6601ddd7de7c6593a66b4e37e8a40c4fa71cd1))
* **build:** `make doctor` — preflight de entorno antes de dist-<os> ([c73a33d](https://github.com/parkit-now/front-desktop/commit/c73a33d20241ca448eafeb0816221d463cb21dde))
* **build:** soporte real de empaquetado multi-SO (mac/win/linux) ([39ffeef](https://github.com/parkit-now/front-desktop/commit/39ffeef4a1b66efadc752ffb79de52d6d2962a96))
* caja y cierre de caja ([4733c5f](https://github.com/parkit-now/front-desktop/commit/4733c5faff55b8d455a8248faf5c34191256979e))
* **camera:** add detections history endpoint and clear latest detection ([81e60c8](https://github.com/parkit-now/front-desktop/commit/81e60c803a5fdf4b7105959773e70dd39d1ec1d3))
* **camera:** add LPR HTTP client ([b2b8067](https://github.com/parkit-now/front-desktop/commit/b2b806718f79d43d916a2a9b623703244d8f8a41))
* **camera:** add minimum confidence and cooldown settings to environment variables ([9fb84e5](https://github.com/parkit-now/front-desktop/commit/9fb84e505ce094c0ee5d5e83fdc3ffbd2ff9e0d3))
* **camera:** add threaded camera capture via OpenCV ([47d03fb](https://github.com/parkit-now/front-desktop/commit/47d03fb17c5bca625addfdb714f9396e255b6d64))
* **camera:** add watchdog with backoff and wire full service lifecycle ([7f95ff0](https://github.com/parkit-now/front-desktop/commit/7f95ff0b4cd4b022c8b12ecca5db3c7785432f7f))
* **camera:** alert banner when camera is down for over 1 minute ([4896e1c](https://github.com/parkit-now/front-desktop/commit/4896e1c8c5ca4562fd8f1337700df8dd90f2d3bc))
* **camera:** expose last plate detection via GET /detection/latest ([5f5f709](https://github.com/parkit-now/front-desktop/commit/5f5f70981d82b99c32a6b7c8ee99e40be2eff241))
* **camera:** implement local image storage and SQLite metadata persistence for testing ([c5130f2](https://github.com/parkit-now/front-desktop/commit/c5130f287e9f43aaee6868a488e88687f92dc8eb))
* **camera:** implement ServiceManager for managing microservices lifecycle ([0c8bdc2](https://github.com/parkit-now/front-desktop/commit/0c8bdc2ff029ab18699e35398603bf9467a3e1f3))
* **camera:** replace polling with motion-triggered LPR pipeline ([28a004c](https://github.com/parkit-now/front-desktop/commit/28a004c195b884fc4a6b2147be4bedd39527c03f))
* **camera:** scaffold camera service ([86268c4](https://github.com/parkit-now/front-desktop/commit/86268c4e5764aa466721ee44ecc70e0bde135799))
* **desktop:** admin picks a lot from GET /admin/parkings ([1382bf6](https://github.com/parkit-now/front-desktop/commit/1382bf6e2dabdbfd0f0e84aa54f8fd1b7d483e87))
* **desktop:** adopt an already-running sidecar instead of failing on EADDRINUSE ([9b64f52](https://github.com/parkit-now/front-desktop/commit/9b64f52e7ff55053bc9c92ce33ffa813b2485f8a))
* **desktop:** resolve the sidecar runtime from config, not app.isPackaged ([b86e037](https://github.com/parkit-now/front-desktop/commit/b86e0373c5c125b4813297d590712b3514038fde))
* empty files for lpr added ([00c05a2](https://github.com/parkit-now/front-desktop/commit/00c05a2195b6782d97e524349f3872c75b26df55))
* enhance EntryHistoryPanel with userId and improve styling for workspace content ([460c72a](https://github.com/parkit-now/front-desktop/commit/460c72aa73ccc7c58960d0dad0abbd6903f36087))
* **entries:** add traffic-light change feedback to cash payment ([a74dea8](https://github.com/parkit-now/front-desktop/commit/a74dea87cbc707f3ffa06cf7585e39c896254c45))
* **entries:** offer receipt print after confirming payment ([36f3197](https://github.com/parkit-now/front-desktop/commit/36f3197fecc1f07aca9c313d0ce0a0c711e50290))
* **entries:** show cash change and gate confirm on amount received ([661d91b](https://github.com/parkit-now/front-desktop/commit/661d91b22e7e704272168e0c8814a1912780f8e0))
* **env:** make prod abre la app empaquetada con Electron ([72628df](https://github.com/parkit-now/front-desktop/commit/72628df87536dee237b969cf3f91006515e29810))
* **env:** separar .env.local y .env.production con toggle make dev/prod ([97d116f](https://github.com/parkit-now/front-desktop/commit/97d116f9057f45be957d4759f7a8eedecd1a2329))
* features for working lpr microservice. instalation guides and service ([102f8e6](https://github.com/parkit-now/front-desktop/commit/102f8e624b3bab839e098a40c3c4aebb4255ddc4))
* **i18n:** centralizar traduccion de errores backend a español ([201e29a](https://github.com/parkit-now/front-desktop/commit/201e29a53548582ad360e3e4034f66231c35369f))
* **i18n:** lookup por code estable del backend en translate.ts ([5e5bbdf](https://github.com/parkit-now/front-desktop/commit/5e5bbdf30993704349026ddd16dbb0e9d7c94d8e))
* **lpr:** add LPR status indicator component and styles ([7800a22](https://github.com/parkit-now/front-desktop/commit/7800a225d12db524db848619ff3bd6f7d6d8cb4d))
* **lpr:** replace YOLOv8 + EasyOCR with fast-alpr ONNX stack ([4b44145](https://github.com/parkit-now/front-desktop/commit/4b44145489669ac0521c601a6ac6e7533fc67996))
* **lpr:** upload detection images during sync ([8222bc7](https://github.com/parkit-now/front-desktop/commit/8222bc71918244d9598eabb058e6a3fd08b85e54))
* mejoras en dialog de egreso ([43021c3](https://github.com/parkit-now/front-desktop/commit/43021c3a6c7a835528305a0e4724dddf3a8e32d9))
* nuevos filtros en egreso y en caja ([233b199](https://github.com/parkit-now/front-desktop/commit/233b1990b052885f7eef6ef87883f068bc9ca43d))
* **packaging:** add electron-builder config for mac/win/linux distributables ([c9b220f](https://github.com/parkit-now/front-desktop/commit/c9b220f96c4b0358842536c31c10e4b81f445cde))
* panel de vehículos, autocomplete combinado y mejoras al ingreso ([edf5082](https://github.com/parkit-now/front-desktop/commit/edf508297f8471778f8be3b9133710ba82aa780c))
* **payment-methods:** implement PaymentMethodsPanel for managing payment methods ([21a4f42](https://github.com/parkit-now/front-desktop/commit/21a4f429e484139f90b0684c838c16e5342f3f75))
* **payment-methods:** owner CRUD parity with web (isSystem + set-default) ([d093dae](https://github.com/parkit-now/front-desktop/commit/d093dae32f91ce52d9241ccf8458fd88d6f9c9bb))
* **print:** add receipt placeholder logger ([4aef174](https://github.com/parkit-now/front-desktop/commit/4aef174ec064bc536c21f7dfda8f2db394d7a351))
* **release:** automate versioning and GitHub Releases for desktop ([42e3bae](https://github.com/parkit-now/front-desktop/commit/42e3baec40372ad4baf0e54ef380fb026c490510))
* se agregó función de filtrado por fecha en las tablas ([31b7bfa](https://github.com/parkit-now/front-desktop/commit/31b7bfa84d1cc6e0c424e6d94dc0a5d4df2408f7))
* se agregó la autodetección de patentes a la app y se modificó la pantalla principal ([1976ec0](https://github.com/parkit-now/front-desktop/commit/1976ec03cb970b7141e4bb989a5621c5c6ae4929))
* **service-manager:** implement retry logic for service startup health checks ([103c460](https://github.com/parkit-now/front-desktop/commit/103c4607dc26a31813d294d14a16ce70381e5ba8))
* **services:** authenticate /shutdown and flush storage on exit ([fa98768](https://github.com/parkit-now/front-desktop/commit/fa987681e66e5c4346a517265fbc0c8e4e5e4386))
* **vehicles:** mandar expectedVersion en el ABM de vehículos ([7841c6b](https://github.com/parkit-now/front-desktop/commit/7841c6b3e61c8174741ff74dda475cc82c0c79e3))


### BREAKING CHANGES

* requiere el backend con `/vehicles/changes`, `typeId` en los
vehículos y `/vehicle-types`.

DEXIE v11 — y el paso que no es obvio

Tabla nueva `vehicleTypes`. `LocalVehicle` cambia `type` (string del enum) por
`typeId` (FK), y `tenantId`/`version` dejan de ser opcionales: la v10 y la v11
forzaron sendos re-pull completos, así que el fallback `v.version ?? 1` era
demostrablemente inalcanzable y un `1` silenciosamente incorrecto es peor que un
error visible.

El `upgrade` tiene TRES pasos. Los dos primeros son el patrón de la v6 y la v10
(resetear el cursor, descartar las ops encoladas). El tercero borra los
vehículos con `tenantId == null`, y sin él la migración queda incompleta:

  Resetear el cursor sirve para RELLENAR campos, porque el servidor reenvía cada
  fila. NO sirve para filas que dejaron de existir: el pull hace `bulkPut` de lo
  activo y `bulkDelete` de los tombstones, así que una fila sobre la que el
  servidor no tiene opinión es INVISIBLE al sync. Los globales son exactamente
  ese caso — post-migración el backend tiene copias con ids NUEVOS y nunca
  vuelve a mencionar los viejos. Sin el borrado local sobreviven para siempre y
  el autocompletado del ingreso los sigue ofreciendo.

Es borrado dirigido y no `.clear()`: alguien OFFLINE durante el upgrade se
quedaría sin catálogo, y el formulario de ingreso bloquea el alta con catálogo
vacío. Así conserva las filas propias durante esa ventana.

SYNC

`pullVehicleTypes` con cursor `vehicleTypes:{tenantId}`, y la etapa va ANTES del
catálogo en `fullSync`: los vehículos cargan `typeId`, así que si los tipos
fallan pero los vehículos entran, la columna Tipo se va a "—" en bloque, que se
lee como "me borraron las categorías".

`pushPendingOps` tiene CINCO puntos, no cuatro: `PendingOpEntity`, la unión de
`serverEntity`, el dispatch, la lista de tablas de la transacción y el
write-back. Omitir la lista de tablas falla ruidosamente —Dexie tira
`NotFoundError` y TODAS las ops de tipo caen en `failed`— así que es el que más
duele olvidar.

El borrado de un tipo EN USO se gatea con `isOnline`: son dos llamadas
dependientes con un bulk update server-side cuyo modo de falla offline es una
divergencia silenciosa entre los `typeId` locales y los del backend. Altas,
renombres y borrados simples siguen funcionando sin conexión.

DOS BUGS ARREGLADOS DE PASO

- `EntryFormCore` leía `localDb.vehicles` SIN filtrar por tenant y con `deps:
  []`. Al cambiar de estacionamiento sin limpiar IndexedDB el operador veía el
  catálogo ajeno — y como el formulario OBLIGA a elegir del catálogo, un pick
  errado escribía el snapshot de marca/modelo de otra playa en un ingreso real.
  Y con las deps vacías la query ni se re-ejecutaba. `VehiclesPanel` ya lo hacía
  bien; era asimetría pura.
- `AppSelect` movía `highlighted` pero nada scrolleaba la opción resaltada a la
  vista. Con las 8 opciones fijas del enum entraban enteras en los 260px; ahora
  los tipos son N y el highlight se caminaba fuera de pantalla.

`lib/api/vehicles.ts` pasa a derivar sus tipos del OpenAPI en vez de declararlos
a mano. No es cosmético: por eso el typecheck daba verde en falso mientras el
contrato del backend ya había cambiado. Y ahora encodea los segmentos de la URL,
como `rates.ts`.

Tests: 33 (eran 23). `splitTombstones` se extrae de las siete copias
literales que había en las funciones `pull*` y se testea una vez: es la lógica
que ya tuvieron que reparar dos commits distintos y no tenía cobertura en
ninguna de sus copias. Más los tests de los mappers.

Verificado con Playwright, dos pestañas en una sesión: tras limpiar IndexedDB la
v11 aplica, baja 246 vehículos y 8 tipos con CERO globales huérfanos; borrar el
Iveco Daily desde la web lo saca del IndexedDB del desktop (246 -> 245) y el
autocompletado deja de sugerirlo, mientras "kangoo" sigue sugiriendo — control
negativo, para que el verde no sea un falso positivo.
