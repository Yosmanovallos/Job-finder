import type { CSSProperties, ReactNode } from "react";
import { formatResumeMonth, formatResumeRange, resumeSectionTitles, type ResumeFacts, type ResumeTemplateId } from "../../lib/resume-studio.js";
import { cvLanguage } from "../../lib/resume-tailor/language.js";

// The three one-column templates (docs/resume-studio/04, ADR 0017 R1). The
// same component renders the preview now and the PDF later (doc 06 §6), so
// it only uses plain text, inline styles that survive print and no images.
// Everything is React text nodes: user input is escaped, never HTML.

interface TemplateStyle {
  page: CSSProperties;
  name: CSSProperties;
  headline: CSSProperties;
  contact: CSSProperties;
  sectionTitle: CSSProperties;
  itemTitle: CSSProperties;
  meta: CSSProperties;
  body: CSSProperties;
}

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';

const STYLES: Record<ResumeTemplateId, TemplateStyle> = {
  clasica: {
    page: { fontFamily: SERIF, color: "#1d1f1e", fontSize: 13, lineHeight: 1.45, padding: "40px 44px" },
    name: { fontSize: 26, fontWeight: 700, textAlign: "center", margin: 0 },
    headline: { fontSize: 14, textAlign: "center", margin: "4px 0 0", color: "#3d413e" },
    contact: { fontSize: 12, textAlign: "center", margin: "6px 0 0", color: "#3d413e" },
    sectionTitle: {
      fontSize: 13,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      borderBottom: "1px solid #1d1f1e",
      paddingBottom: 2,
      margin: "18px 0 8px"
    },
    itemTitle: { fontWeight: 700 },
    meta: { color: "#3d413e", fontSize: 12 },
    body: { margin: "2px 0 0" }
  },
  moderna: {
    page: { fontFamily: SANS, color: "#1d1f1e", fontSize: 13, lineHeight: 1.5, padding: "40px 44px" },
    name: { fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" },
    headline: { fontSize: 15, margin: "2px 0 0", color: "#1f7a4d", fontWeight: 600 },
    contact: { fontSize: 12, margin: "6px 0 0", color: "#3d413e" },
    sectionTitle: {
      fontSize: 12,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      color: "#1f7a4d",
      margin: "20px 0 8px"
    },
    itemTitle: { fontWeight: 700 },
    meta: { color: "#5b605c", fontSize: 12 },
    body: { margin: "2px 0 0" }
  },
  compacta: {
    page: { fontFamily: SANS, color: "#1d1f1e", fontSize: 11.5, lineHeight: 1.35, padding: "26px 30px" },
    name: { fontSize: 20, fontWeight: 800, margin: 0 },
    headline: { fontSize: 12.5, margin: "1px 0 0", fontWeight: 600 },
    contact: { fontSize: 11, margin: "3px 0 0", color: "#3d413e" },
    sectionTitle: {
      fontSize: 11,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      borderBottom: "1px solid #c9ccc9",
      margin: "11px 0 5px"
    },
    itemTitle: { fontWeight: 700 },
    meta: { color: "#5b605c", fontSize: 11 },
    body: { margin: "1px 0 0" }
  }
};

function Section({ title, style, children }: { title: string; style: TemplateStyle; children: ReactNode }) {
  return (
    <section>
      <h2 style={style.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

const joined = (...parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).join(" · ");

export function ResumeTemplate({ facts, templateId }: { facts: ResumeFacts; templateId: ResumeTemplateId }) {
  const s = STYLES[templateId] ?? STYLES.clasica;
  const { basics } = facts;
  const contact = joined(basics.email, basics.phone, basics.city, ...basics.links);
  const experience = facts.experience.filter((e) => e.role.trim() || e.company.trim());
  const education = facts.education.filter((e) => e.degree.trim() || e.institution.trim());
  const certifications = facts.certifications.filter((c) => c.name.trim());
  const skills = facts.skills.map((skill) => skill.name.trim()).filter(Boolean);
  const languages = facts.languages.filter((l) => l.name.trim());
  // R4d: headings and dates in the CV's own language (detected by code).
  const lang = cvLanguage(facts) ?? "es";
  const t = resumeSectionTitles(lang);

  return (
    <article data-resume-template={templateId} style={{ ...s.page, background: "#fff", wordBreak: "break-word" }}>
      <header>
        <h1 style={s.name}>{basics.fullName.trim() || "Tu nombre"}</h1>
        {basics.headline.trim() ? <p style={s.headline}>{basics.headline}</p> : null}
        {contact ? <p style={s.contact}>{contact}</p> : null}
      </header>

      {facts.summary.trim() ? (
        <Section title={t.summary} style={s}>
          <p style={{ ...s.body, whiteSpace: "pre-line" }}>{facts.summary}</p>
        </Section>
      ) : null}

      {experience.length ? (
        <Section title={t.experience} style={s}>
          {experience.map((item) => (
            <div key={item.id} style={{ marginBottom: templateId === "compacta" ? 6 : 10 }}>
              <div>
                <span style={s.itemTitle}>{item.role || "Cargo"}</span>
                {item.company ? <span>{` · ${item.company}`}</span> : null}
              </div>
              <div style={s.meta}>{joined(formatResumeRange(item.startDate, item.endDate, item.current, lang), item.city)}</div>
              {item.bullets.some((b) => b.text.trim()) ? (
                <ul style={{ margin: "3px 0 0", paddingLeft: 18 }}>
                  {item.bullets
                    .filter((b) => b.text.trim())
                    .map((bullet) => (
                      <li key={bullet.id}>{bullet.text}</li>
                    ))}
                </ul>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}

      {education.length ? (
        <Section title={t.education} style={s}>
          {education.map((item) => (
            <div key={item.id} style={{ marginBottom: 6 }}>
              <span style={s.itemTitle}>{item.degree || "Título"}</span>
              {item.institution ? <span>{` · ${item.institution}`}</span> : null}
              <div style={s.meta}>{joined(formatResumeRange(item.startDate, item.endDate, false, lang), item.city)}</div>
            </div>
          ))}
        </Section>
      ) : null}

      {certifications.length ? (
        <Section title={t.certifications} style={s}>
          {certifications.map((item) => (
            <div key={item.id} style={s.body}>
              <span style={s.itemTitle}>{item.name}</span>
              <span style={s.meta}>{` ${joined(item.issuer, formatResumeMonth(item.date, lang)) ? `· ${joined(item.issuer, formatResumeMonth(item.date, lang))}` : ""}`}</span>
            </div>
          ))}
        </Section>
      ) : null}

      {skills.length ? (
        <Section title={t.skills} style={s}>
          <p style={s.body}>{skills.join(" · ")}</p>
        </Section>
      ) : null}

      {languages.length ? (
        <Section title={t.languages} style={s}>
          <p style={s.body}>{languages.map((l) => joined(l.name, l.level)).join(" — ")}</p>
        </Section>
      ) : null}
    </article>
  );
}
