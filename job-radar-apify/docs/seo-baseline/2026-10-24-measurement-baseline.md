# Base de medición SEO y conversión — 2026-10-24

Fase 1 de `docs/SEO-GROWTH-EXECUTION-PLAN.md` (pendiente de commit en esta
rama). Solo lectura: no se cambiaron
código, configuración de GA4 ni Search Console. Lectura manual autenticada
de Search Console (propiedad de dominio `buscotrabajo.co`) y GA4
(propiedad `p547156816`) el 2026-10-24. Zona horaria de los informes no
verificada en esta lectura.

## Ventanas y latencia

- Semana actual: 16–22 oct 2026. Semana anterior: 9–15 oct 2026. Mismas
  fechas en GSC y GA4.
- GSC: datos de rendimiento finales hasta el 22 oct. El informe de
  indexación de páginas tiene última actualización 15 oct.
- GA4: el 23 oct puede estar incompleto; no se usa en la comparación.
- **Todos los datos son anteriores a las dos correcciones desplegadas el
  24 oct** (PR #14 `sign_up`, PR #15 renderizado de vacantes). Ninguna
  cifra de este documento evalúa esas correcciones.

## Search Console — semanal

| Métrica | 9–15 oct | 16–22 oct | Cambio |
|---|---:|---:|---|
| Clics | 13 | 7 | −46 % (−6) |
| Impresiones | 499 | 442 | −11 % (−57) |
| CTR | 2,6 % | 1,6 % | −1,0 pt |
| Posición media | 9,6 | 12,9 | empeora 3,3 |

Diario 16–22 oct (clics/impresiones): 2/84, 0/54, 1/62, 0/57, 2/66, 1/73,
1/46. La semana 16–22 coincide con la revisión anterior; la semana 9–15 se
toma de esa misma revisión del mismo informe.

## Search Console — 90 días (26 jul–22 oct)

Totales: 125 clics, 4.260 impresiones, CTR 2,9 %, posición 12,4.

**Países:** Colombia 96 clics / 2.837 impresiones (pos. 10,9); Venezuela
18 / 560 (15,8); Estados Unidos 3 / 498 (17,6); resto ≤1 clic.

**Aparición en búsquedas (Google Empleos):** Ofertas de empleo 30 clics /
385 impresiones (pos. 8,7); Detalles de empleos 19 / 992 (3,6). Google
Empleos ya aporta 49 de 125 clics. En GA4 existe además la fuente
`google_jobs_apply / organic`.

**Marca vs. sin marca (solo consultas visibles):** se ven 787 consultas,
que suman 56 de los 125 clics; el resto lo anonimiza Google. Con la regla
`/busco ?trabajo/` (incluye "busco trabajo.com", que puede ser otro sitio,
y frases genéricas como "busco trabajo en …"): marca 24 clics / 226
impresiones; sin marca 32 / 2.009. Es una aproximación, no una partición
exacta.

**Por tipo de página:** vacantes individuales 283 URLs, 56 clics, 1.787
impresiones; páginas `/empleos/<ciudad|rol>` 23 URLs, 26 clics, 1.576
impresiones; portada 33 / 378 (pos. 10,8); `/empresas/*` 17 URLs, 1 / 372.

### Candidatas para fases 3–4 (muchas impresiones, posición 17–33)

| Página | Clics | Impresiones | Posición |
|---|---:|---:|---:|
| /empleos/caracas | 1 | 350 | 28,6 |
| /empleos/santa-marta | 3 | 260 | 22,8 |
| /empleos/neiva | 0 | 165 | 16,7 |
| /empleos/armenia | 6 | 157 | 12,4 |
| /empleos/ibague | 5 | 129 | 13,2 |
| /empleos/valledupar | 0 | 90 | 26,5 |
| /empleos/popayan | 1 | 73 | 20,7 |
| /empleos/villavicencio | 2 | 58 | 16,1 |
| /empleos/maracay | 0 | 53 | 26,5 |
| /empleos/palmira | 5 | 45 | 20,8 |
| /empleos/valencia | 0 | 29 | 31,7 |

Consultas que las activan (90 días, impresiones/posición): "empleos
caracas" 28/30,3; "trabajos en caracas" 28/32,2; "empleos en caracas"
24/33,8; "ofertas de empleo en caracas" 21/32,3; "trabajo en neiva"
24/17,9; "trabajos en santa marta" 19/28,5; "ofertas de empleo en santa
marta" 17/28,4; "trabajo en armenia" 17/20,5; "empleos en valledupar" 11/31,2. Con impresión pero en página 2–4: el
trabajo es subir posición, no solo cambiar el snippet.

Consultas en página 1 sin clics (problema de snippet/SERP, no de
posición): "empleo bogota" 11/2,8; "trabajos remotos" 16/3,0;
"empleos manizales" 13/5,3; "empleos armenia" 12/5,8.

Observación on-page (curl, 24 oct): `/empleos/caracas` responde 200, tiene
title/H1/description/canonical correctos, ItemList y BreadcrumbList, 60
vacantes enlazadas de 922 activas, sin H2, sin enlaces a roles de la ciudad
ni a otras ciudades. `/ve/empleos/caracas` responde 200 y canonicaliza a
`/empleos/caracas`; se registra como observación, sin cambio propuesto
hasta tener un fallo concreto.

### Calidad de datos (fase 5)

- Consulta "trabajos en confidential" (13 impresiones) y página
  `/empresas/confidential-careers` (21 impresiones, indexable): un nombre
  de empresa placeholder se publica como empresa y ciudad.
- `/empresas/elempleo` (124 impresiones en 90 días; hoy responde 301) y
  consultas "elempleo", "elempleo colombia": un portal de empleo que se
  trató como empleador.

## Search Console — indexación (actualizado 15 oct)

Indexadas 484; sin indexar ≈28 mil: rastreada sin indexar 9.202,
descubierta sin indexar 6.623, 404 7.650, Soft 404 2.614 (validación
anterior: "Error"), noindex 1.437, robots.txt 423, canónica distinta 5,
redirección 2, 5xx 0. Gran parte corresponde a vacantes retiradas
(muestras anteriores respondían 410). El filtro por sitemap no se pudo
aplicar en esta lectura. El efecto de PR #15 todavía no puede aparecer.

## GA4 — semanal

| Métrica | 9–15 oct | 16–22 oct | Cambio |
|---|---:|---:|---|
| Sesiones (suma de canales) | 143 | 186 | +30 % (+43) |
| Usuarios con session_start | 131 | 167 | +27 % |
| first_visit | 126 | 158 | +25 % |
| Direct | 110 | 125 | +14 % |
| AI Assistant | 17 | 41 | +141 % (+24) |
| Referral | 6 | 11 | +83 % |
| Organic Search | 7 | 9 | +29 % (+2) |
| Organic Social | 3 | 0 | −3 |

Eventos (conteo / usuarios):

| Evento | 9–15 oct | 16–22 oct |
|---|---|---|
| view_job | 104 / 67 | 123 / 74 |
| apply_gate_open | 30 / 25 | 30 / 21 |
| sign_up | 17 / 9 | 156 / 11 |
| login | 30 / 2 | 74 / 2 |
| onboarding_complete | 6 / 6 | 10 / 10 |
| outbound_apply | 24 / 19 | 51 / 17 |

Lectura: los conteos de `sign_up`, `login` y `outbound_apply` crecen por
repetición en pocos usuarios, no por más personas. `sign_up` (156 eventos,
11 usuarios) refleja el defecto corregido en PR #14; no sirve como base de
registros. La base de eventos se reinicia desde el 24 oct.

## Señales sin verificar

- **chatgpt.com / ai-assistant** (fuente vista en el corte 17–23 oct;
  se asume la misma para 16–22): las sesiones aterrizan en vacantes
  concretas y distintas (logística en Bogotá, Neiva, Valledupar), patrón
  compatible con usuarios reales a quienes ChatGPT cita el sitio. No se
  confirmó; si es real, es un canal de adquisición, no ruido.
- **Pico Direct 18–19 oct** (≈45 sesiones/día; el resto de la semana muy
  por debajo): las sesiones Direct con interacción bajaron de 44 a 25
  mientras las sesiones subían, patrón de baja interacción. Causa no
  verificada (pruebas propias, bot o tráfico real).
- **login 74 eventos de 2 usuarios**: compatible con pruebas internas; no
  se excluye sin una regla documentada.
- GA4 no tiene definido tráfico interno; no se cambió (requiere aprobación).

## Registros reales

No medidos. Requiere conteo agregado de cuentas nuevas confirmadas en la
base de datos con una regla documentada de exclusión de pruebas; no hay
acceso autorizado desde esta sesión. No se reporta como cero.

## Estado de la fase

Base capturada; **fase abierta**.

- Ventanas completas reproducibles y latencia: cumplido (GA4 reproduce la
  revisión anterior); zona horaria pendiente de confirmar.
- Eventos sin duplicación por refresco/login: abierto hasta tener tráfico
  posterior a PR #14 (control 31 oct).
- Controles de pruebas e internos explícitos: abierto (sin tráfico interno
  en GA4 ni regla documentada de cuentas de prueba).
- Registros reales separados de eventos: separados, sin medir.

## Puntos de control y próxima acción por fase

- **31 oct (7 días tras PR #14/#15):** repetir esta lectura con 24–30 oct;
  `sign_up` usuarios ≈ eventos; Soft 404 e informe de ofertas actualizados.
- **7 nov (14 días):** indexación de la muestra de fase 2 y tendencia.
- Fase 0: cerrar gates técnicos (TS/lint/memoria) en su sesión.
- Fase 2: muestra de 12–20 URLs con inspección; tras confirmar PR #15 en
  más URLs, valorar "Validar corrección" del grupo Soft 404 (aprobación).
- Fase 3–4: empezar por Caracas, Santa Marta, Neiva, Valledupar y Armenia
  (tabla anterior); verificar intención y competidores antes de editar.
- Fase 5: `confidential` y portales como empleador.
- Fase 7/GEO: si el canal chatgpt.com se confirma, medirlo por separado.
- Medición: definir tráfico interno en GA4 y regla de cuentas de prueba.
