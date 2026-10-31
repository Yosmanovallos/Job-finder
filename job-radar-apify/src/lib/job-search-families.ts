// Job-family vocabulary for the dashboard's free-text search
// (job-search-intent.ts). Built 2026-10-31 from a 4,281-title sample of the
// live corpus: before this, "AI Engineer" returned 2,185 jobs (Ingeniero
// Residente, Ingeniero Eléctrico...), "UX" 3,189 ("auxiliar"), "BI" 18,142
// and "IA" 26,718 ("Colombia"), because every query word was a substring
// match against title, company AND location.
//
// Deliberately separate from ai-role-agent.ts's TRANSLATION_MAP: that map
// drives scraper keyword generation, the role filter and the SEO
// category/city pages, which must not drift because search got smarter.
//
// Phrase syntax (everything already accent-free and lowercase):
// - words are matched on word boundaries, never as substrings;
// - a trailing "*" on a word is a prefix ("enfermer*" = enfermera/o/ía);
// - otherwise the last word also matches its plural (+s / +es);
// - connector words (de, en, y, a, o, ...) may appear between words, so
//   "ingeniero de sistemas" also matches "Ingeniero(a) de sistemas" and
//   "ingeniero sistemas";
// - a leading "~" makes the phrase a query trigger only, never a title
//   term ("movil" as a query means mobile development, but in a title it is
//   mostly telecom sales: "Asesor línea móvil").

export interface SearchFamily {
  id: string;
  // Each group is one set of interchangeable names. The group the user's
  // query hit ranks first; the rest of the family ranks after it.
  groups: string[][];
  // Title-only terms of the same family that are never query triggers by
  // themselves (technologies, ambiguous words).
  extra?: string[];
  // Neighbouring families shown after the family's own matches
  // ("AI Engineer" also lists Data Scientist postings, last).
  related?: string[];
  // A title containing one of these is not a match for this family
  // ("Structural Engineering (Data Centers)" is not a data job).
  exclude?: string[];
  // Industry families ("seguros", "inmobiliaria", "viajes"): a posting AT
  // such an employer also matches, ranked with the related families.
  matchCompany?: boolean;
}

