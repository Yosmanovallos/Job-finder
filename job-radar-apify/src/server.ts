import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  getJobs,
  getRuns,
  maskLockedFields,
  updateUserName,
  getTransactionsForUser
} from "./db/job-repository.js";
import { markRoleForImmediateRescan } from "./db/scheduler-repository.js";
import { verifySession } from "./auth/verify-session.js";
import { startPaymentCheckout } from "./payments/checkout.js";
import { handleWompiWebhook } from "./payments/webhook.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

// Native Node HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || "GET";

  // 2. Health Check Endpoint
  if (pathname === "/api/health" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
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

  // 5. POST /api/run-scraper (requiere sesión autenticada) — scraping always
  // runs out-of-process now (GitHub Actions tick, see scripts/run-scrape-tick.ts),
  // never inline on the web dyno. This just marks the requested role(s) as
  // due-now so the next scheduled tick (within ~15 min) picks them up.
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
    req.on("end", async () => {
      let keywords: string[] = [];
      try {
        if (bodyText) {
          const parsed = JSON.parse(bodyText);
          if (Array.isArray(parsed.keywords)) {
            keywords = parsed.keywords;
          }
        }
      } catch (e) {}

      if (keywords.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Falta 'keywords' (roles a re-escanear)" }));
        return;
      }

      for (const roleName of keywords) {
        await markRoleForImmediateRescan(roleName);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          message: "Marcado para el próximo ciclo programado (~15 min), no se ejecuta en este proceso."
        })
      );
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
  console.log(
    "ℹ️  El scraping corre fuera de este proceso (GitHub Actions, scripts/run-scrape-tick.ts) — el servidor web nunca scrapea."
  );
});
