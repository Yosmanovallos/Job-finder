# 10 — Implementation Roadmap

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

> **Nada de esto empieza sin aprobación explícita del propietario** (ADR 0015,
> prompt maestro §12 Fase 7). Una fase por sesión, cada una con su cambio
> OpenSpec en `openspec/changes/` y archivo al completar.

## 0. Antes de R1 (decisiones del propietario y terceros) [?]

| # | Decisión / trámite | Responsable |
|---|---|---|
| D1 | Aprobar el diseño (este paquete) y escribir el ADR que levanta el congelamiento de implementación | Propietario |
| D2 | Precio: COP 9.900 IVA incluido (recomendado) o COP 12.900 | Propietario |
| D3 | Proveedor de IA: Gemini 2.5 Flash-Lite de pago (recomendado) + respaldo gpt-5-nano | Propietario |
| D4 | Revisión legal (doc 07 §8) | Abogado |
| D5 | Condición tributaria y facturación (IVA, retenciones) | Contador |
| D6 | Auditoría de solo lectura de las tablas viejas del CV Generator en Supabase | Propietario aprueba; agente ejecuta |
| D7 | ¿Solo Colombia en el MVP? | Propietario |

## Fases

| Fase | Contenido | Depende de | Criterio de salida |
|---|---|---|---|
| **R0 — Preparación** | ADR de implementación; actualizar AGENTS.md, `PROD-IMPROVEMENTS-PLAN.md`; cambio OpenSpec `resume-studio-r1`; política de privacidad v2026-11 en borrador | D1, D4 (borrador) | Textos aprobados; nada desplegado |
| **R1 — Base sin IA** | Tablas `rs_*` (migración aditiva), rutas detrás de `RESUME_STUDIO_ENABLED=false`, onboarding, autorización (S3) con `rs_consents`, crear desde cero, 3 plantillas, vista previa, edición manual, versiones, deshacer, borrar/exportar | R0, D6 | lint, typecheck, unit, integration verdes; T-IDOR, T-DEL, T-FREE verdes; Lighthouse de vacantes sin cambio |
| **R2 — Extracción + PDF** | Subida PDF/DOCX con validaciones, revisión campo a campo, PDF en el cliente | R1 | T-FILE-1..8 verdes; golden set ≥ 95 %; memoria de Render estable en carga simulada |
| **R3 — IA y análisis** | Gateway con alias y presupuesto, extracción LLM, chat con propuestas, análisis vs. vacante, puntuación, recomendaciones con preguntas | R2, D3, contrato de transmisión firmado | Evals §4 del doc 09: 0 hechos inventados aceptados; T-INJ verdes; costo real ≤ USD 0,02 medio; beta cerrada con 10–20 usuarios que autorizan |
| **R4 — Pago** | Producto `resume_unlock` en Wompi (sandbox → producción), H1/H2 corregidos, `rs_entitlements`, términos del pago | R3, D2, D5 | T-PAY-1..5 verdes en sandbox; pago real de prueba del propietario y reembolso |
| **R5 — Lanzamiento gradual** | `RESUME_STUDIO_JOB_CTA` al 10 % → 50 % → 100 % de vacantes; landing `/hoja-de-vida` con guías editoriales; actualizar llms.txt/runbook de agentes solo si cambia algo público | R4 | Clic en «Aplicar» sin caída; métricas del doc 02 §6; sin incidentes 2 semanas |

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
