# Document Anonymizer

MVP en fases para una plataforma web de anonimizacion documental en lote, con procesamiento local, minimizacion de datos y auditoria sin contenido personal en claro.

Estado actual: Fase 8 parcial. La base del monorepo ya incluye API Fastify, frontend operativo en Next.js, modelos Prisma, autenticacion local inicial, roles, sesiones firmadas, auditoria tecnica no sensible, upload seguro en lote, almacenamiento temporal aislado, extraccion local de texto para TXT/PDF/DOCX, deteccion local basada en reglas, generacion local de archivo anonimizado en texto plano, revision minima, descarga protegida por aprobacion y eliminacion controlada. Todavia falta persistencia real completa con Prisma/PostgreSQL para reemplazar repositorios en memoria.

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
pnpm dev
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

Tras un upload valido, la API encola cada documento para extraccion local de texto. En desarrollo y pruebas se usa una cola en memoria; tambien queda disponible un adaptador BullMQ para conectar Redis sin cambiar los servicios de procesamiento.

Controles actuales:

- TXT se decodifica localmente como UTF-8.
- PDF se procesa localmente con `pdf-parse`; no hay OCR.
- DOCX se procesa localmente con `mammoth`.
- El texto extraido no se guarda ni se devuelve.
- Solo se conserva hash y longitud del texto extraido.
- Los errores de extraccion no incluyen contenido documental.

## Deteccion local

Tras extraer texto, la API invoca el motor local de reglas en `packages/rules-engine`.

Detectores actuales:

- DNI, RUC, carne de extranjeria, pasaporte, correos, telefonos, IP y URLs.
- Direcciones, ubicaciones, nombres por contexto, cuentas bancarias, tarjetas con Luhn, placas, expedientes y firmas.
- Diccionarios controlados para salud, biometria y datos de menores.

Controles actuales:

- No se guarda ni devuelve el valor crudo detectado.
- Se conserva hash del valor, hash de ventana de contexto, offsets, tipo, categoria, confianza, regla y preview enmascarado.
- `GET /documents/:documentId/detections` devuelve solo la vista enmascarada para el propietario, `admin` o `reviewer`.
- La auditoria de deteccion registra conteos y nivel de riesgo, sin contenido documental.

## Anonimizacion local

Despues de detectar entidades, la API aplica reemplazos locales por offsets y guarda un archivo `.txt` anonimizado en almacenamiento temporal aislado.

Controles actuales:

- No usa IA externa, OCR cloud ni APIs de terceros.
- Los reemplazos se aplican con reglas locales: enmascarar, redactar, remover o pseudonimizar.
- Los pseudonimos son consistentes dentro del documento usando el hash del valor detectado.
- El archivo anonimizado se guarda con clave interna en carpeta `anonymized`, sin nombre original.
- La descarga queda bloqueada hasta que un `admin` o `reviewer` apruebe el documento.
- `GET /documents/:documentId/download-anonymized` entrega solo el archivo aprobado.

## Eliminacion controlada

`DELETE /jobs/:jobId` permite al propietario o `admin` eliminar un job y sus archivos temporales. La API tambien ejecuta limpieza periodica por TTL fuera del entorno de pruebas.

Controles actuales:

- Borra original y anonimizado desde claves internas validadas.
- Marca job y documentos como `deleted`.
- Registra `deletion_requested` y `deletion_completed` sin nombres originales ni contenido.
- `RETENTION_CLEANUP_INTERVAL_MS` permite ajustar la frecuencia de limpieza automatica.

## Siguiente fase

La siguiente fase debe reemplazar repositorios en memoria por persistencia real Prisma/PostgreSQL y preparar despliegue con API, base de datos y Redis separados.
