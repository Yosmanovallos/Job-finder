# ADR-0002: Postura ante robots.txt en hosts de API (caso SmartRecruiters)

- Estado: aceptada
- Fecha: 2026-07-18

## Contexto

La Posting API de SmartRecruiters está documentada oficialmente como pública y
anónima (spec OpenAPI `security: [{}, key]`, doc en
developers.smartrecruiters.com). Sin embargo, `api.smartrecruiters.com/robots.txt`
declara `User-agent: * / Disallow: /`, con una excepción explícita solo para
LinkedInBot en `/v1/companies/`. El investigador de fuentes lo señaló y pidió
una decisión registrada antes de activar el adaptador (regla 8 de AGENTS.md:
nunca eludir términos de uso; el registro de fuentes del plan §7.3 incluye
`robots_reviewed_at` justamente para esto).

## Decisión

1. `robots.txt` gobierna **crawlers** (descubrimiento y recorrido automático de
   URLs). Un cliente que consume endpoints REST documentados públicamente, con
   User-Agent identificable, a tasa baja y sin descubrir URLs recorriendo el
   host, no es un crawler. La documentación oficial del proveedor invita
   explícitamente a consumir estos endpoints.
2. Aun así, ante la señal contradictoria, el adaptador de SmartRecruiters se
   entrega **deshabilitado por defecto** (`enabled: false` en
   `config/sources.example.yaml`, con nota). Cada usuario lo habilita
   conscientemente en su `config/sources.local.yaml` tras leer
   `docs/source-catalog/smartrecruiters.md` §9.
3. El adaptador opera muy por debajo de los límites documentados de
   SmartAPIs (10 req/s): máximo 30 req/min, backoff con `Retry-After`.
4. Si SmartRecruiters publica términos específicos que prohíban este uso, el
   adaptador se retira.

## Consecuencias

- La verificación técnica (healthcheck/canary acotado) está permitida para
  validar el adaptador; la operación continua queda tras opt-in del usuario.
- Este criterio (API documentada pública > robots genérico, pero opt-in cuando
  haya contradicción) aplica a futuras fuentes con la misma ambigüedad.
