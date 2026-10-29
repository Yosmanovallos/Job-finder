# Validación (2026-10-29)

- `tsc --noEmit`: 0 errores. ESLint sobre los archivos tocados: limpio.
- `test:unit`: 125 pasan; 1 fallo en EXE-004 (`validate-fetch-context`),
  prueba de tiempos ajena al cambio: pasa 3/3 al repetirla, con y sin el cambio.
- `test:job-render`: 10/10. `test:job-seo` (Postgres aislado): 57/57, incluido
  14b — fría: enlace al hub; tras cargar `/empleos/pereira`: la hermana aparece,
  lo que prueba que la clave de caché es compartida.
- `test:baseline`: 18 rutas, escritorio y móvil, sin errores de página.
  Captura con hermanas obtenida cambiando temporalmente la vacante del
  baseline a Bogotá (cambio revertido).
