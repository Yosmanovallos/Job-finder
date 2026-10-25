# Portales oficiales de empresas presentes en Computrabajo Colombia

El objetivo es identificar las empresas con vacantes vigentes de Computrabajo Colombia que publican también en su propio portal de empleo y alimentar BuscoTrabajo desde ese portal mediante los conectores oficiales ya existentes. Una empresa con un tablero verificado no implica que todas sus vacantes de Computrabajo tengan equivalente oficial.

## C1 — denominador y prioridad

Medir únicamente filas vigentes de `jobs` con `country = 'CO'` y fuente primaria o deduplicada `Computrabajo`, excluyendo proyecciones oficiales y nombres de empleador no revelado. Separar agencias conocidas, empresas con tablero habilitado, empresas con al menos una vacante oficial vigente, casos con dominio respaldado por evidencia y casos para revisión. Ordenar las empresas sin tablero por su número de vacantes de Computrabajo.

El censo es de solo lectura y usa las tablas actuales. No consulta páginas de Computrabajo ni amplía rutas de acceso bloqueadas. Se ejecuta primero en integración aislada y después mediante un modo manual de GitHub Actions; sus resultados determinan el lote siguiente.

## Siguiente lote, según el censo

Para las empresas prioritarias aún sin tablero: buscar un dominio oficial con evidencia independiente, leer solo sus páginas públicas permitidas de empleo, verificar el enlace al ATS y las vacantes de Colombia, y vincularlo con el mecanismo de promoción existente. Los sitios bloqueados o sin listado completo permanecen sin importar; nunca se inventan fechas ni cierres. La meta de revisar el 100 % de las empresas del conjunto de Computrabajo se mide aparte de la proporción que realmente ofrece un portal importable.

SEO, descripciones y presentación pública quedan fuera de este cambio.

## Primera medición en producción

La [corrida de solo lectura 40234196204](https://github.com/Yosmanovallos/Job-finder/actions/runs/40234196204) encontró 1.222 nombres válidos y 4.263 vacantes vigentes de Computrabajo Colombia, contando fuente primaria y deduplicada. La lista curada de agencias reconoce 25 nombres y 1.245 vacantes. Entre las 1.197 empresas restantes, 6 tienen un tablero oficial habilitado (82 vacantes de Computrabajo asociadas) y las 6 tienen al menos una vacante oficial vigente. Quedan 1.191 sin tablero, con 2.936 vacantes de Computrabajo; 11 cuentan con un dominio curado y ninguna está en `needs_review`.

La lista curada de agencias no pretende ser exhaustiva. Entre las empresas más frecuentes hay BPO, temporales y portales de terceros que pueden publicar tanto vacantes propias como de clientes. El siguiente lote debe comprobar el vínculo entre la vacante de Computrabajo, la empresa empleadora y el tablero propio antes de promover nada. Un subdominio de Pandapé/Computrabajo no se trata como una fuente independiente.
