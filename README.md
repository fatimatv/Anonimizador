# Document Anonymizer

MVP en fases para una plataforma web de anonimizacion documental en lote, con procesamiento local, minimizacion de datos y auditoria sin contenido personal en claro.

Estado actual: Fase 9 con mejoras de precision y salida multi-formato. La base del monorepo ya incluye API Fastify, frontend operativo en Next.js, modelos y migraciones Prisma, repositorios persistentes con PostgreSQL cuando `DATABASE_URL` esta configurado, autenticacion local inicial, roles, sesiones firmadas, auditoria tecnica no sensible, upload seguro en lote, almacenamiento temporal aislado, extraccion local de texto para TXT/PDF/DOCX, deteccion local basada en reglas y validadores, generacion local de texto anonimizado, revision editable protegida, descarga aprobada en TXT/DOCX/PDF y eliminacion controlada. Los repositorios en memoria quedan como fallback para tests y desarrollo sin base configurada.

## Principios

- Privacidad desde el diseno y por defecto.
- Procesamiento local en el MVP.
- No uso de IA externa, OCR cloud, embeddings ni servicios SaaS de analisis documental.
- No persistencia del texto original completo en base de datos.
- Auditoria tecnica sin datos personales en claro.
- Retencion temporal limitada y borrado controlado.

## Estructura

```txt
apps/
  web/      Frontend Next.js preparado para App Router
  api/      Backend Fastify preparado para modulos seguros
packages/
  shared/        Tipos, constantes y contratos compartidos
  rules-engine/  Deteccion local por reglas y contratos de anonimizacion
infra/
  docker-compose.yml
docs/
  architecture.md
  security.md
  privacy-by-design.md
  data-retention.md
  threat-model.md
  api.md
  testing.md
```

## Scripts

```bash
pnpm install
pnpm --filter @document-anonymizer/api prisma:migrate
pnpm dev
pnpm --filter @document-anonymizer/api worker
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

## Infraestructura local

```bash
docker compose -f infra/docker-compose.yml up -d
```

Servicios incluidos:

- PostgreSQL en `localhost:5432`
- Redis en `localhost:6379`

## Variables de entorno

Copiar `.env.example` a `.env` para desarrollo local y reemplazar secretos antes de cualquier uso fuera de entorno local.

Para habilitar un usuario administrador inicial sin guardar una contrasena en claro, configurar:

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD_HASH`

El hash debe ser Argon2id. En produccion, `SESSION_SECRET` y `AUDIT_HASH_SECRET` son obligatorios.

El acceso publico temporal queda desactivado por defecto en produccion. Para demos controladas se puede activar con:

- `PUBLIC_ACCESS_ENABLED=true`

Para evitar hashes reversibles de valores de baja entropia como DNI/RUC, configurar tambien:

- `DETECTION_HASH_SECRET`

La politica de reemplazo puede conservar sufijos minimos para revision (`balanced`, por defecto) o redactar completamente valores enmascarables (`strict`):

- `ANONYMIZATION_MASKING_POLICY=balanced`

OCR local para PDFs escaneados es opcional y queda apagado por defecto. Para activarlo se requiere un binario local compatible con salida TSV, por ejemplo Tesseract:

- `OCR_ENABLED=true`
- `OCR_COMMAND=tesseract`
- `OCR_LANGUAGES=spa+eng`
- `OCR_MIN_CONFIDENCE=45`

## Despliegue frontend

`vercel.json` deja preparado el despliegue del frontend desde `apps/web` cuando el repositorio se conecte en Vercel. La API, PostgreSQL y Redis siguen siendo servicios backend separados y no quedan desplegados en Vercel en esta fase.

## Upload seguro

La API acepta lotes autenticados en `POST /uploads/batch` para usuarios `admin` u `operator`.

Controles actuales:

- extensiones permitidas: `.txt`, `.pdf`, `.docx`;
- MIME esperado por extension;
- sniffing minimo de contenido para TXT, PDF con texto embebido y DOCX;
- limite de cantidad y tamano;
- rechazo de path traversal y nombres inseguros;
- almacenamiento temporal con claves internas, sin usar nombres originales;
- hashes de nombre y contenido;
- auditoria de rechazos y cargas completadas sin nombres originales.

## Procesamiento local

Tras un upload valido, la API encola cada documento para extraccion local de texto. En desarrollo y pruebas se usa una cola en memoria. En produccion se puede activar BullMQ/Redis con:

```env
PROCESSING_QUEUE_DRIVER=bullmq
REDIS_URL=redis://...
```

El worker separado se ejecuta con:

```bash
pnpm --filter @document-anonymizer/api worker
```

Controles actuales:

