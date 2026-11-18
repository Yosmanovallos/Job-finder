// Text of the four legal pages: the user's to change (Legal.tsx is presentation
// only). Lives outside the component so server.ts can put the same text in
// the raw HTML (adsense-readiness TX-1) and the two never drift.

export type LegalPageType = "terminos" | "privacidad" | "uso-aceptable" | "cookies";

export interface LegalSection {
  title: string;
  paragraphs: string[];
}


export const LEGAL_CONTENT: Record<LegalPageType, { title: string; updated: string; sections: LegalSection[] }> = {
  terminos: {
    title: "Términos de uso",
    updated: "octubre de 2026",
    sections: [
      {
        title: "Qué es BuscoTrabajo",
        paragraphs: [
          "BuscoTrabajo es un agregador que recopila vacantes de empleo publicadas de forma pública en portales como LinkedIn, Computrabajo, Elempleo, Magneto, Torre, GetOnBoard, RemoteOK, Remotive, Workana, WeRemoto, Indeed y Glassdoor, las deduplica y las presenta en un solo dashboard.",
          "BuscoTrabajo nunca aplica a un empleo por ti. La decisión de postularte y el envío de cada aplicación son siempre tuyos, en el sitio original.",
        ],
      },
      {
        title: "Costo del servicio",
        paragraphs: [
          "BuscoTrabajo es gratuito. Puedes buscar y ver todas las vacantes, incluidas las recién publicadas, sin pagar. Crear una cuenta también es gratis y sirve para guardar vacantes y marcar las que ya aplicaste.",
          "Más adelante podríamos ofrecer funciones opcionales de pago. Si eso ocurre, lo anunciaremos y actualizaremos estos términos antes de cobrar cualquier cosa.",
        ],
      },
      {
        title: "Disponibilidad de los datos",
        paragraphs: [
          "Las vacantes provienen de terceros y pueden cambiar, cerrarse o dejar de estar disponibles sin previo aviso. BuscoTrabajo hace su mejor esfuerzo por verificar vigencia, pero no garantiza que cada vacante mostrada siga abierta al momento de tu visita.",
        ],
      },
    ],
  },
  privacidad: {
    title: "Política de privacidad",
    updated: "noviembre de 2026",
    sections: [
      {
        title: "Qué datos recolectamos",
        paragraphs: [
          "Tu correo electrónico y credenciales de sesión, gestionadas por Supabase Auth (incluye inicio de sesión con Google o con correo/contraseña).",
          "Vacantes que marques como guardadas o aplicadas — se guardan asociadas a tu sesión, no se comparten con nadie.",
        ],
      },
      {
        title: "Qué NO recolectamos",
        paragraphs: [
          "Hoy no procesamos pagos: no recibimos ni almacenamos datos de tarjetas de crédito ni otra información financiera.",
          "No vendemos tu correo, tus credenciales ni las vacantes que guardas o marcas como aplicadas, y no los compartimos con anunciantes.",
        ],
      },
      {
        title: "Publicidad y medición",
        paragraphs: [
          "BuscoTrabajo muestra anuncios de Google AdSense para mantener el servicio gratuito. Proveedores externos, incluido Google, usan cookies para mostrar anuncios basados en las visitas anteriores de un usuario a este sitio web o a otros sitios web.",
          "Las cookies de publicidad de Google permiten que Google y sus socios muestren anuncios a los usuarios basados en sus visitas a este sitio o a otros sitios de Internet. Puedes inhabilitar la publicidad personalizada en la Configuración de anuncios de Google (https://adssettings.google.com) o desactivar las cookies de proveedores externos para publicidad personalizada en https://www.aboutads.info.",
          "Más información sobre cómo Google usa los datos de los sitios que usan sus servicios: https://policies.google.com/technologies/partner-sites.",
          "También usamos Google Analytics para medir de forma agregada qué páginas se visitan. No enviamos a Google tu correo ni datos de tu cuenta.",
        ],
      },
      {
        title: "Tus derechos",
        paragraphs: [
          "Puedes solicitar acceso, corrección o eliminación de tus datos escribiendo a buscotrabajocolombia123@gmail.com.",
        ],
      },
    ],
  },
  "uso-aceptable": {
    title: "Uso aceptable",
    updated: "octubre de 2026",
    sections: [
      {
        title: "Qué sí puedes hacer",
        paragraphs: [
          "Usar BuscoTrabajo para buscar empleo, guardar vacantes y marcar las que ya aplicaste.",
          "Si desarrollas una herramienta o un agente, puedes usar la API pública de solo lectura dentro de los límites publicados en /docs.",
        ],
      },
      {
        title: "Qué no está permitido",
        paragraphs: [
          "Extraer masivamente (scraping) el contenido de BuscoTrabajo para redistribuirlo o revenderlo.",
          "Automatizar solicitudes al servicio fuera de la interfaz y de la API pública documentada, o superar sus límites de uso.",
          "Usar el servicio para fines distintos a la búsqueda de empleo legítima.",
        ],
      },
      {
        title: "Consecuencias",
        paragraphs: [
          "El incumplimiento de estas reglas puede resultar en la suspensión de tu cuenta.",
        ],
      },
    ],
  },
  cookies: {
    title: "Política de cookies",
    updated: "noviembre de 2026",
    sections: [
      {
        title: "Qué cookies usamos",
        paragraphs: [
          "Una cookie/token de sesión gestionado por Supabase Auth para mantenerte conectado entre visitas. Es estrictamente necesaria para que el inicio de sesión funcione.",
          "Cookies de Google Analytics para medir de forma agregada el uso del sitio (páginas visitadas, origen de las visitas).",
          "Cookies de publicidad de Google AdSense: Google y sus socios las usan para mostrar anuncios, incluidos anuncios personalizados basados en tus visitas a este y otros sitios, y para limitar la frecuencia y medir su rendimiento.",
        ],
      },
      {
        title: "Cómo controlarlas",
        paragraphs: [
          "Puedes borrar las cookies del sitio desde la configuración de tu navegador en cualquier momento; esto cerrará tu sesión.",
          "Puedes desactivar los anuncios personalizados en https://adssettings.google.com. Si visitas el sitio desde una región que lo exige, te pediremos tu consentimiento antes de usar cookies de publicidad.",
        ],
      },
    ],
  },
};

// Same words the page shows under its heading and in its panels.
export function legalServerContent(type: LegalPageType): {
  introduction: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
} {
  const page = LEGAL_CONTENT[type];
  return {
    introduction: `Última actualización: ${page.updated}. Preguntas: buscotrabajocolombia123@gmail.com`,
    sections: page.sections.map((section) => ({ heading: section.title, paragraphs: section.paragraphs }))
  };
}
