import type { CvTemplateSpec } from "./types.js";
import { atsClassicTemplate } from "./ats-classic.js";
import { modernTemplate } from "./modern.js";
import { executiveTemplate } from "./executive.js";
import { compactTemplate } from "./compact.js";

/**
 * Fase 10 — las 3-4 plantillas de v1 (decisión §2 del plan aprobado:
 * "3-4 plantillas en v1, arquitectura declarativa lista para crecer
 * después sin reescribir código"). Agregar una quinta plantilla en el
 * futuro es: un archivo nuevo + una línea acá, nada más — ni
 * `render-pdf.ts` ni `CvPreview.tsx` necesitan tocarse.
 */
export const CV_TEMPLATES: CvTemplateSpec[] = [atsClassicTemplate, modernTemplate, executiveTemplate, compactTemplate];

export const DEFAULT_TEMPLATE_ID = "ats_classic";

const BY_ID = new Map(CV_TEMPLATES.map((t) => [t.id, t]));

/** Nunca lanza — un `templateId` desconocido (fila vieja con un id que ya
 * no existe, dato corrupto, etc.) cae al default en vez de romper el
 * render. `render-pdf.ts`/`CvPreview.tsx` nunca necesitan su propio
 * manejo de "template no encontrado". */
export function getTemplate(templateId: string): CvTemplateSpec {
  return BY_ID.get(templateId) ?? BY_ID.get(DEFAULT_TEMPLATE_ID)!;
}
