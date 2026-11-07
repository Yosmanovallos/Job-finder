# Tareas — employment-type-trust

## 1. Atribución por fuente (solo lectura, necesita al propietario)

- [x] `scripts/count-employment-type-by-source.ts`: `BEGIN READ ONLY`,
      timeout de 60 s, `ROLLBACK`; solo agregados.
- [x] Consulta equivalente corrida con autorización del propietario
      (2026-11-07, `BEGIN READ ONLY`, 424 ms); resultado en `validation.md` §1.
- [x] Computrabajo descartado (1 fila «Medio tiempo»): no hace falta
      comprobar la ruta `translate.goog`.

## 2. Evidencia de la fuente

- [x] 10 fichas públicas de Computrabajo, 9 de Magneto y 12 de Elempleo,
      JSON-LD frente al texto visible (`validation.md` §2).

## 3. Código y pruebas

- [x] Pruebas ETT-001…007 con fixture sintética
      `tests/fixtures/detail/magneto-contract-term-synthetic.html`.
- [x] `src/lib/employment-type-trust.ts` y su uso en `job-seo.ts`,
      `public-jobs-api.ts` y `job-repository.ts`.
- [x] `validate-employment-type-trust.test.ts` en la suite `unit`.

## 4. Verificación antes del merge

- [x] `npx tsc --noEmit` (0 errores), `npm run build`, `npm run test:integration` y
      `npm run test:unit`, `npm run test:seo`.
- [ ] `/seo drift compare` contra las URLs de baseline
      (`docs/SEO-IMPROVEMENT-PLAN.md` §2), incluida al menos una vacante de
      Magneto y otra de Elempleo: solo deben cambiar `employmentType` y la línea «Tipo de empleo».
- [ ] Rich Results Test sobre una vacante de Magneto y otra de Elempleo: siguen siendo válidas.
- [ ] Aprobación del propietario para merge y despliegue.

## 5. Después del despliegue (opcional, con aprobación aparte)

- [ ] Volver a contar: 0 JobPosting de Magneto o Elempleo con `employmentType`.
- [ ] Revisar LinkedIn (44 «Medio tiempo»): no se comprobó en esta fase.
- [ ] Fase aparte opcional: leer «Jornada laboral» visible de Elempleo
      (design D4).
- [ ] Decidir si se notifica `URL_UPDATED` en lotes (design D3).
- [ ] Decidir si se limpia `employment_type` de Magneto con un backfill o se
      deja el crudo (design D2). Escritura en producción: requiere su propia
      autorización.
