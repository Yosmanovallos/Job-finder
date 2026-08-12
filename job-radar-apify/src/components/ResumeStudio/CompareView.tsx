import { RotateCcw } from "lucide-react";
import type { CvDocument, Claim } from "../../cv/cv-document-schema.js";
import type { CvFacts } from "../../cv/cv-facts-schema.js";

/**
 * Fase 12 de docs/RESUME-STUDIO-PLAN.md — modo Comparar:
 * `generated_document_json` (original inmutable de la IA) vs.
 * `document_json` (versión editada actual). Sin schema nuevo — ambas
 * columnas ya existen desde la Fase 0 de CV-GENERATION-PLAN.md, esto es
 * solo UI nueva sobre datos que ya se traían al bootstrap (Fase 12
 * agrega `generatedDocument` a esa respuesta, ver use-cv-adjust-state.ts).
 *
 * Comparación deliberadamente simple, campo/claim por campo (no
 * word-level diff, no librería nueva — decisión explícita del plan
 * aprobado): cada Claim (titular, resumen, cada bullet) se compara
 * texto-a-texto contra su contraparte en el original; una diferencia se
 * resalta y trae "Revertir a la versión original" — restaura ESE claim
 * específico (texto + supporting_fact_ids + rationale), nunca el
 * documento completo. Listas reordenadas (habilidades/educación/
 * certificaciones) se comparan como conjuntos (agregado/eliminado), con
 * un solo botón de revertir por lista — no son Claims, no tiene sentido
 * un revert "por ítem" ahí. `gaps_not_to_claim`/`omitted_fact_ids` no
 * tienen comparación aquí a propósito: `ContentTab.tsx` los renderiza
 * de solo lectura (nunca editables desde la UI), así que no pueden
 * divergir entre `document`/`generatedDocument` por ningún camino real.
 *
 * Desviación deliberada al plan aprobado ("reusa resolveCvDocumentForRender
 * para ambas versiones"): esta vista compara los `CvDocument` crudos
 * (Claims: texto + supporting_fact_ids + rationale), NO su versión
 * resuelta a texto plano — revertir un claim necesita el objeto completo
 * de vuelta, no solo el string que `resolveCvDocumentForRender` produce
 * (esa función pierde `supporting_fact_ids`/`rationale` a propósito, son
 * detalle de implementación para el renderer final). `CvFacts` sí se usa
 * directo (sin pasar por ese resolver) solo para traducir un `source_id`/
 * skill id a una etiqueta legible en los encabezados — mismo patrón que
 * ya usa `ContentTab.tsx`. Un id obsoleto (CV base reemplazado después de
 * generar) se degrada al id crudo en vez de romper la comparación —
 * mismo criterio defensivo de `resolveCvDocumentForRender`, aplicado a
 * mano aquí porque el dato que se necesita es distinto.
 */

export interface CompareViewProps {
  document: CvDocument;
  generatedDocument: CvDocument;
  onChange: (doc: CvDocument) => void;
  facts: CvFacts | null;
}

function claimChanged(a: Claim, b: Claim): boolean {
  return a.text !== b.text;
}

