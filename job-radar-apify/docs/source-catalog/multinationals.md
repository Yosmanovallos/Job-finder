# Multinacionales grandes con operación en Colombia — portal y ATS (2026-10-20)

Leyenda: [DOC] oficial · [OBS] observado hoy, no garantizado · [NV] no verificado. Canario: `scripts/direct-canary.ts <ats> <ref> --detail-budget 100`, >= 3 s entre canarios; ningún 429 en esta pasada. "Vigentes" = campo `vigentes` del canario (<= 30 días). Nada se escribió en el repo ni en la BD.
Ya cubiertas por el seed (no repetidas): Avianca, Bancolombia, Sura, Claro, DHL, P&G, Sanofi, Mercado Libre, Bayer, HP, Microsoft, Sitel (= Foundever), Concentrix, Cisco, Roche, Fiserv, Merck, Ericsson, Abbott, Diageo, Baxter, EY, Scotiabank, Kyndryl, BBVA, Visa, etc.

## Tabla A — listas para el seed con conector existente (canario completo)

| slug | displayName | atsType | ats_ref | Vigentes CO | Tablero CO | Evidencia de propiedad |
|---|---|---|---|---|---|---|
| ups | UPS | phenom | `www.jobs-ups.com/ccsa/es` | **43** | 48 / 5 >30d | `jobs-ups.com` es el dominio de carreras de UPS [OBS]; no se vio enlace desde ups.com: propiedad media. Es el sitio regional "ccsa"; incluye Medellín (GBS) |
| medtronic | Medtronic | workday | `medtronic/wd1/MedtronicCareers` | **17** | 17 (tablero 20) | tenant homónimo; el JSON de Workday no trae `hiringOrganization`, la descripción nombra a Medtronic [OBS]; "Bogotá, Colombia". Propiedad media. (El catálogo previo reportó "forma inesperada": hoy el canario completó, intermitente) |
| hpe | Hewlett Packard Enterprise | phenom | `careers.hpe.com/us/en` | **6** | 9 / 3 >30d | `careers.hpe.com` es el sitio de carreras de HPE. Empresa distinta de HP Inc (seed `hp`) |
| mondelez | Mondelez International | workday | `mdlz/wd3/External` | **6** | 8 CO de 12 leídas (tablero 15) / 2 >30d | tenant `mdlz` = ticker de Mondelez; mondelezinternational.com/careers no enlazó al tenant en lo leído: propiedad media-baja |
| abb | ABB | phenom | `careers.abb/global/en` | **5** | 6 / 1 >30d | `careers.abb` es el dominio de carreras de ABB (huella Phenom en su HTML) |
| pfizer | Pfizer | workday | `pfizer/wd1/PfizerCareers` | 2 | 2 (tablero 3) | tenant homónimo; pfizer.com dio 403; descripción nombra a Pfizer [OBS]. Propiedad media |
| gsk | GSK | workday | `gsk/wd5/GSKCareers` | 2 | 2 | tenant homónimo; gsk.com sin enlace en HTML estático; descripción nombra a GSK. Propiedad media |

Suma de vigentes: 43+17+6+6+5+2+2 = **81** en 7 empresas. Con propiedad "media" (homónimo sin enlace) conviene decisión del dueño antes de habilitar: el endpoint CXS de Workday no devuelve `hiringOrganization`.

Verificadas con 0 en Colombia (no incluir): Santander `santander/wd3/SantanderCareers` (propiedad confirmada: santander.com/en/careers enlaza ese tenant; tablero 1, 0 CO), Autodesk `autodesk/wd1/Ext` (3 vacantes, 0 CO; autodesk.com dio 403), FedEx `fedex/wd1/FXE-LAC_External_Career_Site` (119, 0 CO; puede no ser el site correcto), AstraZeneca `eightfold astrazeneca.eightfold.ai@astrazeneca.com` (careers.astrazeneca.com enlaza `astrazeneca.eightfold.ai`; el canario dio tablero 0: el ref puede ser otro, [NV]).
Tenants Workday con tablero 0 en mi site adivinado (site incorrecto probable, [NV]; no usar esos refs): Unilever `unilever/wd3/Unilever_Experienced_Professionals`, Novartis `novartis/wd3/Novartis_Careers`, Baker Hughes `bakerhughes/wd5/BakerHughes`.

## Tabla B — por plataforma SIN conector (o con conector que no los lee hoy), con volumen

