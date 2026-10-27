# Inventario de tableros ATS con vacantes en Colombia

**Base:** `origin/main` en `50b661b`. **Alcance:** descubrir portales oficiales desde el lado del ATS, habilitarlos sin revisión humana cuando la evidencia es completa, leerlos con un tick priorizado y mostrar una sola vacante por puesto, siempre la oficial. SEO, descripciones y metadatos quedan fuera.

## Problema

El descubrimiento actual parte del nombre que escribe una bolsa ("SAMESU IPS Medicina Laboral SAS") e intenta adivinar su tablero. Medido en producción el 2026-10-27 ([reporte 40579329181](https://github.com/Yosmanovallos/Job-finder/actions/runs/40579329181)):

- 8.589 empresas activas; 3.792 revisadas; **105 con tablero oficial (1,2 %)**, que cubren el 4,3 % de las vacantes.
- 3.590 empresas (16.945 vacantes) sin coincidencia por nombre y sin dominio: la vía por nombre acierta en ~3 % (ADR 0006 §7).
- Computrabajo Colombia ([censo 40584309357](https://github.com/Yosmanovallos/Job-finder/actions/runs/40584309357)): 1.209 empresas objetivo, **9 con tablero (0,7 %)**, 1.187 pendientes de revisión manual. Unos 30 PRs sumaron ~9 empresas.

Los agregadores de portales oficiales ([Rezi/Jev](https://map.rezi.ai/about), [HiringCafe](https://blog.hiring.cafe/p/scaling-hiringcafe-from-0-to-1m-users)) invierten el embudo: primero inventarian tableros de ATS y después filtran por ubicación. No necesitan el nombre de la bolsa ni el dominio de la empresa. El repo ya tiene la pieza inicial (`scripts/direct-cc-tenants.ts`, Common Crawl), pero cubre solo Workday y SmartRecruiters, imprime un reporte y no alimenta el descubrimiento.

## Decisiones del dueño (2026-10-27)

1. **Remoto internacional:** se incluyen vacantes remotas regionales o globales ("Remote – LATAM", "Americas", "Anywhere") **solo si el ATS lo declara de forma explícita**, con la etiqueta de una palabra **`Internacional`**. Requiere la enmienda §13 del ADR 0006.
2. **Habilitación automática** de tableros hallados desde el lado del ATS, con las condiciones de la spec (INV-010…INV-014). La revisión humana queda solo para casos ambiguos.
3. **Costo igual o menor:** sin servicios pagos, sin APIs de búsqueda pagas, sin workflows nuevos ni horarios adicionales; el repo es público y los runners estándar de Actions no tienen costo. Render no cambia (el servidor no importa `src/direct/**`). El tamaño de Supabase se mide antes y después.
4. **Cero vacantes repetidas.**
5. **Prioridad del portal oficial** sobre las bolsas: la oficial reemplaza a sus copias, y el presupuesto de descubrimiento y lectura va primero a los tableros ATS.

## Qué significa "100 % de éxito" (medible)

No toda empresa colombiana usa un ATS público; prometer que el 100 % de las empresas tendrá portal oficial sería inventar. Los criterios de salida medibles son:

| Métrica | Meta |
|---|---|
| Tableros del inventario clasificados con evidencia (habilitado, sin Colombia, agencia, bloqueado, error, ambiguo) | 100 % |
| Tableros habilitados leídos dentro de su ventana (INV-040) | 100 % |
| Pares duplicados oficial-oficial u oficial-copia visibles en la auditoría | 0 |
| Vacantes mostradas con fecha o cierre inventados | 0 |
| Gasto mensual adicional (Render, Actions, APIs) | USD 0 |

La cobertura por empresas y por vacantes se informa aparte, como resultado, no como meta inflada.

## Fuera de alcance

SEO, sitemap, JSON-LD, Indexing API, descripciones y títulos. Las vacantes `Internacional` **no entran** en las superficies de Google en este cambio; su tratamiento SEO se coordina en el plan SEO. Upwork y Fiverr no son tableros de empleo de empresas y sus términos no permiten extracción. Las pymes sin ATS público siguen llegando por las bolsas.
