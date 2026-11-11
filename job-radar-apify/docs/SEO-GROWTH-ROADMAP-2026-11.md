# Hoja de ruta SEO/GEO/AEO hacia 1.000 registros al día (noviembre 2026)

Fecha: 2026-11-07. Es la **única lista de prioridades vigente**. Sustituye a
estas secciones de `docs/seo-baseline/2026-11-keyword-study.md`: §6, las
conclusiones de §6b y §8.6. También ordena las fases A–F del checkpoint
`docs/seo-baseline/2026-11-06-checkpoint-y-plan-registros.md`.

Cada fase de código es un cambio OpenSpec en `openspec/changes/<id>/`, con una
fase por sesión. Según `openspec/README.md`, solo la fase siguiente tiene el
cambio completo; la posterior lleva solo `proposal.md`.

## 1. Meta y ritmo

La meta del propietario es **1.000 registros al día**, solo con tráfico
orgánico y sin pagar. Hoy son unos 30–50 al día sin picos y ~350 sesiones al
día. Con la conversión actual (1 registro cada 5–6 sesiones) hacen falta
~5.500 sesiones al día. Hitos de trabajo, no pronósticos: 100/día a fin de
noviembre, 250 a fin de enero, 500 a fin de marzo y 1.000 en mayo–junio.

**Fecha límite estacional:** enero es el pico de búsqueda de empleo (Trends,
§6b del estudio). Las páginas nuevas tienen que estar **indexadas antes de
diciembre**.

## 2. Diagnóstico unificado (los dos estudios juntos)

Fuentes:
- GSC de 28 días;
- Google Trends con ancla común (§6b);
- Ubersuggest, cuenta gratuita del propietario (§8);
- top 10 de la SERP de Bing.

Ubersuggest da volúmenes estimados por un tercero. Trends da un índice
relativo de Google. Cuando no coinciden, se ordena por lo que **sí**
comparten, y deciden la guarda de inventario y GSC después del lanzamiento.

1. **Las vacantes ganan en Google Empleos; los hubs no ganan el resultado
   orgánico.** Comprobado en GSC el 2026-11-07 con la vista «aparición en
   búsquedas». Las impresiones de vacantes en búsquedas de ciudad o intención
   son casi todas de Google Empleos:
   - «bogota»: 124 de 164 en «Detalles de empleos»;
   - «medellin»: 257 de 315 en «Ofertas de empleo»;
   - «sin experiencia»: 267 de 317 en «Ofertas de empleo».

   El resultado orgánico lo ganan Computrabajo y elempleo (autoridad alta).
   Nuestros hubs están en la posición 10–46 o no aparecen. Por eso:
   - **nunca se debilitan las vacantes** para ayudar a los hubs: ni
     `noindex`, ni trucos de canonical, ni quitar la ciudad del título;
   - los hubs se fortalecen con contenido propio, enlaces internos y enlaces
     externos.
2. **El patrón que gana es intención y ciudad × intención.** La página más
   visitada de Computrabajo CO es «Bogotá sin experiencia» (~49,6 K
   visitas/mes estimadas), por encima de «Bogotá» (33,4 K). Las dos fuentes
   lo confirman:
   - **remoto**: Trends 182 (con «trabajo en bogota» = 100) y Ubersuggest
     40,5 K, SD 17;
   - **sin experiencia**: Trends 145; Ubersuggest 9,9 K nacional, 18,1 K
     Bogotá, 6,6 K Cali y 4,4 K Medellín;
   - fines de semana (12,1 K), medio tiempo (Medellín 3,6 K, Cali 2,4 K) y
     por días.
3. **Remoto es la mayor demanda en los dos países**, y en Venezuela es la
   página n.º 1 de Computrabajo VE. Tenemos 2.528 vacantes remotas en CO y
   1.290 en VE. Sin embargo:
   - `/empleos/remoto` recibe ~49 impresiones en 28 días;
   - **`/ve/empleos/remoto` sirve vacantes de Colombia**, con canonical a
     `/empleos/remoto`;
   - Venezuela no tiene página de remoto propia.
4. **Ciudades.** Las dos fuentes coinciden en el primer grupo: Bogotá, Cali,
   Medellín, Barranquilla, Bucaramanga y Cartagena (CO), y Caracas (VE).
   Para las ciudades pequeñas no coinciden: Ubersuggest da 2,9 K a
   Barrancabermeja y a Maturín, y Trends las deja cerca de 0. Esa
   comparación mezcla formulaciones distintas («empleos X» frente a «trabajo
   en X») y valores de Trends por debajo de 5, que son casi ruido, así que
   **no se concluye** que una fuente infle. Las ciudades pequeñas esperan a
   tener inventario, la guarda y datos de GSC.
5. **Formulación.** Trends da que «trabajo en X» se busca ~2 veces más que
   «empleos X». El cambio `city-hub-pages` (archivado a medias) pasó los
   títulos de «Trabajo en …» a «Empleos en …». Volver atrás solo se hace
   como **experimento con hubs de control**, en un cambio aparte.
6. **La marca pesa mucho.** «computrabajo» tiene ~29 veces la demanda de
   «trabajo en bogota». TikTok orgánico ya probó que funciona: ~54 mil
   vistas trajeron ~400 registros. La marca y los enlaces son una palanca
   SEO.
7. **Enlaces.** Bing ve 1 dominio de referencia (x.com). Una página del top
   10 de cola larga tiene de media ~3 backlinks, así que la barrera es tener
   la página correcta más unos pocos enlaces buenos hacia ella.
8. **Ya resuelto en producción (Fase B):** sitemap de vacantes recientes,
   «Nuevas hoy» en los hubs, IndexNow diario y meta descriptions de
   empresas.

## 3. Prioridades (orden vigente)

