# Requisitos

1. Una oferta mayor de 30 días, vencida o cerrada sale de todos los listados públicos.
2. El retiro conserva atómicamente ID, hash, hechos originales, fecha y causa en archivo privado.
3. Si falla el archivo, no se pierde la fila original. Sin migración, no hay borrado destructivo.
4. Una nueva importación del mismo hash no lo presenta como nuevo durante la retención.
5. La página retirada responde 410/noindex, sin JobPosting ni postulación, aun sin tombstone.
6. Restaurar un tablero no renueva fechas ni permite superar 30 días.
7. Archivo durante 180 días; limpieza limitada por llamada. RLS activo, sin permisos públicos.
8. Migración dry-run por defecto, idempotente y previa al despliegue. Diseño y caché conservados.
