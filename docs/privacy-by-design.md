# Privacidad por diseno

Este documento traduce los requisitos de privacidad a decisiones tecnicas del MVP. No reemplaza una revision legal formal.

## Principios aplicados

- Minimizar datos almacenados.
- Limitar el tratamiento al objetivo de anonimizacion documental.
- Procesar localmente durante el MVP.
- Evitar logs con contenido documental.
- Separar motores de deteccion, anonimizacion, auditoria y almacenamiento.
- Requerir revision humana cuando el riesgo sea alto o las validaciones fallen.

## Reglas de implementacion

- No almacenar el texto original completo en PostgreSQL.
- No registrar valores detectados en claro.
- No retornar `rawValue` desde el motor de deteccion por defecto.
- No usar nombres originales como claves fisicas.
- No habilitar descarga sin aprobacion y autorizacion.
- No conectar IA externa, OCR cloud, embeddings ni servicios SaaS hasta contar con autorizacion, evaluacion de riesgos y controles contractuales.

## Marco normativo de referencia

El proyecto se orienta a compatibilidad tecnica con la Ley N. 29733 y el Reglamento indicado en la especificacion del proyecto. Cualquier decision de cumplimiento juridico debe validarse con asesoria legal antes de uso productivo.
