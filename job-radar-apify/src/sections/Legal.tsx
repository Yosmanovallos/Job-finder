import { Link } from "react-router-dom";
import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";
import { usePageMeta } from "../lib/use-page-meta.js";

export type LegalPageType = "terminos" | "privacidad" | "uso-aceptable" | "cookies";

interface LegalSection {
  title: string;
  paragraphs: string[];
}

const metaDescriptions: Record<LegalPageType, string> = {
  terminos: "Términos de uso de BuscoTrabajo: qué es el servicio, planes y pago, y disponibilidad de los datos de vacantes.",
  privacidad: "Política de privacidad de BuscoTrabajo: qué datos recolectamos, qué no recolectamos y tus derechos sobre tu información.",
  "uso-aceptable": "Uso aceptable de BuscoTrabajo: qué está permitido y qué no al usar el servicio de búsqueda de empleo.",
  cookies: "Política de cookies de BuscoTrabajo: qué cookies usamos y cómo controlarlas desde tu navegador."
};

const content: Record<LegalPageType, { title: string; sections: LegalSection[] }> = {
  terminos: {
    title: "Términos de uso",
    sections: [
      {
        title: "Qué es BuscoTrabajo",
        paragraphs: [
          "BuscoTrabajo es un agregador que recopila vacantes de empleo publicadas de forma pública en portales como LinkedIn, Computrabajo, Elempleo, Magneto, Torre, GetOnBoard, RemoteOK, Remotive, Workana, WeRemoto, Indeed y Glassdoor, las deduplica y las presenta en un solo dashboard.",
          "BuscoTrabajo nunca aplica a un empleo por ti. La decisión de postularte y el envío de cada aplicación son siempre tuyos, en el sitio original.",
        ],
      },
      {
        title: "Planes y pago",
        paragraphs: [
          `El plan Gratis da acceso ilimitado a vacantes con más de 48 horas de publicadas. El plan Pro (${formatCOP(PRO_MONTHLY_PRICE_COP)} COP/mes) desbloquea el acceso inmediato a vacantes desde el momento en que se publican.`,
          "Los pagos del plan Pro se procesan a través de Wompi. BuscoTrabajo no almacena datos de tarjetas — eso lo maneja Wompi directamente.",
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
    sections: [
      {
        title: "Qué sí puedes hacer",
        paragraphs: [
          "Usar BuscoTrabajo para buscar empleo, guardar vacantes, marcar las que ya aplicaste y suscribirte al plan Pro para ver resultados desde el minuto 0.",
        ],
      },
      {
        title: "Qué no está permitido",
        paragraphs: [
          "Extraer masivamente (scraping) el contenido de BuscoTrabajo para redistribuirlo o revenderlo.",
          "Automatizar solicitudes al servicio fuera de lo que la interfaz permite, o intentar evadir el paywall de frescura de 48 horas.",
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

export default function Legal({ type }: { type: LegalPageType }) {
  const page = content[type];

  usePageMeta({
    title: `${page.title} — BuscoTrabajo`,
    description: metaDescriptions[type]
  });

  return (
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#fafafa" }}>
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-block mb-6 text-sm font-mono text-primary hover:text-primary"
        >
          ← Volver al inicio
        </Link>

        <div className="mb-8 p-4 rounded-lg border border-accent/30 bg-accent/10 text-accent text-xs font-mono leading-relaxed">
          ⚠️ Documento borrador — pendiente de revisión legal profesional antes
          de producción. No constituye asesoría legal.
        </div>

        <h1 className="text-3xl font-bold mb-8 font-heading" style={{ color: "#0e0f10" }}>
          {page.title}
        </h1>

        <div className="space-y-8">
          {page.sections.map((section) => (
            <div key={section.title}>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "#0e0f10" }}>
                {section.title}
              </h2>
              <div className="space-y-3">
                {section.paragraphs.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed" style={{ color: "#5b5f5c" }}>
                    {p}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-xs font-mono" style={{ color: "#9a9d98" }}>
          Última actualización: julio de 2026. Preguntas: buscotrabajocolombia123@gmail.com
        </p>
      </div>
    </section>
  );
}
