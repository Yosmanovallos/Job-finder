/**
 * Fixtures for the job page <title> and meta description (F5,
 * docs/GOOGLE-JOBS-INDEXING-PLAN-2026-11.md). Synthetic data only.
 */
import type { SeoJob } from "../../src/lib/job-seo.js";
import { boardJob, officialJob } from "./job-page-blocks.js";

export { boardJob, officialJob };

/** Full vacancy: city, company, employment type, a description that opens with headers. */
export const fullJob: SeoJob = {
  ...boardJob,
  jobId: "cccccccc-3333-4333-8333-333333333333",
  title: "Oracle DBA",
  company: "Amaris Consulting",
  location: "Bogota, D.C., Capital District, Colombia",
  description:
    "Job Description\nDescripción del puesto\nÚnete a Amaris Consulting como Administrador de Bases de Datos Oracle dentro de un programa de modernización tecnológica. Trabajarás con Azure.\nRequisitos:",
  employmentType: "Tiempo completo"
};

export const noCityJob: SeoJob = { ...fullJob, jobId: "dddddddd-4444-4444-8444-444444444444", location: "" };

export const confidentialJob: SeoJob = { ...fullJob, jobId: "eeeeeeee-5555-4555-8555-555555555555", company: "Confidencial" };

export const noCompanyJob: SeoJob = { ...fullJob, jobId: "ffffffff-6666-4666-8666-666666666666", company: "" };

export const longTitleJob: SeoJob = {
  ...fullJob,
  jobId: "abababab-7777-4777-8777-777777777777",
  title: "Especialista Senior en Gestión de Riesgos Operativos y Cumplimiento Regulatorio SARLAFT"
};

/** Title repeated at the start, emojis, literal markup, abbreviations and `$` patterns. */
export const messyJob: SeoJob = {
  ...fullJob,
  jobId: "cdcdcdcd-8888-4888-8888-888888888888",
  title: "🎯Asesor(a) Comercial - Medellín📉",
  company: "Banco Ejemplo",
  location: "Medellín",
  employmentType: undefined,
  description:
    "🎯Asesor(a) Comercial - Medellín📉🚀 <b>¡Convierte</b> cada interacción en una oportunidad $& de negocio $` con el Sr. Gómez!❤️ Salario $$1.300.000 más comisiones.\nOtra línea."
};

/** 100% remote with a source country: no physical city to put in the title. */
export const remoteJob: SeoJob = {
  ...fullJob,
  jobId: "efefefef-9999-4999-8999-999999999999",
  location: "Bogotá",
  remoteType: "fully_remote",
  applicantCountries: ["CO"]
};

/** No description at all: the meta keeps only the facts. */
export const bareJob: SeoJob = { ...fullJob, jobId: "fafafafa-0000-4000-8000-000000000000", description: "", employmentType: undefined };

export const META_FIXTURES: SeoJob[] = [
  boardJob,
  officialJob,
  fullJob,
  noCityJob,
  confidentialJob,
  noCompanyJob,
  longTitleJob,
  messyJob,
  remoteJob,
  bareJob
];
