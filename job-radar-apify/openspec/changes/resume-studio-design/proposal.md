# AI Resume Studio — diseño (sin implementación)

**Base:** `origin/main` en `320fcec`. **ADR:** `docs/adr/0015-resume-studio-design-thaw.md`.
**Alcance:** documentación, mockups y un prototipo aislado con datos sintéticos.

## Problema

AdSense rechazó el sitio por «contenido de poco valor». El propietario quiere
una herramienta original y de pago: crear o mejorar la hoja de vida y
adaptarla a una vacante real del sitio, con IA, sin tocar la gratuidad de las
vacantes. El CV Generator anterior se retiró el 2026-10-18 y está congelado.

## Decisión del propietario

- Descongelar solo diseño y documentación (ADR 0015).
- Producto de pago; el pago va al final, después de todo el trabajo gratis.
- Costo de IA casi nulo; el proveedor lo define primero la ley colombiana.
- Design system propio de BuscoTrabajo.

## Entregables

`docs/resume-studio/` — documentos 01–10, README con el resumen para decidir,
`mockups/resume-studio-prototype.html` (12 pantallas, escritorio y móvil,
pago simulado) y `mockups/sample-job-2026-11-14.json` (vacante pública).

## Contrato

- Ningún cambio en `src/`, esquema, migraciones, variables, Render, Wompi o Supabase.
- `PAYWALL_ENABLED` sigue en `false`.
- Ningún dato de personas reales en los entregables.
- La fase termina en aprobación humana (Fase 6). La implementación (R0–R5,
  doc 10) necesita un ADR nuevo con autorización explícita.
