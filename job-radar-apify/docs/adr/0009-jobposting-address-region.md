# ADR 0009 — `addressRegion` desde una tabla cerrada de municipios de Colombia

Fecha: 2026-10-30. Estado: aceptado, implementado en `codex/jobposting-address-region`.

## Contexto

El 30-Oct Search Console envió el aviso no crítico "Falta el campo
addressRegion (en jobLocation.address)" para 3 de 8 elementos JobPosting
válidos. Ejemplo: `/empleos/42704a4f-…/team-leader-operations-solo-gcs`
publica `addressLocality: "Medellín"` sin departamento, porque la fuente solo
escribió "Medellín".

`docs/JOBPOSTING-GOOGLE-CONTRACT.md` decía "Never infer an address". Que
Medellín está en Antioquia no es una suposición sobre la vacante: es un hecho
geográfico fijo (DANE, DIVIPOLA). Aun así, el dato no viene de la fuente, y por
eso este cambio necesita un ADR.

## Decisión

- Solo para `country = "CO"` y solo si el texto de la fuente no trae región.
  Si la fuente la trae, siempre gana la de la fuente.
- La tabla es cerrada y está en `src/lib/co-departments.ts`: capitales de
  departamento y municipios grandes cuyo nombre es **único** en DIVIPOLA.
  Los nombres que se repiten en más de un departamento (Armenia, Florencia,
  Rionegro, Barbosa, Mosquera, La Unión, Candelaria, San Andrés…) no reciben
  región: se omite antes que adivinar.
- La búsqueda normaliza mayúsculas y tildes, y quita el sufijo "Metropolitan
  Area" / "Área Metropolitana". `addressLocality` se queda con el texto de la
  fuente tal cual.
- Bogotá es distrito capital, no parte de Cundinamarca: región "Bogotá, D.C.".
- Paridad visible (regla E): la región derivada también se muestra en
  "Ubicación" del cuerpo SSR, con el mismo `resolveGoogleLocation`.
- `streetAddress`, `postalCode` y `baseSalary` siguen sin emitirse.

## Consecuencias

- Más vacantes de CO con `addressRegion`. Medirlo en el informe de Ofertas de
  trabajo después del despliegue.
- Venezuela y los municipios ambiguos quedan igual que antes.
- Para revertir basta con borrar la llamada a `coDepartmentFor` en
  `resolveGoogleLocation`. No hay migración.
