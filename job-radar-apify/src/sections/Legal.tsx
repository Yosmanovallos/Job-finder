import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/use-page-meta.js";
import { ROUTE_META } from "../lib/page-meta.js";
import { TINTS } from "../lib/brand-tints.js";
import { ContentSection, InkPanel, PageHero } from "../components/ContentPage.js";

export type LegalPageType = "terminos" | "privacidad" | "uso-aceptable" | "cookies";

interface LegalSection {
  title: string;
  paragraphs: string[];
}


const content: Record<LegalPageType, { title: string; updated: string; sections: LegalSection[] }> = {
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
    updated: "julio de 2026",
    sections: [
      {
        title: "Qué datos recolectamos",
        paragraphs: [
          "Tu correo electrónico y credenciales de sesión, gestionadas por Supabase Auth (incluye inicio de sesión con Google o con correo/contraseña).",
          "El estado de tu suscripción (free/pro) y el historial de transacciones de pago, gestionado junto con Wompi.",
          "Vacantes que marques como guardadas o aplicadas — se guardan asociadas a tu sesión, no se comparten con nadie.",
        ],
      },
      {
        title: "Qué NO recolectamos",
        paragraphs: [
          "No almacenamos datos de tarjetas de crédito ni información financiera directamente — eso lo procesa Wompi bajo sus propios estándares de seguridad.",
          "No vendemos ni compartimos tu información con terceros con fines publicitarios.",
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
    updated: "julio de 2026",
    sections: [
      {
        title: "Qué cookies usamos",
        paragraphs: [
          "Una cookie/token de sesión gestionado por Supabase Auth para mantenerte conectado entre visitas. Es estrictamente necesaria para que el inicio de sesión funcione.",
          "Hoy no usamos cookies de publicidad ni de rastreo de terceros.",
        ],
      },
      {
        title: "Cómo controlarlas",
        paragraphs: [
          "Puedes borrar las cookies del sitio desde la configuración de tu navegador en cualquier momento; esto cerrará tu sesión.",
        ],
      },
    ],
  },
};

const LEGAL_LINKS: Array<{ type: LegalPageType; label: string }> = [
  { type: "terminos", label: "Términos de uso" },
  { type: "privacidad", label: "Privacidad" },
  { type: "uso-aceptable", label: "Uso aceptable" },
  { type: "cookies", label: "Cookies" }
];

// Presentation only: the legal text above is the user's to change.
export default function Legal({ type }: { type: LegalPageType }) {
  const page = content[type];

  usePageMeta(ROUTE_META[`/legal/${type}`]!);

  return (
    <div className="bg-white">
      <PageHero eyebrow="Legal" heading={page.title}>
        <p>Última actualización: {page.updated}. Preguntas: buscotrabajocolombia123@gmail.com</p>
      </PageHero>
      <ContentSection>
        <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
          <nav aria-label="Documentos legales" className="md:sticky md:top-24 w-full md:w-[240px] shrink-0">
            <ul className="flex md:flex-col flex-wrap gap-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.type}>
                  <Link
                    to={`/legal/${link.type}`}
                    aria-current={link.type === type ? "page" : undefined}
                    className={`ink-card-sm inline-flex md:flex w-full rounded-xl px-4 py-2.5 text-sm font-semibold no-underline ${
                      link.type === type ? "bg-primary text-white" : "bg-white text-foreground ink-lift"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="sr-stagger flex-1 min-w-0 flex flex-col gap-4 md:gap-6">
            {page.sections.map((section, index) => {
              const tint = TINTS[index % TINTS.length]!;
              return (
                <InkPanel key={section.title} tint={tint.bg}>
                  <p className="font-mono text-xs font-bold" style={{ color: tint.sub }}>
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h2 className="mt-1 font-heading font-bold text-xl md:text-[26px] leading-tight tracking-[-0.02em]" style={{ color: tint.fg }}>
                    {section.title}
                  </h2>
                  <div className="mt-3 space-y-3">
                    {section.paragraphs.map((p, i) => (
                      <p key={i} className="text-[15px] md:text-base leading-relaxed text-[#3d413e]">
                        {p}
                      </p>
                    ))}
                  </div>
                </InkPanel>
              );
            })}
          </div>
        </div>
      </ContentSection>
    </div>
  );
}
