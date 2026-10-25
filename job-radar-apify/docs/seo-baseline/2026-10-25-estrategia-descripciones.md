# Estrategia: descripciones completas para vacantes de LinkedIn y Computrabajo (2026-10-25)

## 0. Qué NO se toca

- Los listados de LinkedIn y Computrabajo siguen como están: no se apaga ni se
  modifica nada de la ingesta. El PR #23 solo cambia cómo se *registra* un
  rechazo en la etapa de detalle. Además, ese circuito es independiente:
  `LinkedIn-detail` y `Computrabajo-detail` son distintos de `LinkedIn` y
  `Computrabajo`, que son los del listado.
- No se relaja `assessDescription()` y no se inventa texto.

## 1. Por qué una vacante sin descripción es `noindex`

No es una propuesta nueva: es el estado actual desde Job SEO V2 (sept-2026).
Google exige una descripción real en `JobPosting`. Una página con solo
título, empresa y ciudad es contenido delgado: Google la marca como Soft 404 o
la ignora, y eso perjudica al resto del sitio. Las vacantes siguen **visibles
en BuscoTrabajo** (dashboard, búsquedas, hubs). Lo único que no reciben es su
propia ficha indexada. Por eso el objetivo es **conseguir la descripción por
una vía permitida**, no indexar páginas vacías.

## 2. Tamaño del problema (Supabase, solo conteos, 14:40 UTC)

Vacantes activas sin descripción y, por tanto, no aptas para Google:

| Fuente | Atascadas | Empresas | Concentración en las 50 primeras | Ya cubiertas por un portal oficial |
|---|---|---|---|---|
| LinkedIn-CO | 10.542 | 3.740 | 2.571 (24 %) | 406 |
| Computrabajo-CO | 4.636 | 1.107 | 2.908 (63 %) | 79 |
| LinkedIn-VE | 821 | 442 | — | 0 |
| Computrabajo-VE | 307 | 104 | — | 0 |

Las primeras empresas son pocas y conocidas:

- **Computrabajo:** Adecco, Manpower, Eficacia, Nexa BPO, Comfama, Concentrix,
  Gi Group, Ocupar, Comfenalco, Gente Útil, Jiro, Activos, Redes Humanas,
  Proservis, entre otras.
- **LinkedIn:** BairesDev, Colección Talento, EPAM, Fullstack, MetLife,
  Salesland, Bancolombia, Softtek, WSP, Keralty, AgileEngine, Bold, entre otras.
- **Confidencial:** 915 en Computrabajo y 210 en LinkedIn. Esta parte no tiene
  solución vía empresa.

## 3. Palancas, en orden de impacto y seguridad

### A. La misma vacante desde el portal oficial de la empresa (prioridad 1)

La infraestructura ya existe (iniciativa direct-employers, ADR 0006 §10). Cuando
una empresa tiene ATS oficial, su vacante oficial, con descripción completa, se
proyecta en `jobs` y **reemplaza** la copia de LinkedIn o Computrabajo.

- Verificado hoy: **MetLife** tiene tablero público en Lever (`metlife`) con 39
  vacantes, todas en Colombia. Tenemos 65 vacantes suyas de LinkedIn sin
  descripción. El sondeo automático por nombre no la había encontrado.
- Bancolombia (SuccessFactors) y Concentrix (Workday) ya están cubiertas.
- Siguiente paso: investigar a mano las 50 empresas con más vacantes atascadas
  por fuente. El sondeo por nombre falla con ellas porque no tienen dominio
  registrado. Hay conectores para Greenhouse, Lever, Ashby, Workday,
  SuccessFactors, Phenom, Eightfold, Teamtailor y Magneto oficial. Cada empresa
  se añade con verificación y solo si sus términos lo permiten (ADR 0006).
- Impacto máximo: hasta ~5.500 vacantes concentradas en las 100 primeras
  empresas. El valor real se medirá empresa por empresa.

### B. Acuerdos de feed con agencias de empleo (prioridad 2)

