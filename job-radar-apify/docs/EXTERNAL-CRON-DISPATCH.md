# Disparar el tick de scraping desde un cron externo gratuito

**Para:** el dueño del repositorio `Yosmanovallos/Job-finder`, que es quien hace estos pasos.
**Por qué:** el cron `*/30` de GitHub solo entrega unas 5 corridas al día. Las razones y las medidas están en [ADR 0010](adr/0010-external-dispatch-cadence.md).
**Costo:** $0. El repositorio es público, Actions no se cobra y el plan gratuito de cron-job.org alcanza.

> ⚠️ **Antes de empezar:** la rama `codex/f-fuentes-monitoring` (con la guarda de ritmo protegido para LinkedIn y Computrabajo) tiene que estar **fusionada en `main`**. Sin esa guarda, cada disparo extra vuelve a pedir detalles a LinkedIn y Computrabajo, que ya responden 429.

## 1. Qué se va a configurar

Dos trabajos en cron-job.org, cada uno con un `POST` a la API de GitHub:

| Trabajo | URL | Horario inicial recomendado |
|---|---|---|
| Tick CO | `https://api.github.com/repos/Yosmanovallos/Job-finder/actions/workflows/scrape-jobs.yml/dispatches` | cada hora en el minuto 05 |
| Tick VE | `https://api.github.com/repos/Yosmanovallos/Job-finder/actions/workflows/scrape-jobs-ve.yml/dispatches` | cada hora en el minuto 35 |

Empezamos **cada hora**, no cada 15 minutos:

- Un tick de CO dura hasta 36 minutos (tick + drenaje).
- Con disparos cada 30 minutos o menos, la mayoría quedarían en espera y serían reemplazados («cancelled» en la UI) sin aportar nada.
- Si la medición del paso 8 sale bien, se puede pasar a cada 30 minutos.

## 2. Crear el token (fine-grained, permisos mínimos)

1. En GitHub, ve a **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Token name:** `cron-job-org-scrape-dispatch`.
3. **Expiration:** 90 días como máximo. Anota la fecha en tu calendario para rotarlo (paso 7).
4. **Resource owner:** tu usuario.
5. **Repository access:** *Only select repositories* → `Yosmanovallos/Job-finder`. **No** elijas «All repositories».
6. **Permissions → Repository permissions:**
   - **Actions:** *Read and write*.
   - **Metadata:** *Read-only*. GitHub lo agrega solo y es obligatorio.
   - Todo lo demás: *No access*. En particular, nada de Contents, Secrets, Workflows ni Administration.
7. **Generate token** y copia el valor **una sola vez**. No lo guardes en el repositorio, ni en `.env`, ni en un chat.

> Qué permite este token, para que lo decidas sabiendo: puede disparar **cualquier** workflow de este repositorio que tenga `workflow_dispatch`, incluidos `scrape-browser-tick.yml` (Indeed y Glassdoor), `indexing-tick.yml` y `social-publish.yml`. También puede cancelar o volver a lanzar corridas. **No** puede leer secretos ni cambiar código. Si cron-job.org sufriera una filtración, el daño posible es ese. Por eso el token vence y se rota.

## 3. Crear la cuenta en cron-job.org

Regístrate en <https://cron-job.org> con tu correo. Es gratis y sin tarjeta.

## 4. Crear el trabajo «Tick CO»

En **Create cronjob**:

1. **Title:** `BuscoTrabajo tick CO`.
2. **URL:** la de la tabla del paso 1.
3. **Execution schedule:** *Custom*, minuto `5`, todas las horas, todos los días. La zona horaria da igual.
4. Abre la pestaña **Advanced**:
   - **Request method:** `POST`.
   - **Headers** (uno por fila):
     - `Accept: application/vnd.github+json`
     - `Authorization: Bearer <EL_TOKEN_DEL_PASO_2>`
     - `X-GitHub-Api-Version: 2022-11-28`
     - `Content-Type: application/json`
   - **Request body:** `{"ref":"main"}`
   - **Timeout:** el valor por defecto sirve, porque GitHub responde en menos de 1 segundo.
   - **Treat redirects as success:** apagado.
