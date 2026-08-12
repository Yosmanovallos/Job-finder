import { Check } from "lucide-react";
import { CV_TEMPLATES } from "../../cv/templates/registry.js";
import type { PdfStandardFont } from "../../cv/templates/types.js";

/**
 * Fase 10 de docs/RESUME-STUDIO-PLAN.md — tab "Diseño". `CV_TEMPLATES` es
 * data pura (`cv/templates/registry.ts`, sin imports de `pg`/`pdfkit`),
 * importada directo — no hay ni necesita haber un endpoint
 * "GET /api/cv/templates" solo para listar 4 objetos estáticos que ya
 * viven en el bundle del cliente de todas formas.
 *
 * Seleccionar una plantilla NUNCA importa nada de `cv/model-gateway.js`/
 * `ai-gateway/*` — este archivo entero es presentación, `onSelect` es la
 * única función que toca la red (PATCH .../template en el hook,
 * ver use-cv-adjust-state.ts), y esa función tampoco los importa
 * (verificado con grep, documentado en el server.ts real).
 */

const FONT_LABEL: Record<PdfStandardFont, string> = {
  Helvetica: "sans-serif",
  "Helvetica-Bold": "sans-serif",
  "Times-Roman": "serif",
  "Times-Bold": "serif"
};

const PREVIEW_FONT_FAMILY: Record<PdfStandardFont, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Helvetica-Bold": "Helvetica, Arial, sans-serif",
  "Times-Roman": "Georgia, 'Times New Roman', serif",
  "Times-Bold": "Georgia, 'Times New Roman', serif"
};

export interface TemplateGalleryProps {
  selectedId: string;
  onSelect: (templateId: string) => void;
  error: string | null;
}

export function TemplateGallery({ selectedId, onSelect, error }: TemplateGalleryProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">
        Cambiar de plantilla solo cambia la presentación — nunca vuelve a generar el contenido con IA.
        El DOCX descargable siempre usa un único formato ATS, sin importar la plantilla elegida aquí.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {CV_TEMPLATES.map((t) => {
          const selected = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={`text-left rounded-lg border p-3 transition-colors ${
                selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <div
                className="rounded border border-border bg-white p-2 mb-2"
                style={{ fontFamily: PREVIEW_FONT_FAMILY[t.typography.bodyFont] }}
              >
                <div
                  className="h-2 w-3/4 rounded-sm mb-1"
                  style={{ backgroundColor: t.colors.heading, opacity: 0.85 }}
                />
                <div className="h-1 w-full rounded-sm mb-0.5" style={{ backgroundColor: t.colors.rule }} />
                <div className="h-1 w-5/6 rounded-sm" style={{ backgroundColor: t.colors.rule }} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">{t.displayName}</span>
                {selected && <Check className="h-3 w-3 text-primary shrink-0" />}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {FONT_LABEL[t.typography.bodyFont]} · {t.description}
              </p>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-destructive font-mono mt-3">{error}</p>}
    </div>
  );
}
