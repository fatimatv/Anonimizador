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
- `ProcessingQueue` permite usar cola en memoria o adaptador BullMQ.
- La API no persiste ni responde texto extraido; conserva hash y longitud.
- Si la extraccion falla, el documento queda en `failed` y la auditoria registra un motivo tecnico generico.
- Un documento extraido correctamente queda en `detecting_entities`, listo para Fase 4.

## Limites de Fase 0

- No hay deteccion ni anonimizacion.
- No hay almacenamiento temporal activo.
- No hay servicios externos de IA ni OCR.
