document.addEventListener('DOMContentLoaded', () => {
  let allJobs = [];
  let filteredJobs = [];
  let activeRunId = 'all';
  let viewMode = 'table'; // 'table' or 'grid'

  // DOM Elements
  const jobsContainer = document.getElementById('jobsContainer');
  const jobsCountBadge = document.getElementById('jobsCountBadge');
  const lastSyncText = document.getElementById('lastSyncText');
  const searchInput = document.getElementById('searchInput');
  const customKeywordsInput = document.getElementById('customKeywordsInput');
  const sourceFilter = document.getElementById('sourceFilter');
  const modalityFilter = document.getElementById('modalityFilter');
  const refreshBtn = document.getElementById('refreshBtn');
  const runScraperBtn = document.getElementById('runScraperBtn');
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const terminalConsole = document.getElementById('terminalConsole');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const toggleTerminalBtn = document.getElementById('toggleTerminalBtn');
  const terminalSection = document.getElementById('terminalSection');
  const notionRunsTabs = document.getElementById('notionRunsTabs');
  const viewTableBtn = document.getElementById('viewTableBtn');
  const viewGridBtn = document.getElementById('viewGridBtn');

  // Metrics Elements
  const metricTotal = document.getElementById('metricTotal');
  const metricData = document.getElementById('metricData');
  const metricTech = document.getElementById('metricTech');
  const metricSources = document.getElementById('metricSources');

  // Preset chips click handlers
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const kw = chip.getAttribute('data-keyword');
      let currentVal = customKeywordsInput.value.trim();
      const currentList = currentVal ? currentVal.split(',').map(s => s.trim()) : [];
      
      if (!currentList.includes(kw)) {
        currentList.push(kw);
        customKeywordsInput.value = currentList.join(', ');
      }
    });
  });

  // View switch handlers
  viewTableBtn.addEventListener('click', () => {
    viewMode = 'table';
    viewTableBtn.classList.add('active');
    viewGridBtn.classList.remove('active');
    renderJobs(filteredJobs);
  });

  viewGridBtn.addEventListener('click', () => {
    viewMode = 'grid';
    viewGridBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
    renderJobs(filteredJobs);
  });

  // Initialize SSE for live logs
  initSse();

  // Load Notion runs & jobs on launch
  fetchRunsAndJobs();

  // Event Listeners
  searchInput.addEventListener('input', applyFilters);
  sourceFilter.addEventListener('change', applyFilters);
  modalityFilter.addEventListener('change', applyFilters);
  refreshBtn.addEventListener('click', () => fetchRunsAndJobs());
  runScraperBtn.addEventListener('click', triggerScraper);

  clearLogsBtn.addEventListener('click', () => {
    terminalConsole.innerHTML = '<div class="log-line info">[Sistema] Consola limpiada.</div>';
  });

  toggleTerminalBtn.addEventListener('click', () => {
    terminalSection.classList.toggle('collapsed');
    toggleTerminalBtn.textContent = terminalSection.classList.contains('collapsed') ? 'Expandir' : 'Minimizar';
  });

  // Fetch Notion Runs & Jobs
  async function fetchRunsAndJobs() {
    await fetchRuns();
    await fetchJobs(activeRunId);
  }

  // Fetch available Notion Run Databases
  async function fetchRuns() {
    try {
      const res = await fetch('/api/runs');
      if (!res.ok) return;
      const data = await res.json();
      const runs = data.runs || [];

      notionRunsTabs.innerHTML = `<button class="run-tab ${activeRunId === 'all' ? 'active' : ''}" data-run-id="all">✨ Todas las Corridas</button>`;

      runs.forEach(run => {
        const btn = document.createElement('button');
        btn.className = `run-tab ${activeRunId === run.id ? 'active' : ''}`;
        btn.setAttribute('data-run-id', run.id);
        btn.textContent = run.name;
        btn.addEventListener('click', () => {
          document.querySelectorAll('.run-tab').forEach(t => t.classList.remove('active'));
          btn.classList.add('active');
          activeRunId = run.id;
          fetchJobs(activeRunId);
        });
        notionRunsTabs.appendChild(btn);
      });

      // Default all button handler
      const allTab = notionRunsTabs.querySelector('[data-run-id="all"]');
      if (allTab) {
        allTab.addEventListener('click', () => {
          document.querySelectorAll('.run-tab').forEach(t => t.classList.remove('active'));
          allTab.classList.add('active');
          activeRunId = 'all';
          fetchJobs('all');
        });
      }
    } catch (e) {
      console.warn('Error fetching runs:', e);
    }
  }

  // Fetch Jobs from Backend (/api/jobs?runId=...)
  async function fetchJobs(runId = 'all') {
    jobsContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Cargando vacantes desde Notion...</p>
      </div>`;
    lastSyncText.textContent = 'Actualizando datos...';

    try {
      const url = runId && runId !== 'all' ? `/api/jobs?runId=${encodeURIComponent(runId)}` : '/api/jobs';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Error al obtener datos');
      
      const data = await response.json();
      allJobs = data.jobs || [];

      updateMetrics();
      applyFilters();

      const nowStr = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      lastSyncText.textContent = `Última sincronización: Hoy ${nowStr}`;
      logConsole(`[Notion] Sincronización exitosa. ${allJobs.length} vacantes cargadas desde Notion.`, 'success');
    } catch (error) {
      console.error(error);
      jobsContainer.innerHTML = `
        <div class="empty-state">
          <p>⚠️ No se pudieron cargar las vacantes desde Notion.</p>
          <button class="btn btn-secondary" onclick="fetchRunsAndJobs()" style="margin-top:12px">Reintentar</button>
        </div>`;
      lastSyncText.textContent = 'Error de conexión';
      logConsole(`[Error] Falló la conexión con la API de Notion.`, 'error');
    }
  }

  // Calculate & Update Top Metrics
  function updateMetrics() {
    metricTotal.textContent = allJobs.length;

    const dataCount = allJobs.filter(j => isManagementOrData(j.title)).length;
    const techCount = allJobs.filter(j => isAutomationOrDev(j.title)).length;
    const sourcesSet = new Set(allJobs.map(j => j.source).filter(Boolean));

    metricData.textContent = dataCount;
    metricTech.textContent = techCount;
    metricSources.textContent = sourcesSet.size || 6;
  }

  function isManagementOrData(title) {
    const t = (title || '').toLowerCase();
    return t.includes('project manager') || t.includes('data') || t.includes('analyst') || 
           t.includes('engineer') || t.includes('scrum') || t.includes('product') || t.includes('lider');
  }

  function isAutomationOrDev(title) {
    const t = (title || '').toLowerCase();
    return t.includes('rpa') || t.includes('qa') || t.includes('automation') || 
           t.includes('developer') || t.includes('desarrollador') || t.includes('ai') || t.includes('ia');
  }

  // Filter Logic
  function applyFilters() {
    const searchVal = searchInput.value.toLowerCase().trim();
    const sourceVal = sourceFilter.value;
    const modalityVal = modalityFilter.value;

    filteredJobs = allJobs.filter(job => {
      // Search text match
      const textMatch = !searchVal || 
        (job.title && job.title.toLowerCase().includes(searchVal)) ||
        (job.company && job.company.toLowerCase().includes(searchVal)) ||
        (job.location && job.location.toLowerCase().includes(searchVal));

      // Source match
      const sourceMatch = sourceVal === 'all' || job.source === sourceVal;

      // Modality match
      let modalityMatch = true;
      if (modalityVal !== 'all') {
        const mod = (job.modality || '').toLowerCase();
        modalityMatch = mod.includes(modalityVal.toLowerCase());
      }

      return textMatch && sourceMatch && modalityMatch;
    });

    renderJobs(filteredJobs);
  }

  // Render Jobs View (Table or Grid Cards)
  function renderJobs(jobs) {
    jobsCountBadge.textContent = jobs.length;

    if (jobs.length === 0) {
      jobsContainer.innerHTML = `
        <div class="empty-state">
          <p>🔍 No se encontraron vacantes con los filtros seleccionados.</p>
        </div>`;
      return;
    }

    if (viewMode === 'table') {
      renderTableView(jobs);
    } else {
      renderGridView(jobs);
    }
  }

  // Notion-Style Table Renderer
  function renderTableView(jobs) {
    const tableHtml = `
      <div class="notion-table-wrapper">
        <table class="notion-table">
          <thead>
            <tr>
              <th>📌 Nombre / Puesto</th>
              <th>🏢 Empresa</th>
              <th>📍 Ubicación</th>
              <th>💻 Modalidad</th>
              <th>🌐 Fuente</th>
              <th>📅 Publicado</th>
              <th>🎯 Corrida Notion</th>
              <th>⚡ Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.map(job => {
              const sourceClass = `source-${(job.source || 'default').toLowerCase()}`;
              const modalityClass = (job.modality || '').toLowerCase().includes('remot') ? 'remote' : 
                                   (job.modality || '').toLowerCase().includes('hibrid') ? 'hybrid' : '';

              return `
                <tr>
                  <td>
                    <div class="notion-job-title">
                      <span>📄</span>
                      <a href="${job.url || '#'}" target="_blank" rel="noopener">${escapeHtml(job.title)}</a>
                    </div>
                  </td>
                  <td><strong>${escapeHtml(job.company || 'Confidencial')}</strong></td>
                  <td>${escapeHtml(job.location || 'Colombia')}</td>
                  <td><span class="meta-pill ${modalityClass}">${escapeHtml(job.modality || 'Remoto')}</span></td>
                  <td><span class="job-source-tag ${sourceClass}">${job.source || 'Empleo'}</span></td>
                  <td><small>${job.publishedAt || 'Reciente'}</small></td>
                  <td><span class="notion-run-badge">${escapeHtml(job.runName || 'Corrida General')}</span></td>
                  <td>
                    ${job.url ? `<a href="${job.url}" target="_blank" rel="noopener" class="btn-apply" style="padding:4px 10px; font-size:0.75rem;">Aplicar ↗</a>` : '-'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    jobsContainer.innerHTML = tableHtml;
  }

  // Job Cards Grid Renderer
  function renderGridView(jobs) {
    const gridHtml = `
      <div class="jobs-grid">
        ${jobs.map(job => {
          const sourceClass = `source-${(job.source || 'default').toLowerCase()}`;
          const modalityClass = (job.modality || '').toLowerCase().includes('remot') ? 'remote' : 
                               (job.modality || '').toLowerCase().includes('hibrid') ? 'hybrid' : '';

          return `
            <div class="job-card">
              <div class="job-card-top">
                <span class="job-source-tag ${sourceClass}">${job.source || 'Empleo'}</span>
                <h3 class="job-title">${escapeHtml(job.title)}</h3>
                <div class="job-company">
                  <span>🏢 ${escapeHtml(job.company || 'Empresa Confidencial')}</span>
                </div>
                
                <div class="job-meta-pills">
                  <span class="meta-pill">📍 ${escapeHtml(job.location || 'Colombia')}</span>
                  ${job.modality ? `<span class="meta-pill ${modalityClass}">💻 ${escapeHtml(job.modality)}</span>` : ''}
                </div>
              </div>

              <div class="job-card-bottom">
                <span class="published-date">📅 ${job.publishedAt || 'Reciente'}</span>
                ${job.url ? `<a href="${job.url}" target="_blank" rel="noopener" class="btn-apply">Aplicar ↗</a>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    jobsContainer.innerHTML = gridHtml;
  }

  // Trigger Scraper Execution (/api/run-scraper) with Custom Keywords
  async function triggerScraper() {
    if (statusPill.classList.contains('running')) return;

    const rawKeywords = customKeywordsInput.value.trim();
    if (!rawKeywords) {
      alert('Por favor escribe al menos un rol o palabra clave para buscar.');
      return;
    }

    const keywordsArray = rawKeywords.split(',').map(s => s.trim()).filter(Boolean);
    const dateRangeVal = document.getElementById('dateRangeSelect')?.value || '48h';

    setStatusRunning();
    logConsole(`[Scraper] Pipeline iniciado en segundo plano (Filtro: ${dateRangeVal}) para roles: [${keywordsArray.join(', ')}]. Observa la consola...`, 'warning');

    try {
      const response = await fetch('/api/run-scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: keywordsArray,
          dateRange: dateRangeVal
        })
      });

      if (!response.ok) {
        throw new Error('No se pudo iniciar el scraper.');
      }
    } catch (error) {
      console.error(error);
      setStatusIdle();
      logConsole(`[Error] ${error.message}`, 'error');
    }
  }

  function setStatusRunning() {
    statusPill.className = 'status-pill running';
    statusText.textContent = 'Scraper Ejecutándose...';
    runScraperBtn.disabled = true;
  }

  function setStatusIdle() {
    statusPill.className = 'status-pill idle';
    statusText.textContent = 'Sistema Listo';
    runScraperBtn.disabled = false;
  }

  function initSse() {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          logConsole(data.message, data.level);

          if (data.message.includes('Iniciando escaneo')) {
            setStatusRunning();
          }
          if (data.message.includes('finalizado') || data.message.includes('salida 0')) {
            setStatusIdle();
            setTimeout(() => {
              fetchRunsAndJobs();
            }, 1500);
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    eventSource.onerror = () => {
      console.warn('SSE Disconnected. Reconnecting...');
    };
  }

  function logConsole(msg, level = 'info') {
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    const time = new Date().toLocaleTimeString('es-CO');
    line.textContent = `[${time}] ${msg}`;
    terminalConsole.appendChild(line);
    terminalConsole.scrollTop = terminalConsole.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
