# Modelo de amenazas inicial

## Activos

- Documentos originales.
- Documentos anonimizados.
- Metadatos de jobs y documentos.
- Entidades detectadas en forma enmascarada.
- Auditoria tecnica.
- Credenciales de usuarios internos.

## Amenazas principales

- Carga de archivo malicioso.
- Path traversal.
- Exfiltracion por logs.
- Acceso cruzado entre usuarios.
- Descarga sin autorizacion.
- Retencion excesiva de documentos originales.
- Reidentificacion por previews demasiado ricos.
- Errores que incluyan contenido sensible.
- Integracion externa no autorizada.

## Mitigaciones previstas

- Validacion de extension, MIME, tamano y cantidad.
- Claves internas con UUID o hash, nunca nombres originales.
- Storage temporal aislado por usuario y job.
- Auditoria sin contenido personal en claro.
- Roles y guards por endpoint.
- Revalidacion del documento anonimizado antes de descarga.
- TTL y eliminacion manual autorizada.
- Prohibicion temporal de IA externa y OCR cloud.

## Supuestos

- El MVP corre en entorno controlado.
- Los usuarios son internos y autorizados.
- La infraestructura local no realiza backups de `tmp-storage`.
- La revision legal final ocurrira antes de produccion.