5. **Notifications:** activa «notify on failure» para enterarte si el token vence.
6. Guarda el trabajo y usa **Test run**. La respuesta correcta es **`204 No Content`**.
   - `401` o `403`: el token o sus permisos están mal.
   - `404`: la URL o el nombre del workflow están mal, o el token no tiene acceso al repositorio.
   - `422`: el `ref` no existe.

## 5. Crear el trabajo «Tick VE»

Repite el paso 4 con la URL de `scrape-jobs-ve.yml`, minuto `35`.

## 6. Verificar y saber cómo apagarlo

- En GitHub, en **Actions → Job Radar Scraper Tick**, las corridas nuevas aparecen con el evento **`workflow_dispatch`**.
- En el resumen del paso **Run Scraper Tick** busca esta línea:
  `🚦 [Tick] Fuentes de ritmo protegido [LinkedIn, Computrabajo]: fuera de este tick (held_for_schedule)`
  Así deben verse los ticks de `dispatch`. En los de `schedule` debe decir `participan (schedule)`.
- Las corridas **cancelled** de vez en cuando son normales: un disparo que llegó mientras otro estaba en espera lo reemplaza. Lo que no es normal es que se cancele una corrida *en curso*. Eso no puede pasar, porque `cancel-in-progress: false`.
- **Apagar todo:** en cron-job.org pon los dos trabajos en *Disabled*. Así el sistema vuelve exactamente a como estaba. Si además quieres invalidar el token, haz el paso 7.

## 7. Rotar o revocar el token

- **Rotar** (antes de que venza): crea uno nuevo con los mismos ajustes del paso 2, reemplaza el encabezado `Authorization` en los dos trabajos, haz *Test run* y borra el token viejo en GitHub.
- **Revocar** (si sospechas que se filtró): en GitHub, en *Fine-grained tokens*, elige el token y pulsa **Delete**. Desde ese momento los trabajos de cron-job.org devuelven `401`, y GitHub sigue con su `*/30` de siempre.

## 8. Medir a los 7 días

Solo lectura, sin tocar la base de datos:

```bash
gh run list --repo Yosmanovallos/Job-finder --workflow scrape-jobs.yml --limit 400 --json createdAt,event,conclusion > runs.json
```

```bash
node -e "const r=require('./runs.json').filter(x=>x.conclusion!=='cancelled').map(x=>[x.event,new Date(x.createdAt)]).sort((a,b)=>a[1]-b[1]);const since=Date.now()-7*864e5;const w=r.filter(x=>x[1]>=since);const g=w.slice(1).map((x,i)=>(x[1]-w[i][1])/36e5).sort((a,b)=>a-b);const q=p=>g[Math.floor(p*(g.length-1))].toFixed(2);console.log('ticks/dia',(w.length/7).toFixed(1),'por evento',JSON.stringify(w.reduce((m,x)=>(m[x[0]]=(m[x[0]]||0)+1,m),{})),'gap h p50/p90/max',q(.5),q(.9),q(1))"
```

Para los roles pendientes y los 429, cada tick deja una línea `{"event":"tick_health",...}`, y cada drenaje deja una `{"event":"drain_health",...}`:

```bash
gh run view <RUN_ID> --repo Yosmanovallos/Job-finder --log | grep -o '{"event":"\(tick\|drain\)_health".*'
```

**Línea base para comparar** (2026-10-25 → 2026-11-01): 5,2 ticks/día, intervalo p50 de 4,85 h, p90 de 6,76 h y máximo de 7,17 h. Había 35 roles vencidos y se procesaban 8 por tick.

Los criterios de éxito y la consulta SQL equivalente sobre `scrape_runs` están en el ADR 0010.