export function CompareView({ document: doc, generatedDocument, onChange, facts }: CompareViewProps) {
  const revertClaim = (updater: (d: CvDocument) => CvDocument) => onChange(updater(doc));

  const experienceById = new Map((facts?.experience ?? []).map((e) => [e.id, e]));

  const anyChange =
    claimChanged(doc.headline, generatedDocument.headline) ||
    claimChanged(doc.summary, generatedDocument.summary) ||
    JSON.stringify(doc.experience) !== JSON.stringify(generatedDocument.experience) ||
    JSON.stringify(doc.reordered_skill_ids) !== JSON.stringify(generatedDocument.reordered_skill_ids) ||
    JSON.stringify(doc.reordered_education_ids) !== JSON.stringify(generatedDocument.reordered_education_ids) ||
    JSON.stringify(doc.reordered_certification_ids) !== JSON.stringify(generatedDocument.reordered_certification_ids);

  return (
    <div className="space-y-6">
      {!anyChange && (
        <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          Tu versión actual es idéntica a lo que generó la IA — todavía no has editado ni aceptado ningún cambio.
        </p>
      )}

      <ClaimCompareField
        label="Titular (headline)"
        current={doc.headline}
        original={generatedDocument.headline}
        onRevert={() => revertClaim((d) => ({ ...d, headline: generatedDocument.headline }))}
      />

      <ClaimCompareField
        label="Resumen"
        current={doc.summary}
        original={generatedDocument.summary}
        onRevert={() => revertClaim((d) => ({ ...d, summary: generatedDocument.summary }))}
      />

      {doc.experience.map((exp, expIndex) => {
        const original = generatedDocument.experience.find((e) => e.source_id === exp.source_id);
        const source = experienceById.get(exp.source_id);
        const title = source ? `${source.title} — ${source.company}` : "(experiencia)";
        if (!original) {
          return (
            <div key={exp.source_id} className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-foreground mb-1">{title}</p>
              <p className="text-[10px] font-mono uppercase tracking-wide text-primary">
                Agregado — no existía en la versión original de la IA
              </p>
            </div>
          );
        }
        return (
          <div key={exp.source_id}>
            <p className="text-sm font-semibold text-foreground mb-2">{title}</p>
            <div className="space-y-2 pl-3 border-l-2 border-border">
              {exp.bullets.map((bullet, i) => {
                const originalBullet = original.bullets[i];
                if (!originalBullet) {
                  return (
                    <div key={i} className="rounded-lg border border-primary/30 bg-primary/5 p-2">
                      <p className="text-[10px] font-mono uppercase tracking-wide text-primary mb-1">Logro agregado</p>
                      <p className="text-xs text-foreground">{bullet.text}</p>
                    </div>
                  );
                }
                return (
                  <ClaimCompareField
                    key={i}
                    label={null}
                    current={bullet}
                    original={originalBullet}
                    onRevert={() =>
                      revertClaim((d) => ({
                        ...d,
                        experience: d.experience.map((e, idx) =>
                          idx === expIndex
                            ? { ...e, bullets: e.bullets.map((b, bi) => (bi === i ? originalBullet : b)) }
                            : e
                        )
                      }))
                    }
                  />
                );
              })}
              {original.bullets.slice(exp.bullets.length).map((removedBullet, i) => (
                <div key={`removed-${i}`} className="rounded-lg border border-border bg-muted/30 p-2 opacity-70">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1">
                    Logro eliminado de la propuesta original
                  </p>
                  <p className="text-xs text-muted-foreground line-through decoration-muted-foreground/40">
                    {removedBullet.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <ListCompareField
        label="Orden de habilidades"
        current={doc.reordered_skill_ids}
        original={generatedDocument.reordered_skill_ids}
        idToLabel={(id) => facts?.skills.find((s) => s.id === id)?.name ?? id}
        onRevert={() => revertClaim((d) => ({ ...d, reordered_skill_ids: generatedDocument.reordered_skill_ids }))}
      />
      <ListCompareField
        label="Orden de educación"
        current={doc.reordered_education_ids}
        original={generatedDocument.reordered_education_ids}
        idToLabel={(id) => {
          const e = facts?.education.find((e) => e.id === id);
          return e ? `${e.institution} — ${e.degree}` : id;
        }}
        onRevert={() => revertClaim((d) => ({ ...d, reordered_education_ids: generatedDocument.reordered_education_ids }))}
      />
      <ListCompareField
        label="Orden de certificaciones"
        current={doc.reordered_certification_ids}
        original={generatedDocument.reordered_certification_ids}
        idToLabel={(id) => facts?.certifications.find((c) => c.id === id)?.name ?? id}
        onRevert={() =>
          revertClaim((d) => ({ ...d, reordered_certification_ids: generatedDocument.reordered_certification_ids }))
        }
      />
    </div>
  );
}

function ClaimCompareField({
  label,
  current,
  original,
  onRevert
}: {
  label: string | null;
  current: Claim;
  original: Claim;
  onRevert: () => void;
}) {
  const changed = claimChanged(current, original);
  return (
    <div>
      {label && <p className="text-sm font-semibold text-foreground mb-1.5">{label}</p>}
      {!changed ? (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">{current.text}</p>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Original (IA)</p>
            <p className="text-xs text-muted-foreground line-through decoration-muted-foreground/40">{original.text}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide text-amber-700 dark:text-amber-400">Actual</p>
            <p className="text-xs text-foreground">{current.text}</p>
          </div>
          <button
            type="button"
            onClick={onRevert}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono"
          >
            <RotateCcw className="h-3 w-3" /> Revertir a la versión original
          </button>
        </div>
      )}
    </div>
  );
}

function ListCompareField({
  label,
  current,
  original,
  idToLabel,
  onRevert
}: {
  label: string;
  current: string[];
  original: string[];
  idToLabel: (id: string) => string;
  onRevert: () => void;
}) {
  const changed = JSON.stringify(current) !== JSON.stringify(original);
  if (!changed) return null; // el estado "sin cambios" ya lo cubre el ClaimCompareField de arriba; evita ruido repetido

  const added = current.filter((id) => !original.includes(id));
  const removed = original.filter((id) => !current.includes(id));
  const reorderedOnly = added.length === 0 && removed.length === 0;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      {reorderedOnly && <p className="text-xs text-muted-foreground">Mismos elementos, orden distinto.</p>}
      {added.length > 0 && (
        <p className="text-xs text-foreground">
          <span className="text-[10px] font-mono uppercase tracking-wide text-amber-700 dark:text-amber-400 mr-1">
            Agregado:
          </span>
          {added.map(idToLabel).join(", ")}
        </p>
      )}
      {removed.length > 0 && (
        <p className="text-xs text-muted-foreground line-through decoration-muted-foreground/40">
          {removed.map(idToLabel).join(", ")}
        </p>
      )}
      <button
        type="button"
        onClick={onRevert}
        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono"
      >
        <RotateCcw className="h-3 w-3" /> Revertir a la versión original
      </button>
    </div>
  );
}
