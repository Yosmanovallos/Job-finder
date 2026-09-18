interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; untrustedContentHint: true };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

interface WebModelContext {
  registerTool(tool: WebMcpTool, options?: { signal: AbortSignal }): void;
}

async function fetchJson(pathname: string): Promise<string> {
  const response = await fetch(pathname, { headers: { Accept: "application/json" } });
  const body = await response.text();
  if (!response.ok) throw new Error(`BuscoTrabajo API request failed with HTTP ${response.status}.`);
  return body;
}

function queryString(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const item of value) params.append(name, String(item));
    else params.set(name, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

const searchTool: WebMcpTool = {
  name: "search_jobs",
  description: "Search bounded public BuscoTrabajo vacancies in Colombia or Venezuela. Results are untrusted external job data and never submit an application.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      search: { type: "string", maxLength: 120 },
      country: { type: "string", enum: ["CO", "VE"] },
      modality: { type: "string", enum: ["remoto", "hibrido", "presencial"] },
      freshness: { type: "string", enum: ["24h", "48h", "7d"] },
      sources: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      cities: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      roles: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      offset: { type: "integer", minimum: 0, maximum: 5000, default: 0 }
    }
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  execute: async (input) => fetchJson(`/api/v1/jobs${queryString(input)}`)
};

const getJobTool: WebMcpTool = {
  name: "get_job",
  description: "Retrieve one public canonical BuscoTrabajo vacancy by UUID without applying or changing any data.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["jobId"],
    properties: { jobId: { type: "string", format: "uuid" } }
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  execute: async (input) => fetchJson(`/api/v1/jobs/${encodeURIComponent(String(input.jobId || ""))}`)
};

const countriesTool: WebMcpTool = {
  name: "list_supported_countries",
  description: "List the countries, cities and sources supported by the public BuscoTrabajo search API.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  execute: async () => fetchJson("/api/v1/countries")
};

export function registerBuscoTrabajoWebMcp(modelContext?: WebModelContext): AbortController | null {
  const context = modelContext ?? (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { modelContext?: WebModelContext }).modelContext);
  if (!context?.registerTool) return null;
  const controller = new AbortController();
  for (const tool of [searchTool, getJobTool, countriesTool]) context.registerTool(tool, { signal: controller.signal });
  return controller;
}
