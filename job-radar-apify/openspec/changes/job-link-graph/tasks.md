# Tareas

- [x] Medir Search Console y muestra de sitemap antes de tocar código.
- [x] `StaleWhileRevalidateCache.peek` + `peekJobsPage` (misma clave que el hub).
- [x] `job-internal-links.ts`: hub de ciudad, hermanas rotadas, breadcrumb, HTML escapado.
- [x] SSR de vacante y `JobLanding.tsx` con los mismos enlaces.
- [x] Pruebas unitarias, integración HTTP (`test:job-seo` 14b) y baseline visual.
- [ ] Desplegar con aprobación y repetir la muestra de 12 URLs en producción.
- [ ] Checkpoints 2026-11-12 y 2026-11-26 en Search Console.

> **Nota 2026-11-07 (`seo-intent-wave2`, sin desplegar):** cuando se despliegue,
> los hubs de CO ganan hasta 3 enlaces aditivos a páginas de intención
> indexables. Las vacantes con «Ciudad Guayana» en la ubicación pueden listar
> vacantes de Puerto Ordaz entre sus relacionadas; sus migas no cambian.
> Tenerlo en cuenta en los checkpoints del 2026-11-12 y el 2026-11-26.
