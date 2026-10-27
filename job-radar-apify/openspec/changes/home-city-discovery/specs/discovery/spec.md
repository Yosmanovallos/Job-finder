# Requisitos observables

- HCD-001: / contiene enlaces HTML a Bogotá/Cúcuta; /ve a Caracas. Markdown
  ofrece los mismos destinos, bajo contexto explícito del país.
- HCD-002: el bloque conserva sus enlaces visibles tras React en móvil y
  escritorio, con home-stats fallando y con la pestaña Por cargo seleccionada.
- HCD-003: cada destino es una categoría existente con país correcto, 200 y
  canonical propio. Ningún destino extranjero se inserta en el bloque local.
- HCD-004: sin nuevos conteos/consultas, rutas o llamadas de cliente; sin cambiar
  H1, title, canonical, hreflang, schema, negociación o seguridad existentes.
- HCD-005: publicación verificable por HTTP/DOM; registrar indexación futura
  por separado, sin declarar éxito de crecimiento con solo publicar enlaces.
