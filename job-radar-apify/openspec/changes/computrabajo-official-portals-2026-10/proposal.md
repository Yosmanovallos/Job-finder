# Portales oficiales de empresas presentes en Computrabajo Colombia

El objetivo es identificar las empresas con vacantes vigentes de Computrabajo Colombia que publican también en su propio portal de empleo y alimentar BuscoTrabajo desde ese portal mediante los conectores oficiales ya existentes. Una empresa con un tablero verificado no implica que todas sus vacantes de Computrabajo tengan equivalente oficial.

## C1 — denominador y prioridad

Medir únicamente filas vigentes de `jobs` con `country = 'CO'` y fuente primaria o deduplicada `Computrabajo`, excluyendo proyecciones oficiales y nombres de empleador no revelado. Separar agencias conocidas, empresas con tablero habilitado, empresas con al menos una vacante oficial vigente, casos con dominio respaldado por evidencia y casos para revisión. Ordenar las empresas sin tablero por su número de vacantes de Computrabajo.

El censo es de solo lectura y usa las tablas actuales. No consulta páginas de Computrabajo ni amplía rutas de acceso bloqueadas. Se ejecuta primero en integración aislada y después mediante un modo manual de GitHub Actions; sus resultados determinan el lote siguiente.

## Siguiente lote, según el censo

Para las empresas prioritarias aún sin tablero: buscar un dominio oficial con evidencia independiente, leer solo sus páginas públicas permitidas de empleo, verificar el enlace al ATS y las vacantes de Colombia, y vincularlo con el mecanismo de promoción existente. Los sitios bloqueados o sin listado completo permanecen sin importar; nunca se inventan fechas ni cierres. La meta de revisar el 100 % de las empresas del conjunto de Computrabajo se mide aparte de la proporción que realmente ofrece un portal importable.

SEO, descripciones y presentación pública quedan fuera de este cambio.