export const SEARCH_FAMILIES: SearchFamily[] = [
  // ---- Technology ----
  {
    id: "ai",
    groups: [
      ["ai", "ia", "inteligencia artificial", "artificial intelligence", "ia generativa", "ai generativa", "generative ai", "genai", "gen ai", "agentic"],
      ["machine learning", "ml", "aprendizaje automatico", "deep learning", "aprendizaje profundo", "mlops", "ml ops", "ml engineer*"],
      ["llm", "large language model*", "nlp", "procesamiento de lenguaje natural", "natural language processing"],
      ["computer vision", "vision por computador*", "vision artificial"],
      ["prompt engineer*", "prompt engineering"]
    ],
    related: ["data scientist", "data science", "cientific* de datos", "ciencia de datos", "chatbot*"]
  },
  {
    id: "data-science",
    groups: [["data scientist", "data science", "cientific* de datos", "ciencia de datos"]],
    related: ["machine learning", "inteligencia artificial", "ai", "ia", "data analyst", "analista de datos", "analytics"]
  },
  {
    id: "data",
    groups: [
      ["data", "datos"],
      ["big data", "data lake", "data warehouse", "etl", "databricks"],
      ["analista de informacion", "gestion de informacion"],
      ["business intelligence", "inteligencia de negocio*", "bi", "power bi"],
      ["analytics", "analitica", "analitica de datos"]
    ],
    related: ["data scientist", "data science", "cientific* de datos", "ciencia de datos"],
    exclude: ["data center*", "centro de datos", "centros de datos", "data entry", "entrada de datos", "proteccion de datos", "datos personales"]
  },
  {
    id: "qa",
    groups: [
      ["qa", "quality assurance", "aseguramiento de calidad", "aseguramiento de la calidad de software"],
      ["tester", "testing", "sdet", "test automation", "automatizador de pruebas", "pruebas de software", "analista de pruebas", "qa automation"]
    ],
    // Before family search, "QA" also listed manufacturing/service quality
    // roles (TRANSLATION_MAP qa -> calidad); they stay, ranked last.
    related: ["calidad de software", "ingenier* de calidad", "calidad", "quality"],
    exclude: ["alta calidad", "air quality"]
  },
  {
    id: "ux-ui",
    groups: [
      ["ux", "ui", "user experience", "experiencia de usuario", "user interface", "interfaz de usuario"],
      ["product designer", "disenador de producto", "disenadora de producto"],
      ["ux writer", "ux research*", "investigador ux"]
    ],
    related: ["diseno web", "web designer", "disenador web", "disenadora web", "figma", "design system*", "disenador digital", "disenadora digital"]
  },
  {
    id: "graphic-design",
    groups: [
      ["diseno grafico", "disenador grafico", "disenadora grafica", "graphic design", "graphic designer"],
      ["diseno publicitario", "disenador publicitario", "disenadora publicitaria"],
      ["motion graphic*", "motion designer"],
      ["ilustrador*", "illustrator"],
      ["logo*", "logotipo*", "identidad visual", "manual de marca", "branding", "flyer*", "vectorizacion"]
    ],
    related: ["disenador*", "designer", "editor* de video", "video editor", "creativo", "creativa"]
  },
  {
    id: "devops-cloud",
    groups: [
      ["devops", "dev ops", "devsecops"],
      ["sre", "site reliability"],
      ["cloud", "nube", "cloud engineer*"],
      ["platform engineer*", "ingenier* de plataforma*"]
    ],
    extra: ["aws", "azure", "gcp", "google cloud", "kubernetes", "terraform"],
    related: ["infraestructura ti", "infraestructura tecnologica", "sysadmin", "administrador de servidores"]
  },
  {
    id: "frontend",
    groups: [["frontend", "front end"]],
    extra: ["react", "angular", "vue", "vuejs", "nextjs", "next js", "javascript", "typescript"],
    related: ["full stack", "fullstack", "web developer", "desarrollador* web", "maquetador*"],
    exclude: ["front desk", "front office"]
  },
  {
    id: "backend",
    groups: [["backend", "back end"]],
    extra: ["nodejs", "node js", "java", "python", "golang", "php", "django", "spring boot", "dotnet", "net core"],
    related: ["full stack", "fullstack", "software engineer*", "desarrollador* de software"]
  },
  {
    id: "fullstack",
    groups: [["full stack", "fullstack"]],
    related: ["frontend", "front end", "backend", "back end", "web developer", "desarrollador* web"]
  },
  {
    id: "mobile",
    groups: [
      ["mobile", "~movil", "~moviles", "desarrollador* movil", "desarrollo movil", "apps moviles", "aplicaciones moviles", "app movil"],
      ["android"],
      ["ios"],
      ["flutter"],
      ["react native"]
    ],
    extra: ["kotlin", "swift"],
    exclude: ["linea movil", "telefonia movil", "planes moviles", "unidad movil"]
  },
  {
    id: "software",
    groups: [
      ["software", "desarrollo de software", "software developer", "software engineer*"],
      ["programador*", "programmer", "programacion", "programming"],
      ["ingenier* de sistemas", "~sistemas", "analista de sistemas", "auxiliar de sistemas", "tecnic* en sistemas", "tecnolog* en sistemas"]
    ],
    extra: [
      "developer", "desarrollador*", "full stack", "fullstack", "frontend", "backend",
      "arquitect* de software", "software architect", "arquitect* de soluciones", "solution architect", "solutions architect"
    ],
    // Before family search, "software" also listed IT postings
    // (TRANSLATION_MAP software -> ti/it); they stay, ranked last.
    related: ["ti", "it", "tecnologia*", "tic", "informatica", "enterprise architect*", "arquitect* empresarial"],
    exclude: ["desarrollador* de negocio*", "desarrollo de negocio*", "business developer", "business development", "sistemas de gestion", "sistema de gestion", "sistemas integrados de gestion"]
  },
  {
    id: "cybersecurity",
    groups: [[
      "ciberseguridad", "cybersecurity", "cyber security", "seguridad informatica",
      "seguridad de la informacion", "information security", "infosec", "pentester", "pentest*", "ethical hack*"
    ]],
    // English postings write "Security Engineer"/"Security Analyst" for
    // cybersecurity; physical security is its own family.
    extra: ["siem", "soc analyst", "analista soc", "security"],
    exclude: ["security guard", "security officer", "seguridad fisica"]
  },
  {
    id: "it-support",
    groups: [[
      "soporte tecnico", "soporte ti", "soporte it", "mesa de ayuda", "help desk", "helpdesk",
      "service desk", "tecnic* de soporte", "soporte de sistemas", "soporte informatico"
    ]],
    extra: ["auxiliar de sistemas", "tecnic* en sistemas", "tecnolog* en sistemas", "mantenimiento de equipos de computo", "systems administration", "sysadmin"]
  },
  {
    id: "networks",
    groups: [["redes", "telecomunicaciones", "telecom", "networking", "network engineer*", "cableado estructurado", "fibra optica"]],
    exclude: ["redes sociales"]
  },
  {
    id: "business-analysis",
    groups: [
      ["business analyst", "analista de negocio*"],
      ["analista funcional", "functional analyst", "consultor* funcional"],
      ["analista* de procesos", "mejora de procesos", "transformacion de procesos", "excelencia operacional"]
    ],
    related: ["analista de procesos", "process analyst", "product owner", "business intelligence"]
  },
  {
    id: "project-management",
    groups: [[
      "project manager", "gerente de proyecto*", "lider de proyecto*", "jefe de proyecto*", "director* de proyecto*",
      "coordinador* de proyecto*", "project lead", "project management", "pmo"
    ]],
    related: ["scrum master", "product owner", "agile coach", "program manager", "delivery manager", "proyecto*"]
  },
  {
    id: "agile",
    groups: [["scrum master", "agile coach", "agilista"]],
    related: ["product owner", "project manager"]
  },
  {
    id: "product",
    groups: [["product owner", "product manager", "gerente de producto", "product lead", "head of product"]],
    related: ["scrum master", "business analyst"]
  },

  // ---- Business ----
  {
    id: "digital-marketing",
    groups: [
      ["marketing digital", "digital marketing", "mercadeo digital", "growth marketing", "performance marketing"],
      ["seo", "sem", "paid media", "media buyer", "trafficker", "google ads", "meta ads", "email marketing", "content marketing"]
    ],
    related: ["marketing", "mercadeo", "community manager", "social media", "redes sociales"]
  },
  {
    id: "social-media",
    groups: [
      ["community manager", "social media", "redes sociales", "social media manager"],
      ["creador* de contenido", "content creator", "creacion de contenido"]
    ],
    related: ["marketing digital", "mercadeo digital", "marketing", "mercadeo"]
  },
  {
    id: "marketing",
    groups: [["marketing", "mercadeo"], ["trade marketing", "brand manager", "publicidad", "publicista"]],
    related: ["marketing digital", "community manager", "social media"]
  },
  {
    id: "sales",
    groups: [
      ["vendedor*", "seller", "salesperson"],
      ["ventas", "sales"],
      ["comercial", "asesor* comercial", "ejecutiv* comercial", "representante comercial"],
      ["televentas", "telemercadeo", "telemarketing"],
      ["account executive", "account manager", "key account", "kam", "gerente de cuenta*", "ejecutiv* de cuenta*"],
      ["sdr", "bdr", "business development", "desarrollo de negocio*"],
      ["appointment setter", "setter", "closer", "cold caller", "captacion de clientes"]
    ],
    related: ["cajer*", "mercaderista*", "impulsador*", "preventa*"]
  },
  {
    id: "customer-service",
    groups: [
      ["servicio al cliente", "atencion al cliente", "customer service", "customer support", "soporte al cliente", "customer success"],
      ["call center", "contact center", "teleoperador*", "agente de call center"],
      ["experiencia del cliente", "customer experience", "cx", "posventa"]
    ],
    related: ["televentas", "telemercadeo", "recepcionista"]
  },
  {
    id: "hr",
    groups: [
      ["recursos humanos", "rrhh", "rr hh", "human resources", "hr"],
      ["talento humano", "gestion humana", "gestion del talento", "hrbp", "people partner"],
      ["reclutador*", "reclutamiento", "recruiter", "talent acquisition", "seleccion de personal", "analista de seleccion"],
      ["nomina", "payroll"],
      ["desarrollo humano", "relaciones laborales", "bienestar laboral"]
    ]
  },
  {
    id: "accounting",
    groups: [
      ["contador", "contadora", "contador publico", "contadora publica", "accountant", "contaduria"],
      ["contable", "contabilidad", "accounting"],
      ["impuestos", "tributari*", "tax"],
      ["revisor fiscal"],
      ["facturacion", "billing", "cuentas por pagar", "accounts payable", "cuentas por cobrar", "accounts receivable", "recaudo*"],
      ["costos", "presupuesto*"]
    ],
    related: ["auditor*", "auditoria", "finanzas", "financiero", "financiera", "tesoreria"]
  },
  {
    id: "finance",
    groups: [
      ["finanzas", "financiero", "financiera", "finance", "financial", "pricing"],
      ["tesoreria", "tesorero", "tesorera", "treasury"],
      ["cartera", "cobranza*", "collections"],
      ["credito", "creditos", "credit", "microcredito*", "microfinanz*"],
      ["bancari*", "banca", "banking"],
      ["inversiones", "patrimonial", "wealth", "medios de pago", "payments"]
    ],
    related: ["contable", "contabilidad", "contador", "auditor*", "riesgo*", "risk"]
  },
  {
    id: "legal",
    groups: [[
      "abogado", "abogada", "lawyer", "attorney", "legal", "juridic*", "counsel",
      "paralegal", "litigio*", "litigante*", "derecho"
    ]]
  },
  {
    id: "logistics",
    groups: [
      ["logistica", "logistico", "logistics"],
      ["supply chain", "cadena de suministro", "cadena de abastecimiento"],
      ["bodega", "bodeguero", "almacen", "almacenista", "warehouse", "inventario*"],
      ["comercio exterior", "importacion*", "exportacion*", "aduana*", "comex"],
      ["compras", "procurement", "purchasing", "comprador*"],
      ["distribucion", "almacenamiento", "cedi", "cargue*", "descargue*", "estibador*", "transporte", "trazabilidad"]
    ],
    related: ["montacarga*", "despacho*", "picking"]
  },
  {
    id: "admin",
    groups: [
      ["administrativ*", "administrative"],
      ["secretari*"],
      ["recepcionista", "receptionist"],
      ["asistente de gerencia", "asistente ejecutiv*", "executive assistant"],
      ["asistente virtual", "virtual assistant"],
      ["archivo", "gestion documental", "digitador*", "digitacion"],
      ["data entry", "entrada de datos", "transcripcion*", "mecanografia"],
      ["gerente de oficina", "office manager", "auxiliar de oficina", "jefe de oficina"]
    ]
  },

  // ---- Engineering & trades ----
  {
    id: "civil-construction",
    groups: [
      ["~civil", "ingenier* civil", "civil engineer*", "obra civil", "obras civiles"],
      ["residente de obra*", "ingenier* residente", "director* de obra*", "maestro de obra*", "auxiliar de obra*", "inspector* de obra*"],
      ["construccion", "constructor*", "construction"],
      ["estructural*", "structural"],
      ["interventor*", "interventoria"],
      ["topograf*"]
    ],
    related: ["civil"]
  },
  {
    id: "industrial-engineering",
    groups: [["~industrial", "ingenier* industrial", "industrial engineer*"]],
    related: ["industrial", "mejora continua", "lean", "planeacion de la produccion", "analista de procesos"]
  },
  {
    id: "environmental",
    groups: [["ambiental", "ambientales", "environmental", "medio ambiente", "gestion ambiental", "sostenibilidad", "sustainability"]]
  },
  {
    id: "hse",
    groups: [["sst", "seguridad y salud en el trabajo", "salud ocupacional", "hse", "hseq", "sisoma", "seguridad industrial", "ehs", "prevencionista"]]
  },
  {
    id: "electrical",
    groups: [["electric*", "electrical", "electronic*", "electronics", "electromecanic*"]]
  },
  {
    id: "mechanical-maintenance",
    groups: [
      ["mecanic*", "mechanical", "mecatronic*"],
      ["mantenimiento", "maintenance"]
    ]
  },
  {
    id: "quality",
    groups: [["calidad", "quality", "control de calidad", "inspector* de calidad"]],
    related: ["qa", "aseguramiento de calidad", "hseq"]
  },
  {
    id: "production",
    groups: [
      ["operari*", "operador* de produccion", "operador* de maquina*", "ensamblador*"],
      ["produccion", "manufactura", "manufacturing"]
    ],
    exclude: ["produccion audiovisual", "produccion de contenido", "produccion de video*", "produccion musical"]
  },

  // ---- Health ----
  {
    id: "nursing",
    groups: [["enfermer*", "nurse", "nursing"]],
    related: ["cuidador*", "cuidadora*", "auxiliar de salud", "auxiliar clinic*"]
  },
  {
    id: "caregiving",
    groups: [["cuidador*", "cuidadora*", "caregiver", "adulto mayor", "adultos mayores", "geriatri*"]],
    related: ["enfermer*", "nurse"]
  },
  {
    id: "medical",
    groups: [
      ["medico", "medica", "medicos", "medicina", "physician", "medical", "clinical"],
      ["atencion prehospitalaria", "prehospitalari*", "paramedic*"]
    ],
    related: ["enfermer*", "salud"]
  },
  {
    id: "pharmacy",
    groups: [["farmac*", "regente de farmacia", "drogueria*", "quimic* farmaceutic*", "pharmacist", "pharmacy"]]
  },
  {
    id: "dental",
    groups: [["odontolog*", "higienista oral", "dentist*", "dental"]]
  },
  {
    id: "therapy",
    groups: [
      ["fisioterapeut*", "physiotherap*"],
      ["terapeut*", "terapia*"],
      ["fonoaudiolog*"]
    ]
  },
  {
    id: "lab",
    groups: [
      ["bacteriolog*", "microbiolog*"],
      ["laboratorio", "laboratorista*"],
      ["analista quimic*", "quimic*"]
    ]
  },
  {
    id: "psychology",
    groups: [
      ["psicolog*", "psychologist"],
      ["trabajador* social", "trabajo social"]
    ]
  },
  {
    id: "veterinary",
    groups: [["veterinari*", "zootecnist*"]]
  },

  // ---- Services ----
  {
    id: "education",
    groups: [
      ["docente*", "profesor*", "teacher", "maestro", "maestra", "educador*", "licenciad*"],
      ["tutor*"],
      ["instructor*"],
      ["pedagog*"]
    ],
    exclude: ["maestro de obra*"]
  },
  {
    id: "transport",
    groups: [
      ["conductor*", "chofer*", "driver", "motorista*"],
      ["domiciliari*", "mensajer*", "repartidor*"]
    ]
  },
  {
    id: "food-service",
    groups: [
      ["cocinero*", "cocina", "chef", "cook", "kitchen"],
      ["mesero*", "mesera*", "waiter", "camarer*"],
      ["barista*", "bartender", "barman"],
      ["panader*", "pastel*", "reposter*"]
    ]
  },
  {
    id: "retail",
    groups: [
      ["cajer*", "cashier"],
      ["mercaderista*", "impulsador*", "impulsadora*", "promotor* de ventas"],
      ["tienda*", "punto* de venta", "store manager", "retail"]
    ],
    related: ["vendedor*", "ventas"],
    exclude: ["tienda* online", "tienda* virtual*", "tienda* en linea", "shopify", "woocommerce", "ecommerce", "e commerce"]
  },
  {
    id: "security-guard",
    groups: [
      ["vigilante*", "guarda de seguridad", "guardia de seguridad", "guarda", "seguridad privada", "security guard"],
      ["escolta*"],
      ["prevencion de perdidas", "control de perdidas", "loss prevention"]
    ]
  },
  {
    id: "cleaning",
    groups: [["aseo", "servicios generales", "limpieza", "cleaning", "housekeeping", "aseador*", "conserje*"]]
  },
  {
    id: "audiovisual",
    groups: [
      ["editor* de video", "video editor", "edicion de video", "creacion de video", "audiovisual*", "youtube"],
      ["fotograf*", "photographer", "camarograf*", "videograf*"],
      ["voz en off", "locutor*", "locucion"]
    ],
    related: ["motion graphic*", "creador* de contenido"]
  },
  {
    id: "writing",
    groups: [
      ["redactor*", "copywriter", "copywriting", "content writer"],
      ["traductor*", "translator", "interprete*", "corrector* de estilo", "traduccion", "redaccion", "subtitul*"]
    ]
  },
  {
    id: "agro",
    groups: [["agronom*", "agricola", "agropecuari*", "agroindustri*"]]
  },
  // ---- Added 2026-10-31 from a uniform 9,761-title sample (CO + VE) ----
  {
    id: "operations",
    groups: [["operaciones", "operations", "ops", "operativ*", "back office", "control operacional"]],
    related: ["logistica", "procesos"]
  },
  {
    id: "ecommerce",
    groups: [[
      "ecommerce", "e commerce", "comercio electronico", "tienda* online", "tienda* virtual*",
      "tienda* en linea", "shopify", "woocommerce", "marketplace*"
    ]],
    related: ["marketing digital", "desarrollo web", "pagina* web"]
  },
  {
    id: "web-development",
    groups: [["desarrollo web", "pagina* web", "sitio* web", "web developer", "desarrollador* web", "wordpress", "landing page*", "wix", "webflow"]],
    related: ["frontend", "front end", "full stack", "fullstack", "diseno web"]
  },
  {
    id: "erp-crm",
    groups: [["sap"], ["erp"], ["salesforce"], ["crm"], ["odoo"], ["oracle"], ["dynamics 365"]],
    related: ["consultor* funcional", "analista funcional"]
  },
  {
    id: "compliance-risk",
    groups: [
      ["cumplimiento", "compliance", "oficial de cumplimiento", "control interno"],
      ["aml", "kyc", "sarlaft", "fincrime", "financial crime", "lavado de activos", "antilavado", "fraude", "fraud"],
      ["riesgo*", "risk"]
    ],
    related: ["auditor*", "auditoria"]
  },
  {
    id: "insurance",
    groups: [["seguros", "bancaseguros", "insurance", "siniestro*", "claims", "suscriptor*", "underwriter*", "ajustador*", "aseguradora*"]],
    matchCompany: true
  },
  {
    id: "real-estate",
    groups: [["inmobiliari*", "real estate", "bienes raices", "finca raiz", "propiedad horizontal", "arrendamiento*"]],
    matchCompany: true
  },
  {
    id: "travel-tourism",
    groups: [["viajes", "turismo", "turistic*", "travel", "hotel*", "hoteler*", "reservas", "tours"]],
    matchCompany: true
  },
  {
    id: "automation",
    groups: [["automatizacion*", "automation", "rpa", "chatbot*", "bot", "bots", "n8n", "zapier"]],
    related: ["inteligencia artificial", "ai", "ia"]
  },
  {
    id: "research",
    groups: [["investigacion", "research", "investigador*", "researcher", "i+d"]]
  },
  {
    id: "construction-trades",
    groups: [
      ["oficial de obra*", "oficial de acabados", "mamposter*", "obra blanca", "obra gris", "estructura metalica"],
      ["plomer*", "fontaner*"],
      ["soldador*"],
      ["carpinter*"],
      ["pintor*"],
      ["albanil*"],
      ["ornamentador*"],
      ["refrigeracion", "aire acondicionado", "hvac"]
    ],
    related: ["construccion", "obra civil", "residente de obra*"]
  },
  {
    id: "automotive",
    groups: [
      ["automotri*", "concesionario*"],
      ["repuestos"],
      ["latoner*", "carroceria", "pintor* de autos"]
    ],
    related: ["mecanic*", "posventa"]
  },
  {
    id: "field-service",
    groups: [["field service*", "servicio tecnico", "tecnic* de campo", "tecnic* instalador*", "instalador*", "tecnic* de instalacion"]],
    related: ["mantenimiento", "soporte tecnico"]
  },
  {
    id: "interior-design",
    groups: [["diseno de interiores", "disenador* de interiores", "interiorismo", "interiorista*"]]
  },
  {
    id: "3d",
    groups: [["modelado 3d", "modelador* 3d", "modelo* 3d", "render*", "animacion 3d", "blender"]]
  },
  {
    id: "architecture-drafting",
    groups: [["diseno arquitectonico", "auxiliar de arquitectura", "dibujante*", "autocad", "revit", "sketchup", "bim"]]
  },
  {
    id: "hosting",
    groups: [["anfitrion*", "hostess"]]
  },
  {
    id: "internship",
    groups: [["aprendiz*", "practicante*", "pasante*", "intern", "internship", "practica* profesional*", "etapa productiva"]]
  },
  {
    id: "mining-oil",
    groups: [["mineria", "minero", "mining", "petroler*", "oil gas", "geolog*"]]
  }
];