En Computrabajo, el atasco lo dominan agencias como Adecco, Manpower, Gi Group,
Comfama, Comfenalco, Eficacia, Nexa BPO y Gente Útil. A las agencias les
interesa la distribución gratuita, y muchas ya exportan feeds XML a
agregadores. Se les puede pedir el feed con permiso escrito y conectarlo como
fuente oficial. Lo hace el propietario (contacto comercial); yo preparo el
conector cuando haya feed.

### C. Hubs indexables que sí aprovechan estas vacantes (prioridad 2, en paralelo)

Una vacante sin descripción no puede tener su propia ficha indexada, pero
**sí** puede aparecer en páginas permanentes indexables de ciudad, rol o empresa
(Fase 4). Esas páginas tienen texto propio y varias vacantes reales, así que
Google las acepta. Hay que confirmar que los hubs incluyen estas vacantes
atascadas y no solo las aptas, para que las 15.000 aporten valor SEO desde hoy.

### D. Acceso autorizado a las plataformas (prioridad 3, lo gestiona el propietario)

- **LinkedIn:** su `robots.txt` remite a `whitelist-crawl@linkedin.com` para
  rastreo autorizado. Con la lista blanca, el volumen de detalle se puede
  ampliar sin riesgo. Sin ella, no recomiendo subir el ritmo de detalle (hoy
  quedan 10.216 en cola).
- **Computrabajo:** su empresa matriz, Redarbor, publica vacantes en
  agregadores. Se puede pedir un feed de socio. La caída de Computrabajo-CO del
  07-oct coincide con el cambio de dominio a `co.computrabajo.com`, que bloquea
  las peticiones directas. "Arreglarla" apuntando el proxy al nuevo dominio
  sería ampliar un bypass anti-bot, así que no lo implemento. La vía es el
  acuerdo.

## 4. Plan de ejecución

1. **Semana 1:** investigación de ATS de las 50+50 empresas principales (agente
   `source-researcher`). Alta de MetLife (Lever) y de las que se verifiquen.
   Medir cuántas copias se reemplazan.
2. **Semana 1:** auditar los hubs de ciudad, rol y empresa para incluir
   vacantes sin descripción (sin JobPosting individual).
3. **Semanas 1–2 (propietario):** correos a LinkedIn (lista blanca),
   Computrabajo/Redarbor (feed) y las 5 agencias principales (feed XML).
4. **Medición:** checkpoints del 31-oct y del 7-nov, con
   `seo_ready_active` por fuente, el conteo de `sitemap-jobs.xml` (hoy 7.727)
   y las copias reemplazadas por vacantes oficiales.

## 5. Palanca A — primera tanda (2026-10-25)

| Empresa | Atascadas en bolsas | Portal oficial | Estado |
|---|---|---|---|
| MetLife | 65 (LinkedIn) | Lever `metlife` (39 vacantes, todas en Colombia) | Añadida al seed |
| Softtek | 66 (LinkedIn) + 5 (Elempleo) | Eightfold `softtek.eightfold.ai` (64 en Colombia; robots permite `/api/pcsx`) | Añadida al seed |
| Bancolombia, Concentrix | — | SuccessFactors / Workday | Ya cubiertas |
| Keralty | 46 | Publica en Magneto (página de empresa) | La recoge el drenaje de Magneto (PR #24) |
| EPAM | 139 | `careers.epam.com`, sitio propio; robots prohíbe `/api` | Necesita un conector de sitio (sitemap + JSON-LD); pendiente |
| BairesDev, AgileEngine, Bold, WSP, Salesland, Bruntwork | 38–215 c/u | No hay un ATS público detectable en el HTML (sitios con JS) | Investigar uno por uno |
| Agencias (Adecco, Manpower, Gi Group, Comfama…) | ~600 | Sitios propios | Vía palanca B (feed con permiso) |

Para que las empresas nuevas aparezcan en producción hay que aplicar el seed
(workflow `direct-employers-tick`, modo `seed`). Eso escribe en la base de
producción, así que requiere aprobación explícita.