| Plataforma | Empresa | Portal / ref | Volumen Colombia | Estado |
|---|---|---|---|---|
| Oracle Recruiting Cloud | JPMorgan Chase | jpmc.fa.oraclecloud.com CX_1001 | 10 (5 <=30 d) [OBS] | ver oracle-recruiting-cloud.md |
| Oracle Recruiting Cloud | Oracle | eeho.fa.us2 CX_45001 | 19 (15 primaria CO; 5 <=30 d) | idem |
| Oracle Recruiting Cloud | Nokia | fa-evmr-saasfaprod1.fa.ocs CX_1 | 2 (2) | idem |
| Oracle Recruiting Cloud | Hilton | efet.fa.us2 CX_1 | 42 (9) | idem |
| Oracle Recruiting Cloud | Dell, Honeywell | enterpriseplatform.dell.com; ibqbjb.fa.ocs | 0 hoy | idem; Marriott [NV] (site equivocado) |
| Avature | Siemens | jobs.siemens.com/en_US/externaljobs | 4 por keyword (3 en Bogotá, 3 vigentes) | ver avature.md |
| Avature | Deloitte US | apply.deloitte.com | 0 | Deloitte Colombia: portal no identificado [NV] |
| iCIMS | Teleperformance Colombia | careersspa-teleperformance.icims.com (TPjobscolombia.com) | sitemap con 69 URLs de vacantes, 13 con "bogot" en la URL [OBS]; `lastmod` por vacante | robots: Disallow solo de referral/login/candidate/connect; sitemap público. Sin conector |
| iCIMS | PepsiCo | pepjobs-pepsico.icims.com | [NV] | sin conteo visible |
| Magneto (el conector no lee más de 20 filas) | KPMG | `magneto kpmg` (kpmg.com/co enlaza magneto365.com/co/empresas/kpmg) | canario: error "Magneto solo sirve 20 filas"; faceta 129 (bruto, no vigente CO) | cumple la regla de Magneto del dueño; falta paginar |
| Magneto (idem) | Davivienda | `magneto davivienda` (prensa lo cita; enlace oficial [NV]) | error 20 filas; faceta 102 | idem |
| Magneto (idem) | Grupo Éxito | `magneto grupo-exito` | error 20 filas; faceta 2.904 (bruto) | idem |
| Magneto | Nutresa, Ecopetrol, Banco de Bogotá, Tigo | slugs probados `grupo-nutresa`, `ecopetrol`, `banco-de-bogota`, `tigo` | HTTP 500 (los tres primeros); Tigo: "la página no está filtrada por esta empresa" | slug incorrecto o sin página [NV] |
| Workday sin faceta de país | Johnson & Johnson | `jj/wd5/JJ` (careers.jnj.com enlaza jj.wd5.myworkdayjobs.com) | tablero 1.927 sin faceta | arreglo de faceta/búsqueda |
| idem | PwC | `pwc/wd3/Global_Experienced_Careers` (site adivinado) | 3.860 sin faceta | idem |
| idem | Maersk | `maersk/wd3/Maersk_Careers` | 1.260 sin faceta | idem |
| idem | Intel | `intel/wd1/External` | 747 sin faceta | idem |
| idem | Salesforce | `salesforce/wd12/External_Career_Site` | 1.578 sin faceta | idem |
| Workday | Accenture | `accenture/wd103/AccentureCareers` (accenture.com/co-es/careers lo enlaza) | canario: error "faceta Colombia: forma inesperada en la página 1" (hoy sin 429) | bug o forma distinta del conector |
| Workday | Kimberly-Clark | `kimberlyclark/wd1/GLOBAL_KC_EXTERNAL` | error: robots.txt solo abre otros sites de este tenant | otro site [NV] |
| Workday | Nestlé, Marriott | `nestle/wd3/nestlecareers`, `marriott/wd5/marriottcareers` | HTTP 422 (site incorrecto) | [NV] |
| SuccessFactors (RMK) | SAP | jobs.sap.com | canario: HTTP 403 en la página 1; robots.txt dice `Allow: /` pero el servidor responde 403 al UA | [NV]; sin rodeo |
| SuccessFactors (RMK) | Globant | career.globant.com | robots.txt no permite /search/ | requiere permiso del sitio |

## No resueltos (portal visto, ATS no identificado o bloqueo) — todos [NV]
- 403 a nuestro UA: Nestlé (nestle.com/jobs, nestle.com.co/jobs), Schneider Electric (careers.se.com), Kimberly-Clark (careers.kimberly-clark.com), Cargill (cargill.com/careers), PwC Colombia (pwc.com/co), SAP, Pfizer.com, Autodesk.com.
- Sitio JS sin huella de ATS en el HTML estático: Deloitte Colombia, EPAM (careers.epam.com), Capgemini, IBM, Huawei, Intel (certificado SSL falló en mi cliente), Teleperformance global (tp.com), Atento (404 en la URL probada), Konecta (Pandape/Computrabajo, fuera de la política), Sodexo (DNS), Compass, Coca-Cola FEMSA, AB InBev/Bavaria, Nutresa, Éxito (404 en la URL probada), Ecopetrol (portal propio; la prensa cita convocatoriasecopetrol.com), Davivienda (Trabaja con nosotros propio; la prensa cita también Magneto), Banco de Bogotá, Grupo Aval, Movistar/Telefónica, Tigo/Millicom, Kuehne+Nagel, LOreal, Novartis, Baker Hughes, Halliburton, SLB, Uber, DiDi (Greenhouse: 0 CO en el catálogo previo), Nubank (slug Greenhouse nubank sin tablero).
- Slugs de SmartRecruiters adivinados (Sodexo, Atento, KuehneNagel) y Greenhouse nubank devuelven tablero vacío = el slug no existe; no son evidencia de nada.

## Prioridad sugerida por volumen medido (Colombia vigente, [OBS])
1. Seed inmediato con conectores (81): UPS 43, Medtronic 17, HPE 6, Mondelez 6, ABB 5, Pfizer 2, GSK 2 (decidir propiedad media).
2. Paginar Magneto más allá de 20 filas: KPMG (129 bruto), Davivienda (102), Éxito (2.904): el mayor volumen pendiente sin plataforma nueva.
3. Arreglar Workday sin faceta (J&J 1.927, PwC 3.860, Maersk, Intel, Salesforce, Accenture): probablemente mayor volumen que Oracle.
4. iCIMS (Teleperformance Colombia, >= 13 en Bogotá) y Oracle (69 total, 21 vigentes) quedan por debajo en volumen.
