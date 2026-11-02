/**
 * Fixtures for the job page blocks B1-B3 (openspec job-page-differentiation).
 * Synthetic data only: no real employer descriptions or personal data.
 */
import type { SeoJob } from "../../src/lib/job-seo.js";

const PUBLISHED = "2026-10-20T15:00:00.000Z";

/** A Google-ready job board vacancy with a full description and requirements. */
export const boardJob: SeoJob = {
  jobId: "aaaaaaaa-1111-4111-8111-111111111111",
  title: "Analista de Riesgo <Crédito> & Cartera",
  company: "Accenture Colombia",
  location: "Bogotá, D.C.",
  url: "https://example.invalid/oferta/123",
  dateText: "Hace 2 días",
  source: "LinkedIn",
  publishedAt: PUBLISHED,
  country: "CO",
  description:
    "Buscamos analista para el equipo de riesgo.\nConstruirás tableros de cartera & reportes \"mensuales\".\n<script>alert(1)</script> no es HTML: se escapa.",
  requirements: ["Profesional en estadística.", "Dos años con SQL & Power BI."],
  employmentType: "Tiempo completo",
  seoReady: true,
  isActive: true
};

/** An official vacancy read from the employer's own careers portal. */
export const officialJob: SeoJob = {
  ...boardJob,
  jobId: "bbbbbbbb-2222-4222-8222-222222222222",
  title: "Ingeniero de Procesos",
  company: "Alpina",
  location: "Sopó, Cundinamarca",
  url: "https://careers.example.invalid/jobs/987?utm=x",
  source: "Portal oficial",
  description: "Diseñarás mejoras de proceso en planta.\nTurnos rotativos.",
  requirements: ["Ingeniería industrial o química."]
};
