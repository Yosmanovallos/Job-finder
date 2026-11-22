import type http from "node:http";
import { applicationCreateSchema, applicationUpdateSchema } from "../../lib/resume-applications.js";
import {
  ApplicationLimitError,
  ApplicationReferenceError,
  deleteApplication,
  getApplication,
  listApplications,
  saveApplication,
  updateApplication
} from "../../db/resume-studio-application-repository.js";

// AI Resume Studio R4b — /api/resume/applications («Mis postulaciones»).
// Loaded lazily from resume.ts, which already resolved the session and the
// rate limit. FREE for everyone: no pass or quota check anywhere here.
// Reads need nothing beyond the session (holder's right); writes need the
// two required authorizations AND «guardar en mi cuenta», because the
// consent text promises nothing stays on the server without it.
// Nothing here applies, emails or contacts an employer (AGENTS.md rule 7).

type Json = (res: http.ServerResponse, status: number, body?: unknown, extra?: Record<string, string>) => void;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Field paths only — never the submitted values. */
function issuesOf(error: { issues: { path: (string | number)[]; message: string }[] }): { path: string; message: string }[] {
  return error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

export async function handleResumeApplications(
  res: http.ServerResponse,
  route: string,
  method: string,
  userId: string,
  readBody: () => Promise<{ ok: true; value: unknown } | null>,
  requireStorageConsent: () => Promise<boolean>,
  json: Json
): Promise<void> {
  const parts = route.split("/").filter(Boolean);
  const id = parts[1];
  const notFound = () => json(res, 404, { error: "Postulación no encontrada" });
  if (parts.length > 2 || (id !== undefined && !UUID.test(id))) return notFound();

  try {
    if (id === undefined) {
      if (method === "GET") return json(res, 200, { applications: await listApplications(userId) });
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      const body = await readBody();
      if (!body) return;
      const parsed = applicationCreateSchema.safeParse(body.value);
      if (!parsed.success) return json(res, 400, { error: "Revisa los datos de la postulación.", issues: issuesOf(parsed.error) });
      if (!(await requireStorageConsent())) return;
      const { application, created } = await saveApplication(userId, parsed.data);
      return json(res, created ? 201 : 200, { application, created });
    }

    if (method === "GET") {
      const application = await getApplication(userId, id);
      return application ? json(res, 200, { application }) : notFound();
    }
    if (method === "DELETE") {
      return (await deleteApplication(userId, id)) ? json(res, 204) : notFound();
    }
    if (method !== "PATCH") return json(res, 405, { error: "Método no permitido" });
    const body = await readBody();
    if (!body) return;
    const parsed = applicationUpdateSchema.safeParse(body.value);
    if (!parsed.success) return json(res, 400, { error: "Revisa los datos de la postulación.", issues: issuesOf(parsed.error) });
    if (!(await requireStorageConsent())) return;
    const application = await updateApplication(userId, id, parsed.data);
    return application ? json(res, 200, { application }) : notFound();
  } catch (error) {
    if (error instanceof ApplicationLimitError) {
      return json(res, 409, { error: "Llegaste al máximo de postulaciones guardadas. Borra las que ya no necesites.", code: "limit" });
    }
    // Same answer as a missing row: never confirm someone else's id exists.
    if (error instanceof ApplicationReferenceError) return json(res, 404, { error: "Adaptación u hoja de vida no encontrada", code: "reference_not_found" });
    throw error;
  }
}
