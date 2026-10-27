# Evidencia de ciudad para copias de portales oficiales

## Problema

El enlace de una copia de bolsa a su vacante oficial puede elegirse por alias
de empresa y título aunque ambas fuentes indiquen ciudades distintas. Una
auditoría de producción encontró 527 copias ocultas; 35 enlaces entre ciudades
específicas realmente distintas tras normalizar Bogotá. Hay enlaces de Bogotá
a Medellín y de Medellín a Barranquilla. Un enlace así oculta una oferta potencialmente distinta y
redirige al candidato a otra ciudad.

## Alcance

- Mantener la prioridad oficial cuando empresa, título y ciudad coinciden.
- Reconocer solo grafías equivalentes de Bogotá, sin inventar equivalencias
  entre barrios, departamentos y municipios.
- Restaurar copias recientes enlazadas antes a otra ciudad específica mediante
  la regla existente de 48 horas y unicidad de fingerprint.
- Evitar que una URL de copia antigua siga redirigiendo a una vacante oficial
  de otra ciudad; el detalle responde 410 mientras no haya nueva señal de la bolsa.
- Conservar el comportamiento de ubicaciones amplias (Colombia/remoto) y
  registrar los casos donde varias requisiciones oficiales comparten título
  y ciudad para una revisión posterior.

No se editan módulos, metadatos ni reglas SEO; tampoco Aplicar, fechas,
fuentes, caché, esquema o configuración de Render.

## Verificación y reversión

La prueba de PostgreSQL aislado comprueba que otra ciudad no se oculta, una
grafía equivalente sí se agrupa, una copia reciente mal enlazada se restaura
y una copia antigua no redirige a otra ciudad. TypeScript, lint dirigido, unitarias, build,
integración y canario de solo lectura deben pasar. Si aparecen duplicados
materiales o regresión de latencia, revertir el cambio de código y ejecutar
el siguiente tick, que volverá a aplicar la regla anterior.
