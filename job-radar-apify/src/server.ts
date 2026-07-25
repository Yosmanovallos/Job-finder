import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import dotenv from "dotenv";
import {
  getJobs,
  getRuns,
  maskLockedFields,
  updateUserName,
  getTransactionsForUser
} from "./db/job-repository.js";
import { globalScheduler } from "./queue/scheduler.js";
import { verifySession } from "./auth/verify-session.js";
import { startPaymentCheckout } from "./payments/checkout.js";
import { handleWompiWebhook } from "./payments/webhook.js";
import { startCronScheduler } from "./queue/cron.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

// Active SSE client connections
const sseClients = new Set<http.ServerResponse>();

function broadcastLog(message: string, level: "info" | "success" | "warning" | "error" = "info") {
  const data = JSON.stringify({ type: "log", message, level });
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

function triggerScraperSubprocess(customKeywords?: string[], customDateRange: string = "48h") {
  const keywordsToUse =
    customKeywords && customKeywords.length > 0
      ? customKeywords
      : [
          "Project Manager",
          "Data Analyst",
          "Data Engineer",
          "RPA Developer",
          "QA Engineer",
          "AI Engineer"
        ];

  broadcastLog(
    `Encolando escaneo escalonado (Filtro Fecha: ${customDateRange}) para los roles: [${keywordsToUse.join(", ")}]`,
    "info"
  );

  // Enqueue via globalScheduler (allows concurrent requests without blocking)
  globalScheduler.enqueueRoles(keywordsToUse);

  // Also spawn background subprocess for Notion sync compatibility if configured
  const indexPath = path.join(__dirname, "index.ts");
  const keywordsEnv = keywordsToUse.join(",");

  const proc = spawn("npx", ["tsx", indexPath], {
    cwd: path.join(__dirname, ".."),
    shell: true,
    env: {
      ...process.env,
      PATH: process.env.PATH,
      SEARCH_KEYWORDS: keywordsEnv,
      DATE_RANGE: customDateRange
    }
  });

  proc.stdout.on("data", (data) => {
    const lines = data
      .toString()
      .split("\n")
      .filter((l: string) => l.trim());
    lines.forEach((line: string) => broadcastLog(line, "info"));
  });

  proc.stderr.on("data", (data) => {
    const lines = data
      .toString()
      .split("\n")
      .filter((l: string) => l.trim());
    lines.forEach((line: string) => broadcastLog(`[Stderr] ${line}`, "warning"));
  });

  proc.on("close", (code) => {
    broadcastLog(
      `¡Proceso de escaneo finalizado! (Código: ${code})`,
      code === 0 ? "success" : "error"
    );
  });
}

// Native Node HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || "GET";

  // 1. SSE Real-time Logs Endpoint
  if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(":\n\n"); // connection keepalive
    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. Health Check Endpoint
  if (pathname === "/api/health" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        scheduler: globalScheduler.getStatus()
      })
    );
    return;
  }

  // 3. GET /api/runs
  if (pathname === "/api/runs" && method === "GET") {
    const runs = await getRuns();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ runs, count: runs.length }));
    return;
  }

  // 4. GET /api/jobs — tier is always resolved server-side from a verified
  //    session; free/anonymous callers get the 48h freshness paywall masking.
  if (pathname === "/api/jobs" && method === "GET") {
    const session = await verifySession(req);
    const tier = session?.tier || "free";
    const jobs = await getJobs();
    const visibleJobs = maskLockedFields(jobs, tier);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobs: visibleJobs, count: visibleJobs.length }));
    return;
  }

  // 4b. GET /api/me — returns the caller's verified profile/tier (never trusts the client)
  if (pathname === "/api/me" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: session.id,
        email: session.email,
        name: session.name,
        tier: session.tier,
        subscriptionEnd: session.subscriptionEnd
      })
    );
    return;
  }

  // 4c. PATCH /api/me — lets a user edit their own display name. The id
  // updated is always the one verifySession resolved from the JWT, never
  // anything from the request body.
  if (pathname === "/api/me" && method === "PATCH") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(bodyText || "{}");
        const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 255) : "";
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "El nombre no puede estar vacío" }));
          return;
        }

        const updated = await updateUserName(session.id, name);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: updated.id,
            email: updated.email,
            name: updated.name,
            tier: updated.subscriptionTier,
            subscriptionEnd: updated.subscriptionEnd
          })
        );
      } catch (e: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e?.message || "Solicitud inválida" }));
      }
    });
    return;
  }

  // 4d. GET /api/transactions — payment history for the caller's own Account
  // page, scoped to their verified id (never a client-supplied one).
  if (pathname === "/api/transactions" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    const transactions = await getTransactionsForUser(session.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ transactions }));
    return;
  }

  // 5. POST /api/run-scraper (requiere sesión autenticada)
  if (pathname === "/api/run-scraper" && method === "POST") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", () => {
      let keywords: string[] | undefined;
      let dateRange = "48h";
      try {
        if (bodyText) {
          const parsed = JSON.parse(bodyText);
          if (Array.isArray(parsed.keywords)) {
            keywords = parsed.keywords;
          }
          if (parsed.dateRange) {
            dateRange = parsed.dateRange;
          }
        }
      } catch (e) {}

      triggerScraperSubprocess(keywords, dateRange);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", message: "Escaneo encolado y en ejecución" }));
    });
    return;
  }

  // 6. POST /api/checkout/start (requiere sesión autenticada) — inicia un
  //    Wompi Web Checkout real (sandbox) para el plan Pro mensual.
  if (pathname === "/api/checkout/start" && method === "POST") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }

    try {
      const checkout = await startPaymentCheckout({ userId: session.id, userEmail: session.email });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(checkout));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e?.message || "No se pudo iniciar el checkout" }));
    }
    return;
  }

  // 7. POST /api/webhooks/wompi — endpoint público, la confianza viene de la
  //    verificación de firma (nunca del payload por sí solo).
  if (pathname === "/api/webhooks/wompi" && method === "POST") {
    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(bodyText);
        const result = await handleWompiWebhook(payload);
        if (!result.verified) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Firma inválida" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e?.message || "Payload inválido" }));
      }
    });
    return;
  }

  // 6. Static Files (HTML, CSS, JS) + SPA fallback. Any path without a file
  // extension is a client-side route (/dashboard, /pricing, /legal/terminos,
  // etc.) — those must serve index.html so React Router can mount and take
  // over, otherwise a refresh or direct link on any non-"/" route 404s.
  const hasFileExtension = path.extname(pathname) !== "";
  let filePath = path.join(PUBLIC_DIR, hasFileExtension ? pathname : "index.html");

  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };

  const contentType = mimeTypes[ext] || "text/plain";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 Not Found</h1>");
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 JOB RADAR DASHBOARD RUNNING AT: http://localhost:${PORT}`);
  console.log(`==================================================\n`);

  // Opt-in on purpose: arrancar el servidor (ej. para inspeccionar algo)
  // nunca debe disparar scraping real por sí solo. En producción, activa
  // ENABLE_CRON=true una vez y el cron queda corriendo permanentemente.
  if (process.env.ENABLE_CRON === "true") {
    startCronScheduler().catch((err) => {
      console.error("❌ [Cron] No se pudo iniciar el scheduler:", err?.message || err);
    });
  } else {
    console.log(
      '⏸️  [Cron] Desactivado (ENABLE_CRON no está en "true"). El servidor no va a scrapear nada por su cuenta.'
    );
  }
});
