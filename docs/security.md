# Seguridad

La base de Fase 0 incorpora controles iniciales y define restricciones para las siguientes fases.

## Controles base

- Helmet activo en API.
- CORS configurable mediante `WEB_ORIGIN`.
- Rate limiting tecnico base.
- Logger de Fastify con redaccion de headers sensibles.
- Sesiones firmadas con HMAC y expiracion corta.
- Cookies `HttpOnly` y `SameSite=Strict`.
- Bloqueo temporal por intentos fallidos.
- Guard de rol `admin` para auditoria.
- Auditoria con metadatos validados y hashes HMAC para IP/user agent.
- Upload multipart autenticado para `admin` y `operator`.
- Rechazo de extension peligrosa, MIME inconsistente, path traversal, lotes vacios y archivos excesivos.
- Almacenamiento temporal con claves internas y aislamiento por usuario/job.
- Extraccion local sin OCR externo ni servicios SaaS.
- Resumen de extraccion con hash y longitud, sin texto extraido.
- Errores de extraccion sin fragmentos documentales.
- Deteccion local por reglas sin IA externa.
- Entidades detectadas guardadas sin valor crudo: solo hashes, offsets, tipo, categoria, confianza, regla y preview enmascarado.
- Endpoint de detecciones limitado al propietario, `admin` o `reviewer`, sin hashes ni valores crudos en la respuesta publica.
- Anonimizacion local por offsets sin servicios externos.
- Archivo anonimizado guardado en carpeta separada `anonymized`, con clave interna y sin nombre original.
- Descarga de anonimizado bloqueada hasta aprobacion por `admin` o `reviewer`.
- Eliminacion manual y limpieza por TTL de archivos temporales originales y anonimizados.
- Auditoria de eliminacion sin contenido documental ni nombres originales.
- Variables de entorno documentadas en `.env.example`.
- Secretos reales excluidos por `.gitignore`.

## Controles obligatorios para fases siguientes

- Persistencia real de usuarios con Prisma y migraciones.
- Cookies `Secure` obligatorias fuera de desarrollo.
- CSRF si se usan cookies.
- Validacion estricta de payloads.
- Persistencia real de Job/Document con Prisma.
- Timeouts por archivo.
- Errores sin contenido documental.
- Auditoria no sensible.
- Pruebas contra path traversal y acceso cruzado entre usuarios.

## Datos prohibidos en logs

- Texto original.
- Fragmentos documentales.
- DNI, emails, telefonos, direcciones o nombres reales extraidos.
- Contenido anonimizado si permite inferencias sensibles.
- Nombres originales completos de archivo.
