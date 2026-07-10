# Arquitectura

La plataforma se organiza como monorepo para separar responsabilidades desde el inicio.

```txt
Frontend Next.js
  |
  | API HTTP interna
  v
Backend Fastify
  |
  |-- Auth
  |-- Upload
  |-- Documents
  |-- Processing
  |-- Detection
  |-- Anonymization
  |-- Review
  |-- Audit
  |-- Storage
  |-- Deletion
  |
  v
PostgreSQL + Redis + almacenamiento temporal local
```

## Decisiones de Fase 0

- Se usa `pnpm` workspaces para aislar apps y paquetes.
- `apps/web` queda preparado para Next.js App Router.
- `apps/api` queda preparado con Fastify, Helmet, CORS restringible y rate limiting base.
- `packages/shared` contiene contratos compartidos no sensibles.
- `packages/rules-engine` contiene contratos del motor local, sin detectores implementados aun.
- `infra/docker-compose.yml` define PostgreSQL y Redis para desarrollo local.

## Decisiones de Fase 1

- La API usa Fastify con modulos separados para auth, users, audit y seguridad de sesiones.
- Prisma define el modelo de datos minimo completo, pero la persistencia de usuarios queda abstraida para permitir pruebas sin base de datos activa.
- Las sesiones se firman localmente con HMAC y se entregan en cookies `HttpOnly`, `SameSite=Strict` y con expiracion corta.
- La auditoria valida metadatos antes de registrarlos y usa hashes HMAC para IP, user agent e identificadores derivados.
- `vercel.json` prepara despliegue del frontend; la API y servicios de datos siguen fuera de Vercel en esta fase.

## Decisiones de Fase 2

- `UploadModule` usa multipart autenticado y rechaza el lote completo si un archivo falla validacion.
- `FileValidationService` valida extension, MIME declarado, tamano, cantidad y una firma minima de contenido.
- `StorageService` centraliza almacenamiento temporal bajo `tmp-storage`, separado por hash de usuario y job.
- Los nombres originales no se usan como claves fisicas ni se devuelven en respuestas.
- `JobRepository` abstrae la creacion de Job/Document; en esta fase usa memoria para pruebas y desarrollo temprano.
- Los eventos `upload_rejected` y `upload_completed` no incluyen nombres originales ni contenido documental.

## Decisiones de Fase 3

- `ProcessingService` orquesta lectura controlada desde storage, extraccion local y actualizacion de estados.
- `TextExtractionService` usa solo librerias locales: UTF-8 para TXT, `pdf-parse` para PDF con texto embebido y `mammoth` para DOCX.
- `ProcessingQueue` usa cola en memoria por defecto y BullMQ/Redis cuando `PROCESSING_QUEUE_DRIVER=bullmq`.
- La API no persiste ni responde texto extraido; conserva hash y longitud.
- Si la extraccion falla, el documento queda en `failed` y la auditoria registra un motivo tecnico generico.
- Un documento extraido correctamente queda en `detecting_entities`, listo para Fase 4.

## Decisiones de Fases 4 a 8

- `packages/rules-engine` implementa deteccion local por reglas para identificadores, datos sensibles por diccionario y patrones legales frecuentes.
- La anonimizacion se aplica por offsets sobre el texto extraido y genera un archivo `.txt` temporal.
- La API no devuelve el texto anonimizado en la respuesta de upload; el preview queda detras de rutas de revision para `admin` o `reviewer`.
- La descarga queda bloqueada hasta aprobacion.
- La eliminacion manual y limpieza por TTL usan las claves internas de storage.

## Limites actuales

- Los repositorios de usuarios, jobs, documentos y eventos de auditoria siguen en memoria por defecto.
- Prisma modela y persiste usuarios, jobs, documentos, detecciones y auditoria cuando `DATABASE_URL` esta configurado.
- Los repositorios en memoria quedan como fallback para tests y desarrollo sin base configurada.
- En produccion, el worker BullMQ debe correr como proceso separado con `pnpm --filter @document-anonymizer/api worker`.
- La limpieza TTL para entornos serverless debe correr como cron dedicado con `pnpm --filter @document-anonymizer/api cleanup:retention`.
- No hay servicios externos de IA ni OCR.