// Role-type words. In a query that also names a family they rank results
// (an "AI Engineer" title ranks above "Docente de IA") but never filter: a
// role word like "engineer" is shared by hundreds of unrelated postings,
// which is exactly how "AI Engineer" used to return "Ingeniero Residente".
export interface RoleFunction {
  id: string;
  forms: string[];
  // Close role types that still earn the second rank.
  near?: string[];
}

export const ROLE_FUNCTIONS: RoleFunction[] = [
  { id: "engineer", forms: ["engineer", "ingenier*"], near: ["developer", "architect", "scientist"] },
  { id: "developer", forms: ["developer", "desarrollador*", "programador*", "programmer", "dev"], near: ["engineer"] },
  { id: "architect", forms: ["architect", "arquitect*"], near: ["engineer"] },
  { id: "scientist", forms: ["scientist", "cientific*"], near: ["engineer", "analyst"] },
  { id: "analyst", forms: ["analyst", "analista*"], near: ["scientist", "specialist"] },
  { id: "manager", forms: ["manager", "gerente*", "jefe*", "head"], near: ["lead", "director"] },
  { id: "lead", forms: ["lead", "lider*", "leader"], near: ["manager"] },
  { id: "director", forms: ["director*", "vp"], near: ["manager"] },
  { id: "coordinator", forms: ["coordinador*", "coordinator"], near: ["lead", "supervisor"] },
  { id: "supervisor", forms: ["supervisor*"], near: ["coordinator"] },
  { id: "specialist", forms: ["specialist", "especialista*", "expert", "experto*", "experta*"], near: ["analyst", "consultant"] },
  { id: "consultant", forms: ["consultant", "consultor*", "asesor*", "advisor"], near: ["specialist"] },
  { id: "designer", forms: ["designer", "disenador*"] },
  { id: "assistant", forms: ["assistant", "asistente*", "auxiliar*", "aide"] },
  { id: "technician", forms: ["technician", "tecnic*", "tecnolog*"] },
  { id: "intern", forms: ["intern", "internship", "practicante*", "pasante*", "aprendiz*", "trainee"] },
  { id: "executive", forms: ["executive", "ejecutiv*"] },
  { id: "operator", forms: ["operator", "operador*", "operari*"] },
  { id: "agent", forms: ["agent", "agente*", "representative", "representante*"] },
  { id: "professional", forms: ["profesional*", "professional"] }
];

// Query words that only describe seniority. Dropped from a family search
// (they'd otherwise have to match literally) but kept in a plain search,
// where "Senior" alone is a legitimate literal query.
export const SENIORITY_WORDS = new Set([
  "senior", "sr", "junior", "jr", "ssr", "semisenior", "semi", "mid"
]);
