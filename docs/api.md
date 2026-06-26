# API inicial

La Fase 1 expone endpoints tecnicos de salud, autenticacion local y auditoria protegida:

```txt
GET /health
POST /auth/login
POST /auth/logout
GET /auth/me
GET /uploads/limits
POST /uploads/batch
GET /jobs/:jobId
DELETE /jobs/:jobId
GET /documents/:documentId/detections
GET /documents/:documentId/download-anonymized
POST /review/documents/:documentId/approve
POST /review/documents/:documentId/reject
GET /audit-events
```

Respuesta esperada:

```json
{
  "service": "document-anonymizer-api",
  "status": "ok"
}
```

Endpoints planificados para fases posteriores:

- `GET /jobs`
- `GET /documents/:documentId`
- `GET /documents/:documentId/preview`
- `GET /rules`
- `PATCH /rules/:ruleId`

Regla transversal: ningun endpoint de auditoria o errores debe devolver texto original, fragmentos documentales ni valores detectados en claro.

## Autenticacion

`POST /auth/login` recibe:

```json
{
  "email": "admin@example.local",
  "password": "password"
}
```

Si las credenciales son validas, responde usuario seguro y fija una cookie `HttpOnly`, `SameSite=Strict`, firmada y con expiracion corta. La API no devuelve `passwordHash`.

`GET /auth/me` requiere cookie de sesion valida.

`POST /auth/logout` limpia la cookie y registra auditoria no sensible.

## Auditoria

`GET /audit-events` requiere rol `admin`. Devuelve solo eventos tecnicos con metadatos validados; no incluye documento original, fragmentos, valores detectados, email de login en claro ni contrasenas.

## Upload

`GET /uploads/limits` requiere sesion valida y devuelve limites de lote, tamano y tipos soportados.

`POST /uploads/batch` requiere sesion valida y rol `admin` u `operator`. Recibe `multipart/form-data` con archivos en el campo `files`.

Responde `201` con ids logicos de job/documentos y metadatos no sensibles. No devuelve nombres originales ni rutas internas.

Errores principales:

- `401 authentication_required`
- `403 insufficient_role`
- `400 empty_batch`
- `400 too_many_files`
- `400 unsafe_file_name`
- `400 unsupported_extension`
- `400 mime_mismatch`
- `400 file_too_large`

La Fase 6 parcial guarda originales en almacenamiento temporal, crea metadatos, ejecuta extraccion local, deteccion por reglas, anonimizacion local y revision minima.

## Jobs

`GET /jobs/:jobId` requiere sesion valida. Puede leerlo el creador del job, `admin` o `reviewer`.

La respuesta incluye metadatos no sensibles del job y documentos asociados. No devuelve texto extraido, nombres originales ni rutas internas. La extraccion exitosa deja:

```json
{
  "validationSummary": {
    "extension": ".txt",
    "extraction": {
      "extractedTextHash": "sha256:...",
      "extractedTextLength": 123
    }
  }
}
```

Cuando la deteccion termina, cada documento incluye un resumen seguro:

```json
{
  "detectionSummary": {
    "entityCounts": {
      "dni": 1,
      "email": 1
    },
    "riskLevel": "high",
    "rulesVersion": "local-rules-v1",
    "totalEntities": 2
  }
}
```

## Detecciones

`GET /documents/:documentId/detections` requiere sesion valida. Puede leerlo el creador del job, `admin` o `reviewer`.

La respuesta devuelve solo resultados enmascarados:

```json
{
  "detections": [
    {
      "id": "detected-entity-id",
      "entityType": "dni",
      "category": "identifier",
      "startOffset": 10,
      "endOffset": 18,
      "confidence": 0.9,
      "replacementType": "mask",
      "previewMasked": "****5678",
      "ruleId": "peru-dni-regex-v1"
    }
  ]
}
```

No devuelve `rawValue`, `rawValueHash`, `contextWindowHash`, texto original ni nombres originales de archivo.

## Revision

`POST /review/documents/:documentId/approve` requiere rol `admin` o `reviewer`. Aprueba un documento que ya tenga archivo anonimizado generado.

`POST /review/documents/:documentId/reject` requiere rol `admin` o `reviewer`. Marca el documento como rechazado y el job como `rejected`.

Ambos endpoints registran auditoria no sensible y no aceptan comentarios libres en esta fase para evitar almacenar datos personales por accidente.

## Descarga anonimizada

`GET /documents/:documentId/download-anonymized` requiere sesion valida. Puede descargarlo el creador del job, `admin` o `reviewer`, pero solo si el documento esta `approved` o `completed`.

Antes de la aprobacion responde:

```json
{
  "error": "document_not_approved"
}
```

La descarga usa un nombre tecnico `anonymized-{documentId}.txt`, no el nombre original del archivo.

## Eliminacion

`DELETE /jobs/:jobId` requiere sesion valida. Puede eliminarlo el creador del job o `admin`.

La respuesta confirma cantidad de documentos afectados:

```json
{
  "deletedDocuments": 1,
  "job": {
    "id": "job-id",
    "status": "deleted"
  }
}
```

La operacion elimina archivos temporales originales y anonimizados, marca metadatos como `deleted` y registra auditoria no sensible.
