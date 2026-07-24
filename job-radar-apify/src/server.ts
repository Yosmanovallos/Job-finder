import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { getJobs, getRuns } from './db/job-repository.js';
import { globalScheduler } from './queue/scheduler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Active SSE client connections
const sseClients = new Set<http.ServerResponse>();

function broadcastLog(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') {
  const data = JSON.stringify({ type: 'log', message, level });
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

function triggerScraperSubprocess(customKeywords?: string[], customDateRange: string = '48h') {
  const keywordsToUse = (customKeywords && customKeywords.length > 0)
    ? customKeywords
    : ["Project Manager", "Data Analyst", "Data Engineer", "RPA Developer", "QA Engineer", "AI Engineer"];

  broadcastLog(`Encolando escaneo escalonado (Filtro Fecha: ${customDateRange}) para los roles: [${keywordsToUse.join(', ')}]`, 'info');

  // Enqueue via globalScheduler (allows concurrent requests without blocking)
  globalScheduler.enqueueRoles(keywordsToUse);

  // Also spawn background subprocess for Notion sync compatibility if configured
  const indexPath = path.join(__dirname, 'index.ts');
  const keywordsEnv = keywordsToUse.join(',');

  const proc = spawn('npx', ['tsx', indexPath], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    env: {
      ...process.env,
      PATH: process.env.PATH,
      SEARCH_KEYWORDS: keywordsEnv,
      DATE_RANGE: customDateRange
    }
  });

  proc.stdout.on('data', data => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => broadcastLog(line, 'info'));
  });

  proc.stderr.on('data', data => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => broadcastLog(`[Stderr] ${line}`, 'warning'));
  });

  proc.on('close', code => {
    broadcastLog(`¡Proceso de escaneo finalizado! (Código: ${code})`, code === 0 ? 'success' : 'error');
  });
}

// Native Node HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || 'GET';

  // 1. SSE Real-time Logs Endpoint
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':\n\n'); // connection keepalive
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. Health Check Endpoint
  if (pathname === '/api/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      scheduler: globalScheduler.getStatus()
    }));
    return;
  }

  // 3. GET /api/runs
  if (pathname === '/api/runs' && method === 'GET') {
    const runs = await getRuns();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runs, count: runs.length }));
    return;
  }

  // 4. GET /api/jobs
  if (pathname === '/api/jobs' && method === 'GET') {
    const jobs = await getJobs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobs, count: jobs.length }));
    return;
  }

  // 5. POST /api/run-scraper
  if (pathname === '/api/run-scraper' && method === 'POST') {
    let bodyText = '';
    req.on('data', chunk => { bodyText += chunk.toString(); });
    req.on('end', () => {
      let keywords: string[] | undefined;
      let dateRange = '48h';
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Escaneo encolado y en ejecución' }));
    });
    return;
  }

  // 6. Static Files (HTML, CSS, JS)
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 JOB RADAR DASHBOARD RUNNING AT: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