| # | Trabajo | Por qué | Cambio OpenSpec | Cuándo |
|---|---|---|---|---|
| 1 | ✅ **Páginas de intención y remoto:** `/ve/empleos/remoto` real, `/empleos/sin-experiencia`, `/ve/empleos/sin-experiencia`, `/empleos/bogota/sin-experiencia`; `/empleos/remoto` con filtro de modalidad (copia congelada hasta el 2026-11-26) | Mayor demanda medida | `seo-intent-pages`, en producción el 2026-11-07 (PR #123 y #124) | Hecho; checkpoints a +14 y +28 días |
| 2 | ✅ **Atribución de registros** y enlace `/tiktok` (Fase A) | Sin esto no se sabe qué canal trae registros | En producción el 2026-11-07 (PR #127, migración aplicada) | Hecho |
| 3 | **Autoridad de los hubs existentes:** contenido propio, enlaces internos desde vacantes y empresas, enlaces externos | Los hubs pierden el resultado orgánico | `seo-hub-authority` (solo propuesta) | Después de la lectura del 2026-11-26 de `city-hub-pages`, `city-hub-stats`, `job-link-graph` y `home-role-hubs`, para no contaminar sus mediciones |
| 4 | ✅ **Segunda ola de intención:** Medellín (33) y Cali (15) sin experiencia, fines de semana, medio tiempo (por días y temporada si los datos lo justifican) y **Puerto Ordaz dentro de `/empleos/ciudad-guayana`** (Ubersuggest 1,9 K frente a 390), solo si Ciudad Guayana no está en una medición abierta | Demanda alta; las URL nuevas no contaminan las mediciones | `seo-intent-wave2` | En producción el 2026-11-07 (PR #129); checkpoints a +14 y +28 días |
| 4b | 🔄 **Cobertura base:** página índice `/empleos` y `/ve/empleos`, y 12 hubs de ciudad con guarda (Barrancabermeja, Yopal, Rionegro, Soacha, Zipaquirá, Tocancipá, Facatativá, Apartadó, Quibdó, Fusagasugá, Maturín, Lechería) | `/empleos` respondía 404; hay consultas en GSC para ciudades sin hub (lectura del 2026-11-10) | `seo-empleos-coverage`, ADR 0014 | Implementado en la rama el 2026-11-10, sin desplegar |
| 5 | **Experimento de título «Trabajo en {ciudad}»** en 3–5 hubs con control | Trends da 2×; revierte `city-hub-pages` | Cambio propio de experimento | Después del 3 |
| 5b | **Experimento en la portada:** «buscador de empleos» (Ubersuggest 12,1 K, SD 54) y «bolsa de empleo» (14,8 K, SD 16) en la descripción o un H2, sin quitar «busco trabajo» (marca) | Consejo del video con datos de §8.5; experimento medido 28 días | Cambio propio de experimento | Después de la lectura de `home-role-hubs` (2026-11-26) y **sobre la portada SSR del PR #112** (sin desplegar) |
| 6 | **AEO/GEO:** bloques de respuesta con datos reales en hubs e intención (cuántas vacantes, empresas, modalidad) y `llms.txt`/API en sincronía | ChatGPT ya trae el 12 % de las sesiones y cita hubs | Cambio propio | Enero |
| 7 | **Alertas de vacantes** para registrados | Dan razón para registrarse y volver; necesitan aprobación para enviar correos (Ley 1581) | Cambio propio | Enero |
| 8 | **Difusión orgánica:** TikTok con cadencia, informe mensual de empleo con datos propios (enlaces de prensa), SENA/universidades/alcaldías | La marca y los enlaces son el límite de autoridad | Sin código | Desde ya, continuo |

**Comprobado el 2026-11-07:** las vacantes que llegan con `utm_*` (Google Empleos) tienen canonical a la URL limpia; no hace falta cambio.

**Limpieza menor detectada**, revisarla en el cambio 3 con el runbook SEO:
- `/empresas/elempleo` posiciona por la marca de un competidor;
- `/ve/dashboard` posiciona por «trabajo en venezuela», cuando debería
  hacerlo un hub;

## 4. Puertas comunes a todas las fases

- **Datos:** nada inventado. Las cifras y los bloques salen de datos reales
  o se omiten.
- **Guarda de páginas:** una página nueva es indexable solo con al menos 10
  vacantes por clasificador real. Por debajo de eso lleva `noindex`, no entra
  en el sitemap y no recibe enlaces internos.
- **Rendimiento:**
  - TTFB MISS ≤ +10 % frente a la base del runbook;
  - cualquier trabajo por petición se mide con datos del tamaño de
    producción (lección del incidente de memoria del #117);
  - Render se queda en Starter.
- **Hidratación:** el primer render del servidor y del cliente tienen que
  ser idénticos.
- **Pruebas:** con reloj fijo (lección de la prueba de SuccessFactors).
  Antes de declarar listo: `tsc`, build, `test:unit`, `test:seo` y
  `/seo drift compare`.
- **Contratos públicos:** API, MCP, `llms.txt` y OpenAPI se actualizan
  juntos. Un cambio de contrato requiere ADR (AGENTS regla 13).
- **Despliegue:** merge y despliegue solo con aprobación explícita por PR.

## 5. Medición

- **Checkpoints:** 2026-11-12, 2026-11-26 y luego semanales.
- **GSC:**
  - clics e impresiones por tipo de página (portada, `/empleos/<uuid>`,
    hubs, intención);
  - aparición en búsquedas (Google Empleos frente a orgánico);
  - posición de cada URL nueva.
- **Registros:** base de datos (fuente de verdad) y GA4 por canal. Desde la
  Fase A, también por página de llegada.
- **Bing:** URL conocidas (eran 194), impresiones y citas en Copilot.
