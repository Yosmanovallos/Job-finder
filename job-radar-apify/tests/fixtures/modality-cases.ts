import type { JobModality, ModalityInput } from "../../src/lib/job-modality.js";

// Titles and locations as they appear in production (2026-11-02 sample of
// "AI Engineer" CO): before job-modality.ts every one of the remote titles
// below was labelled "Presencial" because only `location` was read.
export const MODALITY_CASES: Array<[ModalityInput, JobModality]> = [
  // Source-stated evidence wins.
  [{ source: "GetOnBoard", remoteType: "fully_remote", title: "Founding AI Engineer", location: "Remoto" }, "remoto"],
  [{ source: "GetOnBoard", remoteType: "hybrid", title: "Senior AI Engineer (Remote)", location: "Bogotá" }, "hibrido"],
  [{ source: "GetOnBoard", remoteType: "onsite", title: "Data Engineer Remote", location: "Bogotá, Colombia" }, "presencial"],
  // Freelance projects: the location is the client's country.
  [{ source: "Workana", title: "Edición de videos para redes sociales", location: "España" }, "freelance"],
  [{ source: "Workana", remoteType: "fully_remote", title: "Community manager", location: "Argentina" }, "freelance"],
  // Remote-only boards.
  [{ source: "RemoteOK", title: "Backend Engineer", location: "Worldwide" }, "remoto"],
  [{ source: "Remotive", title: "Support Specialist", location: "Americas" }, "remoto"],
  // Title evidence.
  [{ source: "LinkedIn", title: "Mobile AI Engineer - Remote Work", location: "Bogotá, Capital District, Colombia" }, "remoto"],
  [{ source: "LinkedIn", title: "AI Automation Engineer (Remote, Cartagena)", location: "Colombia" }, "remoto"],
  [{ source: "LinkedIn", title: "IA Engineer Senior (Remoto)", location: "Colombia" }, "remoto"],
  [{ source: "LinkedIn", title: "Sr. Full-Stack Engineer, AI-Native (LATAM / Europe - Remote)", location: "Colombia" }, "remoto"],
  [{ source: "LinkedIn", title: "Asesor comercial 100% remoto", location: "Colombia" }, "remoto"],
  [{ source: "LinkedIn", title: "Agente de ventas - Teletrabajo", location: "Cali" }, "remoto"],
  [{ source: "LinkedIn", title: "Analista contable - Híbrido", location: "Medellín" }, "hibrido"],
  [{ source: "LinkedIn", title: "Desarrollador Java Híbrido (3 días presencial)", location: "Bogotá" }, "hibrido"],
  [{ source: "LinkedIn", title: "Product Designer – Hybrid/Remote", location: "Bogotá" }, "hibrido"],
  [{ source: "Computrabajo", title: "Auxiliar de bodega presencial", location: "Bogotá, D.C." }, "presencial"],
  [{ source: "LinkedIn", title: "QA Engineer (On-site)", location: "Medellín" }, "presencial"],
  [{ source: "LinkedIn", title: "Soporte técnico (no remoto)", location: "Remoto" }, "presencial"],
  [{ source: "LinkedIn", title: "Asesor de cobranza no presencial", location: "Bogotá" }, "remoto"],
  // Remote as part of the job, not where it is done: falls through.
  [{ source: "LinkedIn", title: "Remote Sensing Analyst", location: "Bogotá" }, "unknown"],
  [{ source: "Computrabajo", title: "Técnico en control remoto de drones", location: "Cali" }, "unknown"],
  [{ source: "LinkedIn", title: "Remote Patient Monitoring Nurse", location: "Colombia" }, "unknown"],
  [{ source: "LinkedIn", title: "Agente de soporte remoto", location: "Remoto" }, "remoto"],
  // Words that merely contain "remot"/"hibrid" are not evidence.
  [{ source: "LinkedIn", title: "Ingeniero de telemetría y remotización", location: "Bogotá" }, "unknown"],
  // Location evidence (the previous rule, kept).
  [{ source: "Torre", title: "Frontend Developer", location: "Remoto" }, "remoto"],
  [{ source: "LinkedIn", title: "Contador", location: "Cali - Híbrido" }, "hibrido"],
  [{ source: "LinkedIn", title: "Backend Developer", location: "Colombia (Remote)" }, "remoto"],
  // No evidence: never "Presencial" by default.
  [{ source: "LinkedIn", title: "Senior AI Engineer", location: "Colombia" }, "unknown"],
  [{ source: "Computrabajo", title: "Auxiliar administrativo", location: "Bogotá, D.C." }, "unknown"],
  [{ source: "LinkedIn", title: "Analista", location: "" }, "unknown"],
  [{ source: "LinkedIn", title: null, location: null }, "unknown"]
];
