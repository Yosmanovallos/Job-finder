# Método y límites

Fuentes primarias: UI autenticada de Google Search Console, Web, propiedad
sc-domain:buscotrabajo.co; HTML público de categorías existentes. No .env,
credenciales, consultas a producción ni exportaciones de usuarios.

Ventanas independientes: consultas 2026-07-26..2026-10-25 observadas 27-Oct;
páginas 2026-09-29..2026-10-26 observadas 28-Oct. No comparar porcentajes entre
ventanas distintas. La segunda todavía precede al piloto del 27-Oct.
Lectura de las primeras 500 de 832 consultas en el trimestre: una consulta
ausente es desconocida, no cero. No sumar filas para inferir totales de marca.

Inventario: veinte GET públicos, concurrencia máxima dos, timeout 15 s por
solicitud; una consulta adicional a ingeniero civil VE. Se guarda solo metadata
y agregados del snapshot SSR, hasta 60 vacantes por muestra. Total visible no
es total apto para Google; etiquetas de empresas no son empresas verificadas.

Prioridad cualitativa: categoría existente con exposición reciente e inventario
coherente; luego oportunidad de enlazado/contenido a posición comparable;
después expansión de taxonomía si falta categoría. No usar muchas vacantes como
único criterio ni inventar volúmenes de mercado o clics incrementales.

La revisión de nueve consultas exactas identifica sus páginas observadas, pero
no constituye un análisis exhaustivo de canibalización. No se retiran ni
canonicalizan páginas basándose solo en esta muestra. CO/VE aquí indican país
destino; el país del buscador se informa aparte.

Publicación documental reversible por revert. No se ejecuta otra fase, se
modifican datos ni se requieren migraciones. Los artefactos de implementación
se crearán en su sesión según el plan del repositorio.
