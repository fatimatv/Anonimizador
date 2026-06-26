# Retencion y eliminacion

La politica de retencion del MVP debe minimizar el tiempo de vida de originales y resultados.

## Politica inicial

- Los documentos originales se almacenaran solo en almacenamiento temporal aislado.
- Las claves fisicas no deben derivarse del nombre original.
- La ruta interna no debe exponerse al frontend.
- Cada archivo debe asociarse a usuario, job, documento, hash y TTL.
- Los originales deben eliminarse al completar el procesamiento o al vencer el TTL configurado.
- Los anonimizados tambien quedan sujetos a TTL y eliminacion manual autorizada.

## Limites tecnicos

La eliminacion fisica absoluta no puede garantizarse en todos los medios. SSD, snapshots, backups y storage gestionado pueden conservar bloques aun despues de una eliminacion logica. Por eso el diseno debe priorizar:

- retencion minima;
- cifrado en reposo cuando sea viable;
- exclusion de backups para carpetas temporales;
- destruccion de claves cuando corresponda;
- verificacion de inaccesibilidad desde la aplicacion.

## Implementacion actual

Fase 2 crea claves temporales bajo:

```txt
tmp-storage/users/{userIdHash}/jobs/{jobId}/original/{uuid}.{ext}
```

El nombre original se reemplaza por hash en metadatos. La limpieza automatica y eliminacion manual quedan para la fase de hardening.
