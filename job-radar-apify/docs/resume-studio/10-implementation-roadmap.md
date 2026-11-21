# 10 — Implementation Roadmap

**Fecha:** 2026-11-14 (actualizado 2026-11-21, R0) · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

> **Implementación autorizada el 2026-11-21** por el
> [ADR 0017](../adr/0017-resume-studio-implementation.md) (antes: ADR 0015,
> solo diseño). Una fase por sesión, cada una con su cambio OpenSpec en
> `openspec/changes/` y archivo al completar.
>
> **La tabla de fases vigente es la del [doc 11 §8](11-jobstep-replica.md)**
> (flujo por link). Donde la tabla «Fases» de abajo difiera (p. ej. R1 «Base
> sin IA» frente a R1 «CV base: subir/extraer/confirmar»; R2 «Extracción +
> PDF» frente a R2 «Resolver de links»), manda el doc 11 §8 y el ADR 0017.

## Regla del propietario (2026-11-14): nada a producción hasta el 100 % [V]

**Ninguna parte del Resume Studio se despliega en producción hasta que todo
el plan (R0–R4 y los criterios de salida de cada fase) esté completo y
funcionando.** Esto incluye código apagado por bandera: no se mergea a
`main` (que despliega a Render) ninguna fase suelta.

Cómo se trabaja entonces:

- Cada fase R0–R4 se construye en su propia rama `codex/resume-studio-rN`
  sobre una rama de integración `codex/resume-studio`, nunca sobre `main`.
- Las pruebas corren en local y en el Postgres desechable de
  `npm run test:integration`; los pagos solo en el sandbox de Wompi; la IA
  solo con datos sintéticos.
- Las migraciones `rs_*` se escriben y prueban en el contenedor desechable,
  pero **no se ejecutan en Supabase** hasta el lanzamiento.
- R5 deja de ser «lanzamiento gradual de fases» y pasa a ser **un único
  merge** de la rama de integración a `main`, cuando todo está verde y el
  propietario lo aprueba. Después del merge, las banderas permiten abrirlo
  por porcentajes (10 % → 50 % → 100 %) y apagarlo si algo falla.

## 0. Antes de R1 (decisiones del propietario y terceros) [?]

| #   | Decisión / trámite                                                                                            | Responsable                         |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| D1  | ~~Aprobar el diseño y escribir el ADR de implementación~~ **Resuelto 2026-11-21: ADR 0017**                    | Propietario                         |
| D2  | Precio final de los pases sin renovación. Propuesta vigente (rev. 2 / doc 11): 1 mes COP 14.900, 3 meses COP 29.700 en un pago, 7 días COP 6.900. Sustituye la anterior de COP 9.900 por CV. **Abierto** | Propietario |
| D3  | ~~Gemini en Vertex AI~~ **Resuelto 2026-11-21 (ADR 0017): Qwen en Alibaba Cloud Model Studio, Virginia, alcance «US»**; modelo por defecto exacto se confirma en consola en R3 | Propietario |
| D4  | Revisión legal (doc 07 §8)                                                                                    | Abogado                             |
| D5  | Condición tributaria y facturación (IVA, retenciones)                                                         | Contador                            |
| D6  | Auditoría de solo lectura de las tablas viejas del CV Generator en Supabase                                   | Propietario aprueba; agente ejecuta |
| D7  | ¿Solo Colombia en el MVP?                                                                                     | Propietario                         |

## Fases

| Fase                       | Contenido                                                                                                                                                                                                                                                                                                                                        | Depende de                              | Criterio de salida                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0 — Preparación**       | ADR de implementación; actualizar AGENTS.md, `PROD-IMPROVEMENTS-PLAN.md`; cambio OpenSpec `resume-studio-r1`; política de privacidad v2026-11 en borrador                                                                                                                                                                                        | D1, D4 (borrador)                       | Textos aprobados; nada desplegado                                                                                                            |
| **R1 — Base sin IA**       | Tablas `rs_*` (migración aditiva), rutas detrás de `RESUME_STUDIO_ENABLED=false`, onboarding, autorización (S3) con `rs_consents`, crear desde cero, 3 plantillas, vista previa, edición manual, versiones, deshacer, borrar/exportar                                                                                                            | R0, D6                                  | lint, typecheck, unit, integration verdes; T-IDOR, T-DEL, T-FREE verdes; Lighthouse de vacantes sin cambio                                   |
| **R2 — Extracción + PDF**  | Subida PDF/DOCX con validaciones, revisión campo a campo, PDF en el cliente                                                                                                                                                                                                                                                                      | R1                                      | T-FILE-1..8 verdes; golden set ≥ 95 %; memoria de Render estable en carga simulada                                                           |
| **R3 — IA y análisis**     | Gateway con alias y presupuesto, extracción LLM, chat con propuestas, análisis vs. vacante, puntuación, recomendaciones con preguntas                                                                                                                                                                                                            | R2, D3, contrato de transmisión firmado | Evals §4 del doc 09: 0 hechos inventados aceptados; T-INJ verdes; costo real ≤ USD 0,02 medio; beta cerrada con 10–20 usuarios que autorizan |
| **R4 — Pago**              | Pases de pago único sin renovación (antes `resume_unlock`) en Wompi (sandbox → producción), H1/H2 corregidos, `rs_entitlements`, términos del pago                                                                                                                                                                                                                                 | R3, D2, D5                              | T-PAY-1..5 verdes en sandbox; pago real de prueba del propietario y reembolso                                                                |
| **R5 — Lanzamiento único** | R0–R4 completos y verdes en la rama de integración; aprobación explícita del propietario; un solo merge a `main`; migraciones `rs_*` ejecutadas en Supabase; luego `RESUME_STUDIO_JOB_CTA` al 10 % → 50 % → 100 % de vacantes; landing `/hoja-de-vida` con guías editoriales; actualizar llms.txt/runbook de agentes solo si cambia algo público | R4                                      | Clic en «Aplicar» sin caída; métricas del doc 02 §6; sin incidentes 2 semanas                                                                |

## Rollback por fase

- Cualquier fase: `RESUME_STUDIO_ENABLED=false` → 404 en todo el módulo; las
  vacantes no dependen de él.
- Pagos: `RESUME_STUDIO_PAYMENTS=false` → no se crean checkouts; los
  desbloqueos existentes se respetan.
- IA: `RESUME_AI_PROVIDER=none` → solo edición manual.
- Tablas `rs_*`: se conservan (migraciones solo aditivas); borrado de datos
  personales por el job de retención o a pedido del titular.

## Lo que no entra en ningún paso

Postulación automática, cartas automáticas enviadas, venta de datos,
compartir CV con empleadores, suscripción con renovación, cambios al paywall
de vacantes, cambios a scrapers/adaptadores, a la búsqueda o a la caché del
dashboard, subida de plan de Render.
