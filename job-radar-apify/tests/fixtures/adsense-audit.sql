-- AdSense auditor (openspec/changes/adsense-readiness, F0): the job pages the
-- rule matrix needs and production-baseline.sql does not have. Applied only by
-- tests/validate-adsense-audit.ts, after the schema blocks, so the figures
-- other suites assert on the shared baseline never change. Every row is
-- explicitly synthetic (example.invalid, «sintética»); no real data.
WITH body AS (
  SELECT 'Vacante sintética del auditor de AdSense. No es una oferta real y no corresponde a ninguna empresa. '
      || 'El texto existe para que la página tenga un cuerpo largo como el de una vacante publicada: describe '
      || 'funciones de análisis, coordinación con otras áreas, elaboración de informes semanales, seguimiento de '
      || 'indicadores, atención de solicitudes internas, documentación de procesos y apoyo a la mejora continua. '
      || 'Se espera manejo de hojas de cálculo, comunicación escrita clara, organización del tiempo y disposición '
      || 'para aprender herramientas nuevas. La jornada, el salario y el tipo de contrato no se publican en esta '
      || 'vacante sintética, por eso la página no los muestra. El auditor solo comprueba la estructura de la '
      || 'página: el marcador de anuncios, el texto en el HTML inicial, los datos estructurados, los enlaces '
      || 'internos y el comportamiento de una vacante vencida. Ninguna persona debe postularse a esta oferta.' AS text
)
INSERT INTO jobs (id, url_hash, title, company, location, country, url, source, sources,
                  published_at, last_seen_at, description, requirements, technologies,
                  detail_status, description_kind, description_source, seo_ready, seo_evaluated_at)
SELECT fixture.id::uuid, md5('adsense-audit-url-' || fixture.id), fixture.title, fixture.company,
       fixture.location, 'CO', 'https://example.invalid/jobs/adsense-audit-' || fixture.slug,
       fixture.source, jsonb_build_array(fixture.source),
       NOW() - fixture.age, NOW() - fixture.age, body.text,
       '["Requisito sintético del auditor", "Manejo de hojas de cálculo"]'::jsonb, '["Excel"]'::jsonb,
       'complete', 'full', 'detail', fixture.ready, NOW()
FROM body, (VALUES
  ('a0000000-0000-4000-8000-000000000001', 'oficial', 'Analista de operaciones sintético oficial',
   'Empresa Sintetica Oficial', 'Medellín, Colombia', 'Portal oficial', INTERVAL '3 days', TRUE),
  ('a0000000-0000-4000-8000-000000000002', 'terceros-1', 'Analista de operaciones sintético terceros uno',
   'Empresa Sintetica Terceros', 'Bogotá, Colombia', 'LinkedIn', INTERVAL '3 days', TRUE),
  ('a0000000-0000-4000-8000-000000000003', 'terceros-2', 'Analista de operaciones sintético terceros dos',
   'Empresa Sintetica Terceros Dos', 'Bogotá, Colombia', 'LinkedIn', INTERVAL '3 days' + INTERVAL '5 minutes', TRUE),
  ('a0000000-0000-4000-8000-000000000004', 'vencida', 'Analista de operaciones sintético vencida',
   'Empresa Sintetica Vencida', 'Bogotá, Colombia', 'LinkedIn', INTERVAL '40 days', FALSE)
) AS fixture(id, slug, title, company, location, source, age, ready);
