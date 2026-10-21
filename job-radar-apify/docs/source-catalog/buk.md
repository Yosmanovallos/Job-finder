# Buk ({x}.buk.co/trabaja-con-nosotros) - investigacion para conector D5

Investigacion `source-researcher` del 2026-10-20 para `docs/adr/0006-direct-employers.md` §5/§7 (D5).
Leyenda: **[DOC]** documentado oficialmente; **[OBS]** observado, no garantizado; **[NV]** no verificado.
UA: `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`. Fixture real: `fixtures-buk/robots-lapipolnequi.buk.co.txt`.

## Veredicto

**DIFERIDO - bloqueado por robots.txt.** El `robots.txt` del tenant prohibe todo a los crawlers genericos y solo
da Allow a Twitterbot y LinkedInBot. BuscoTrabajoBot cae en `User-agent: *` -> `Disallow: /` incluida
`/trabaja-con-nosotros`. No se investigo ni se contaron vacantes (no hay datos de Nequi ni de otras empresas).
Hacerse pasar por un bot permitido seria evasion y no se propone. Salidas legitimas: pedir permiso a Buk o a la
empresa (p. ej. Nequi), o revisar mas adelante si Luk (portal de empleo de Buk) ofrece una vista publica [NV].

## 1. robots.txt (literal) [OBS]
`https://lapipolnequi.buk.co/robots.txt` (HTTP 200):
```
# See https://www.robotstxt.org/robotstxt.html for documentation on how to use the robots.txt file

User-agent: Twitterbot
Disallow: *
Allow: /seleccions/*/postular
Allow: /seleccions/*/public_url_preview
Allow: /s/*
Allow: /trabaja-con-nosotros
Allow: /carreiras
Allow: /careers

User-agent: LinkedInBot
Disallow: *
Allow: /seleccions/*/postular
Allow: /seleccions/*/public_url_preview
Allow: /s/*
Allow: /trabaja-con-nosotros
Allow: /carreiras
Allow: /careers

User-agent: *
Disallow: /
```
Analisis RFC 9309: el product token `BuscoTrabajoBot` no coincide con los grupos nombrados; aplica `*` con
`Disallow: /`; la ruta `/trabaja-con-nosotros` queda prohibida. Solo se leyo este tenant; que todos los
tenants Buk usen el mismo robots es [NV] (probable, es la plantilla de la plataforma).
`https://www.buk.co/robots.txt` (sitio de marketing HubSpot) no bloquea nada relevante, pero es otro producto.

## 2. Endpoint o feed publico
No se encontro documentacion oficial de API o feed publico de vacantes de Buk para terceros [NV]. La busqueda
de documentacion solo mostro: API de integracion para clientes en el plan Pro (con autenticacion), el modulo
de Seleccion con portal "trabaja con nosotros" y Luk (portal de empleo de Buk, "4.000+ ofertas en cinco
paises" segun prensa; los dominios `luk.co`, `www.luk.co`, `luk.buk.co`, `www.luk.cl` no resolvieron [NV]).
Sin acceso permitido por robots, no se evaluaron paginacion, campos, fechas ni cierre: **no hay evidencia**.

## 3. Campos / cierre / rate limits
No investigados (bloqueo por robots). Todo [NV]. Las rutas que el robots permite a LinkedInBot sugieren
`/seleccions/{id}/public_url_preview` y `/s/*` como paginas por vacante, y `/trabaja-con-nosotros` como listado
(en el fixture, solo texto de robots); no se verifico nada de eso.

## 4. Canarios
Ninguno: Nequi (`lapipolnequi.buk.co`, hallado por el site probe de D3) y cualquier otra empresa Buk quedan
sin conteo. Si Buk o Nequi autorizan, el primer canario seria `lapipolnequi`.

## 5. Divulgacion (honestidad del proceso)
Tras leer el robots.txt se hizo **una sola peticion HEAD** a `https://lapipolnequi.buk.co/trabaja-con-nosotros`
(respondio 200), antes de aplicar la conclusion de robots. Es una desviacion de mi propia regla (se evalua robots
antes de cada URL). No se leyo cuerpo, no se repetira y no se hizo ninguna otra peticion a paginas del tenant.
Ademas se pidio una vez `https://nequi.buk.co/robots.txt` (no resolvio, HTTP 000).

## 6. Siguientes pasos (decision del dueno)
1. Escribir a Buk (soporte/ventas comercial) o a Nequi pidiendo autorizacion para BuscoTrabajoBot; documentar la respuesta.
2. O dejar Buk como evidencia de ATS sin conector (el site probe ya lo clasifica asi) y no gastar mas esfuerzo.
3. Luk: localizar el dominio real (por fuentes oficiales) y leer su robots.txt/terminos antes de nada [NV].

## Fuentes
- robots real: https://lapipolnequi.buk.co/robots.txt, https://www.buk.co/robots.txt
- RFC 9309 - https://www.rfc-editor.org/rfc/rfc9309.html (seccion 2.2.2: coincidencia de grupo; el grupo `*` aplica si ninguno nombra al bot)
