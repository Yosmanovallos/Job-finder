# OpenSpec — job-radar-apify

Artefactos spec-driven del roadmap de mejoras de producción
(`docs/PROD-IMPROVEMENTS-PLAN.md`). Un cambio = una fase del roadmap.

## Convenciones

Cada cambio activo vive en `changes/<id-del-cambio>/`:

```
changes/<id>/
  proposal.md   — por qué y qué (problema, evidencia, resultado esperado)
  design.md     — contratos, consultas, límites, compatibilidad, rollback
  tasks.md      — checklist: tests que fallan primero, implementación,
                  validaciones, pasos de publicación
  specs/<capability>/spec.md — requisitos observables y escenarios
                               (delta: solo comportamiento que cambia)
```

- Las specs describen **comportamiento observable**, no nombres internos.
- Al completarse y desplegarse, el cambio se mueve a `changes/archive/`.
- P0 y P1 se implementaron antes de adoptar esta estructura: sus carpetas
  en `archive/` son registros retrospectivos, no specs previas al código.
- Requisitos con IDs trazables (`SMP-001`, `OBS-001`, …): requisito →
  escenario → prueba → resultado → decisión de despliegue.
- Una fase por sesión. No crear artefactos de fases futuras antes de
  tiempo salvo el `proposal.md` borrador de la fase siguiente.