- TXT se decodifica localmente como UTF-8.
- PDF se procesa localmente con `pdfjs-dist` para extraer texto embebido y coordenadas.
- Si `OCR_ENABLED=true`, PDFs sin texto embebido se rasterizan localmente y se procesan con OCR local configurable. No se llama a OCR cloud.
- DOCX se procesa localmente con `mammoth`.
- El texto extraido no se guarda ni se devuelve.
- Solo se conserva hash y longitud del texto extraido.
- Los errores de extraccion no incluyen contenido documental.

## Deteccion local

Tras extraer texto, la API invoca el motor local de reglas en `packages/rules-engine`.

Detectores actuales:

- DNI, RUC, carne de extranjeria, pasaporte, correos, telefonos, IP y URLs.
- Direcciones, ubicaciones, nombres por contexto, organizaciones, cuentas bancarias, CCI, tarjetas con Luhn, placas, expedientes y firmas.
- Validacion de checksum para RUC, filtros de falsos positivos para DNI, heuristicas locales para nombres legales en lineas de partes y pseudonimos para expedientes/organizaciones.
- Diccionarios controlados para salud, biometria y datos de menores.

Controles actuales:

- No se guarda ni devuelve el valor crudo detectado.
- En API, los hashes de valores detectados usan HMAC cuando `DETECTION_HASH_SECRET` o `AUDIT_HASH_SECRET` esta configurado.
- Se conserva hash del valor, hash de ventana de contexto, offsets, tipo, categoria, confianza, regla y preview enmascarado.
- `GET /documents/:documentId/detections` devuelve solo la vista enmascarada para el propietario, `admin` o `reviewer`.
- La auditoria de deteccion registra conteos y nivel de riesgo, sin contenido documental.

## Anonimizacion local

Despues de detectar entidades, la API aplica reemplazos locales por offsets y guarda un texto anonimizado canonico en almacenamiento temporal aislado.

Controles actuales:

- No usa IA externa, OCR cloud ni APIs de terceros.
- Los reemplazos se aplican con reglas locales: enmascarar, redactar, remover o pseudonimizar.
- `ANONYMIZATION_MASKING_POLICY=strict` permite redaccion total de valores que normalmente se enmascararian.
- Los pseudonimos son consistentes dentro del documento usando el hash del valor detectado.
- El archivo anonimizado se guarda con clave interna en carpeta `anonymized`, sin nombre original.
- La vista previa de revision queda limitada a `admin` o `reviewer` y puede corregirse manualmente antes de aprobar.
- La descarga queda bloqueada hasta que un `admin` o `reviewer` apruebe el documento.
- `GET /documents/:documentId/download-anonymized?format=txt|docx|pdf` entrega solo el archivo aprobado en formato tecnico, sin usar el nombre original.
- Para PDF con texto embebido, la salida PDF se reconstruye como documento sanitizado del mismo tamano de pagina y aplica cajas de redaccion segun coordenadas de deteccion. No copia el PDF original con texto oculto debajo.
- Para PDF escaneado procesado con OCR local, la salida PDF rasteriza paginas y quema las cajas negras sobre la imagen antes de crear un PDF nuevo, evitando que se puedan retirar capas para recuperar pixeles sensibles.
- Para TXT/DOCX y para PDFs sin coordenadas utilizables, la salida se renderiza desde el texto anonimizado aprobado.

## Eliminacion controlada

`DELETE /jobs/:jobId` permite al propietario o `admin` eliminar un job y sus archivos temporales. La API tambien ejecuta limpieza periodica por TTL fuera del entorno de pruebas.

Controles actuales:

- Borra original y anonimizado desde claves internas validadas.
- Marca job y documentos como `deleted`.
- Registra `deletion_requested` y `deletion_completed` sin nombres originales ni contenido.
- `RETENTION_CLEANUP_INTERVAL_MS` permite ajustar la frecuencia de limpieza automatica.

## Persistencia

Cuando `DATABASE_URL` esta configurado y `NODE_ENV` no es `test`, la API usa Prisma/PostgreSQL para usuarios, jobs, documentos, detecciones y auditoria. Antes de desplegar o iniciar una base nueva, ejecutar:

```bash
pnpm --filter @document-anonymizer/api prisma:migrate
```

Si `DATABASE_URL` no existe, la API conserva repositorios en memoria para desarrollo temprano y pruebas.

## Operacion productiva

El despliegue productivo debe correr al menos tres procesos/entradas: API, worker BullMQ y limpieza TTL programada. La limpieza TTL de una sola corrida para cron/worker dedicado se ejecuta con:

```bash
pnpm --filter @document-anonymizer/api cleanup:retention
```
