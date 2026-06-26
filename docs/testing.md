# Pruebas

La Fase 3 deja scripts de prueba y cobertura inicial de salud, autenticacion, sesiones, roles, auditoria no sensible, upload seguro y extraccion local.

## Comandos

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Cobertura esperada por fases

Fase 1 cubierto:

- login valido;
- credenciales invalidas;
- bloqueo por intentos fallidos;
- lectura de usuario actual;
- guard de rol admin en auditoria;
- auditoria sin email ni contrasena en claro.

Fase 2:

- upload valido cubierto;
- upload rechazado cubierto;
- extension peligrosa cubierta;
- MIME inconsistente cubierto;
- path traversal cubierto;
- rol no autorizado cubierto;
- archivo excesivo;
- cantidad maxima de archivos.

Fase 3 cubierto:

- extraccion local TXT exitosa;
- fallo de extraccion PDF sin filtrar contenido;
- consulta de job sin texto original;
- transicion a `detecting_entities` cuando la extraccion sale bien;
- transicion a `failed` cuando la extraccion falla.

Fases 4 a 6:

- detectores;
- resolucion de solapamientos;
- anonimizado;
- validaciones antes de descarga;
- aprobacion y rechazo.

Fase 8:

- TTL;
- eliminacion manual;
- verificacion de inaccesibilidad;
- rate limit;
- headers de seguridad.
