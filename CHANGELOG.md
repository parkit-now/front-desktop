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
