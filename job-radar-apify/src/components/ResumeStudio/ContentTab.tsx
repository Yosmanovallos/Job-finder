import { useState } from "react";
import { ChevronUp, ChevronDown, EyeOff, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "../ui/button.js";
import { useAuth } from "../../auth/auth-provider.js";
import type { CvDocument, Claim } from "../../cv/cv-document-schema.js";
import type { CvFacts } from "../../cv/cv-facts-schema.js";
import type { SelectedByokModel } from "./ModelPicker.js";

/**
 * Fase 7 de docs/RESUME-STUDIO-PLAN.md — tab "Contenido" del panel
 * izquierdo. Mismos tres widgets (`Field`/`BulletsEditor`/
 * `ReorderHideList`) que ya existían dentro de `CvAdjustOverlay.tsx`,
 * portados aquí (duplicados a propósito, ver el comentario de
 * `use-cv-adjust-state.ts` — ese archivo no se toca hasta la Fase 13).
 * Opera directo sobre `CvDocument`, nunca sobre texto libre — el mismo
 * invariante de factualidad de siempre (cada claim cita ids reales de
 * `CvFacts`), por eso esto sigue siendo inputs por-claim y no un editor de
 * texto rico (decisión no negociable del plan aprobado, §"Hallazgos").
 *
 * Fase 8: cada Claim editable (titular, resumen, cada bullet) gana
 * `AiSectionAction` — las 3 acciones (Mejorar/Adaptar/Más ejecutivo) del
 * plan aprobado, contra `POST /api/cv/generations/:id/sections/rewrite`
 * (`cv_section_rewrite`, activado tras eval real). Solo Claims (texto +
 * supporting_fact_ids) lo tienen — Habilidades/Educación/Certificaciones
 * son reordenar/ocultar, no texto libre, así que no aplica ahí.
 *
 * Fase 9: cada Claim con `rationale` (Fase 8 v2 — por qué la IA cambió el
 * texto) muestra un "¿Por qué?" persistente, no solo en el momento del
 * diff. Una edición manual del texto (`updateClaim`/`BulletsEditor.update`)
 * limpia `rationale` de ese claim — sigue siendo el mismo dato en
 * `CvDocument`, pero la explicación ya no describe fielmente lo que dice
 * el campo, así que no tiene sentido dejarla colgada.
 */

const TEXTAREA_CLASS =
  "flex w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20";

const MAX_BULLETS = 5;
const MIN_BULLETS = 1;

export interface ContentTabProps {
  document: CvDocument;
  facts: CvFacts | null;
  onChange: (doc: CvDocument) => void;
  generationId: string;
  /** Fase 11 — modelo elegido en el ModelPicker del header; `null`/ausente
   * usa el default operador-financiado de siempre. */
  byokModel?: SelectedByokModel | null;
}

export function ContentTab({ document: doc, facts, onChange, generationId, byokModel }: ContentTabProps) {
  const updateClaim = (field: "headline" | "summary", text: string) => {
    onChange({ ...doc, [field]: { ...doc[field], text, rationale: undefined } });
  };
  const acceptClaimProposal = (field: "headline" | "summary", claim: Claim) => {
    onChange({ ...doc, [field]: claim });
  };

  const experienceById = new Map((facts?.experience ?? []).map((e) => [e.id, e]));
  const skillById = new Map((facts?.skills ?? []).map((s) => [s.id, { id: s.id, label: s.name }]));
  const educationById = new Map(
    (facts?.education ?? []).map((e) => [e.id, { id: e.id, label: `${e.institution} — ${e.degree}` }])
  );
  const certificationById = new Map(
    (facts?.certifications ?? []).map((c) => [c.id, { id: c.id, label: [c.name, c.issuer].filter(Boolean).join(" — ") }])
  );

  return (
    <div>
      {facts && (
        <div className="hud-corners rounded-lg border border-border bg-card p-4 mb-6 text-sm text-muted-foreground">
          {facts.contact.name}
          {facts.contact.email ? ` · ${facts.contact.email}` : ""}
          {facts.contact.phone ? ` · ${facts.contact.phone}` : ""}
          {facts.contact.location ? ` · ${facts.contact.location}` : ""}
        </div>
      )}

      <Field label="Titular (headline)">
        <textarea
          value={doc.headline.text}
          onChange={(e) => updateClaim("headline", e.target.value)}
          rows={2}
          className={TEXTAREA_CLASS}
        />
        <RationaleNote rationale={doc.headline.rationale} />
        <AiSectionAction
          generationId={generationId}
          sectionLabel="Titular"
          currentText={doc.headline.text}
          onAccept={(claim) => acceptClaimProposal("headline", claim)}
          byokModel={byokModel}
        />
      </Field>

      <Field label="Resumen">
        <textarea
          value={doc.summary.text}
          onChange={(e) => updateClaim("summary", e.target.value)}
          rows={3}
          className={TEXTAREA_CLASS}
        />
        <RationaleNote rationale={doc.summary.rationale} />
        <AiSectionAction
          generationId={generationId}
          sectionLabel="Resumen"
          currentText={doc.summary.text}
          onAccept={(claim) => acceptClaimProposal("summary", claim)}
          byokModel={byokModel}
        />
      </Field>

      <Field label="Experiencia">
        <div className="space-y-4">
          {doc.experience.map((exp, i) => {
            const source = experienceById.get(exp.source_id);
            return (
              <div key={exp.source_id} className="hud-corners rounded-lg border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">{source?.title ?? "(experiencia)"}</p>
                <p className="text-xs text-muted-foreground mb-3">
                  {source?.company ?? "—"}
                  {source ? ` · ${source.start_date ?? "?"} – ${source.end_date ?? "Actual"}` : ""}
                </p>
                <BulletsEditor
                  bullets={exp.bullets}
                  onChange={(bullets) => {
                    const nextExperience = doc.experience.map((e, idx) => (idx === i ? { ...e, bullets } : e));
                    onChange({ ...doc, experience: nextExperience });
                  }}
                  generationId={generationId}
                  sectionLabel={`Logro en ${source?.company ?? "esta experiencia"}`}
                  byokModel={byokModel}
                />
              </div>
            );
          })}
        </div>
      </Field>

      <Field label="Habilidades">
        <ReorderHideList
          items={[...skillById.values()]}
          includedIds={doc.reordered_skill_ids}
          onChange={(ids) => onChange({ ...doc, reordered_skill_ids: ids })}
        />
      </Field>

      <Field label="Educación">
        <ReorderHideList
          items={[...educationById.values()]}
          includedIds={doc.reordered_education_ids}
          onChange={(ids) => onChange({ ...doc, reordered_education_ids: ids })}
        />
      </Field>

      <Field label="Certificaciones">
        <ReorderHideList
          items={[...certificationById.values()]}
          includedIds={doc.reordered_certification_ids}
          onChange={(ids) => onChange({ ...doc, reordered_certification_ids: ids })}
        />
      </Field>

      {facts && facts.languages.length > 0 && (
        <Field label="Idiomas">
          <p className="text-sm text-muted-foreground">
            {facts.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", ")}
          </p>
        </Field>
      )}

      {doc.gaps_not_to_claim.length > 0 && (
        <Field label="Requisitos que este CV no reclama (honesto por diseño)">
          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
            {doc.gaps_not_to_claim.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="font-heading font-semibold text-sm text-foreground mb-2">{label}</h3>
      {children}
    </div>
  );
}

// Fase 9 — persiste DESPUÉS de aceptar una propuesta de IA (no solo en el
// momento del diff), colapsado por defecto para no saturar el panel
// cuando varios claims ya tienen una explicación guardada. Ausente por
// completo (nunca un botón deshabilitado) cuando el claim no tiene
// rationale — ej. texto escrito a mano, o el documento original de
// cv_draft, que nunca lo pobló.
function RationaleNote({ rationale }: { rationale: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!rationale) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] font-mono text-primary hover:underline"
      >
        {expanded ? "Ocultar ¿por qué?" : "¿Por qué?"}
      </button>
      {expanded && <p className="text-xs text-muted-foreground italic mt-1">{rationale}</p>}
    </div>
  );
}

function BulletsEditor({
  bullets,
  onChange,
  generationId,
  sectionLabel,
  byokModel
}: {
  bullets: Claim[];
  onChange: (bullets: Claim[]) => void;
  generationId: string;
  sectionLabel: string;
  byokModel?: SelectedByokModel | null;
}) {
  const update = (i: number, text: string) => {
    onChange(bullets.map((b, idx) => (idx === i ? { ...b, text, rationale: undefined } : b)));
  };
  const acceptProposal = (i: number, claim: Claim) => {
    onChange(bullets.map((b, idx) => (idx === i ? claim : b)));
  };
  const remove = (i: number) => {
    if (bullets.length <= MIN_BULLETS) return;
    onChange(bullets.filter((_, idx) => idx !== i));
  };
  const move = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= bullets.length) return;
    const next = [...bullets];
    [next[i], next[target]] = [next[target]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    if (bullets.length >= MAX_BULLETS) return;
    onChange([...bullets, { text: "", supporting_fact_ids: [] }]);
  };

  return (
    <div className="space-y-2">
      {bullets.map((b, i) => (
        <div key={i}>
          <div className="flex items-start gap-2">
            <textarea value={b.text} onChange={(e) => update(i, e.target.value)} rows={2} className={`${TEXTAREA_CLASS} flex-1`} />
            <div className="flex flex-col gap-1 shrink-0 pt-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === bullets.length - 1}
                aria-label="Bajar"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={bullets.length <= MIN_BULLETS}
                aria-label="Eliminar"
                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <RationaleNote rationale={b.rationale} />
          <AiSectionAction
            generationId={generationId}
            sectionLabel={sectionLabel}
            currentText={b.text}
            onAccept={(claim) => acceptProposal(i, claim)}
            byokModel={byokModel}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={bullets.length >= MAX_BULLETS}>
        + Agregar logro
      </Button>
    </div>
  );
}

type SectionAction = "mejorar" | "adaptar" | "ejecutivo";
const SECTION_ACTIONS: { id: SectionAction; label: string }[] = [
  { id: "mejorar", label: "Mejorar" },
  { id: "adaptar", label: "Adaptar" },
  { id: "ejecutivo", label: "Más ejecutivo" }
];

interface AiSectionActionProps {
  generationId: string;
  sectionLabel: string;
  currentText: string;
  onAccept: (claim: Claim) => void;
  byokModel?: SelectedByokModel | null;
}

/**
 * Fase 8 — las 3 acciones de IA por sección del plan aprobado. Diseño
 * deliberado con 2 botones reales (Aceptar/Descartar), no 3: la
 * "Propuesta" llega en un textarea YA editable (el "buffer que confirma
 * al aceptar" que pedía el plan) — no hay un estado intermedio distinto
 * entre "editar la propuesta" y "aceptarla", así que un tercer botón
 * "Editar" sería la misma operación con otro nombre. "Aceptar" confirma
 * lo que esté en ese buffer en ese momento (texto tal cual de la IA, o
 * ya retocado a mano) junto con los supporting_fact_ids que trajo la
 * propuesta — igual que "Guardar cambios" en el documento completo, una
 * edición humana sobre un Claim nunca se re-valida contra factuality.ts
 * (ver su comentario: "el usuario edita su propio documento").
 */
function AiSectionAction({ generationId, sectionLabel, currentText, onAccept, byokModel }: AiSectionActionProps) {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<"idle" | "loading" | "proposed" | "error">("idle");
  const [proposalText, setProposalText] = useState("");
  const [proposalFactIds, setProposalFactIds] = useState<string[]>([]);
  const [proposalRationale, setProposalRationale] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const requestProposal = async (action: SectionAction) => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/cv/generations/${generationId}/sections/rewrite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionLabel,
          currentText,
          action,
          ...(byokModel ? { providerId: byokModel.providerId, modelId: byokModel.modelId } : {})
        })
      });
      const body = await res.json().catch(() => ({}) as { error?: string; proposal?: Claim });
      if (!res.ok) {
        setError((body as { error?: string }).error || "No se pudo generar una propuesta.");
        setStatus("error");
        return;
      }
      const proposal = (body as { proposal?: Claim }).proposal;
      if (!proposal) {
        setError("No se pudo generar una propuesta.");
        setStatus("error");
        return;
      }
      setProposalText(proposal.text);
      setProposalFactIds(proposal.supporting_fact_ids);
      setProposalRationale(proposal.rationale);
      setStatus("proposed");
    } catch {
      setError("No se pudo generar una propuesta. Intenta de nuevo.");
      setStatus("error");
    }
  };

  const discard = () => {
    setStatus("idle");
    setError(null);
  };

  const accept = () => {
    onAccept({ text: proposalText, supporting_fact_ids: proposalFactIds, rationale: proposalRationale });
    setStatus("idle");
  };

  if (status === "proposed") {
    return (
      <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1">Original</p>
        <p className="text-xs text-muted-foreground mb-2 line-through decoration-muted-foreground/40">{currentText}</p>
        <p className="text-[10px] font-mono uppercase tracking-wide text-primary mb-1">Propuesta — puedes editarla antes de aceptar</p>
        <textarea
          value={proposalText}
          onChange={(e) => setProposalText(e.target.value)}
          rows={2}
          className={`${TEXTAREA_CLASS} mb-2`}
        />
        {proposalRationale && (
          <p className="text-xs text-muted-foreground italic mb-2">¿Por qué? {proposalRationale}</p>
        )}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={accept}>
            Aceptar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={discard}>
            Descartar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Sparkles className="h-3 w-3 text-primary shrink-0" />
      {SECTION_ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => void requestProposal(a.id)}
          disabled={status === "loading" || !currentText.trim()}
          className="px-2 py-1 rounded-md border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {status === "loading" ? <Loader2 className="h-3 w-3 animate-spin inline" /> : a.label}
        </button>
      ))}
      {status === "error" && error && <p className="text-[11px] text-destructive font-mono w-full">{error}</p>}
    </div>
  );
}

interface NamedFact {
  id: string;
  label: string;
}

function ReorderHideList({ items, includedIds, onChange }: { items: NamedFact[]; includedIds: string[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const included = includedIds.filter((id) => byId.has(id));
  const hidden = items.filter((item) => !included.includes(item.id));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= included.length) return;
    const next = [...included];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const hide = (id: string) => onChange(included.filter((i) => i !== id));
  const show = (id: string) => onChange([...included, id]);

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Tu CV base no tiene nada en esta sección.</p>;
  }

  return (
    <div>
      {included.length === 0 && <p className="text-xs text-muted-foreground mb-2">Nada incluido — todo está oculto.</p>}
      <ul className="space-y-1 mb-2">
        {included.map((id, i) => (
          <li key={id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 rounded px-2 py-1.5">
            <span className="truncate">{byId.get(id)?.label}</span>
            <span className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === included.length - 1}
                aria-label="Bajar"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => hide(id)} aria-label="Ocultar" className="text-muted-foreground hover:text-destructive">
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hidden.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => show(item.id)}
              className="text-xs text-muted-foreground border border-dashed border-border rounded px-2 py-1 hover:text-foreground"
            >
              + {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
