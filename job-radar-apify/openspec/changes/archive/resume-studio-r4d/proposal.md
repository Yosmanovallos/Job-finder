# Resume Studio R4d: los 5 P0 del informe «Adaptación de CV con IA»

**Estado:** implementado y archivado (2026-11-27). La evidencia está en [`validation.md`](validation.md).
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../../docs/adr/0017-resume-studio-implementation.md).
**Rama:** `codex/resume-studio-r4d`, cortada de `codex/resume-studio-r4c`
(`5473cc6`, PR #153). El PR va en borrador contra `codex/resume-studio-r4c`.
Nada va a `main` ni a Supabase.
**Guía:** informe `reports/Adaptación de CV con IA.md` (raíz de Job-finder),
sección «Recomendaciones priorizadas», filas P0. Todo el texto de interfaz
que viene del informe es **una propuesta no probada con usuarios**; hay que
validarlo con 5 a 8 personas antes de fijarlo.

## Problema

El propietario probó R4c con su CV real (en inglés) y la vacante de Amadeus
(Workday, «QA Engineer»). El flujo todavía confunde:

1. La vacante pide Jenkins, Git, Splunk y Robot Framework. Nadie pregunta por
   ellas; la tarjeta de habilidades era una lista de casillas fácil de saltar
   y Splunk y Robot Framework ni estaban en el vocabulario. Además, «Work
   hybrid at our Bogota office» se leía como la habilidad «Office».
2. «✨ Redactar solo con mi CV» y «Usar este dato» parecen no hacer nada: la
   respuesta llega en gris pequeño al pie de la tarjeta.
3. «Sin evidencia en tu CV: no se aplica nada» no dice qué falta, por qué
   importa ni qué hacer.
4. «Usar este dato: ~5 años» aparece en una tarjeta de «distributed
   systems»: la expresión `/años|years|experiencia/` coincidía con casi todo.
5. Una viñeta aplicada salió en español con el CV en inglés: `BASE_RULES`
   decía «Escribes en español neutro» en todos los prompts.

## Alcance

1. **Herramientas, una por una** (`cards.ts`, `skills.ts`, `ToolCard`):
   tarjeta `tool` por cada herramienta que piden los requisitos y el CV no
   muestra (máx. 6), antes de toda tarjeta que redacta. «¿Has usado
   Jenkins?» → Sí / Algo parecido / No. Sí: dónde (trabajo, proyecto, curso)
   y una frase opcional; con frase en un trabajo, `card_rewrite` redacta solo
   con eso; sin frase, solo Habilidades. No: no se escribe nada y queda en
   «lo que la vacante pide y tu hoja de vida no muestra». Algo parecido:
   herramientas de la misma familia que el CV ya muestra; nunca se escribe
   el nombre que falta. Vocabulario: Splunk, Robot Framework y 22 más en
   `skills.ts` (no en el catálogo del sitio, que alimenta páginas públicas);
   «Office» suelto exige mayúscula o «paquete/microsoft/de/en office».
   Las tarjetas de mapeo dicen qué herramientas de su requisito faltan.
2. **Botones vivos** (`action-state.ts`, `ProposalCard`): al tocar, el
   botón muestra spinner y verbo («Redactando…») en el mismo render; a los
   10 s, «Esto está tardando más de lo normal» + Cancelar (AbortController);
   la respuesta, incluso «tu CV no lo muestra», sale en el lugar del botón,
   en tamaño normal y con siguientes pasos.
3. **Qué falta, por qué, qué hacer** (`missingNotice`, `outcomeFor`):
   «Tu hoja de vida no menciona «X», así que no lo escribimos por ti.
   ¿Trabajaste con eso en algún empleo?» [Sí, te cuento] [No, saltar].
   Procedencia: «Basado en tu hoja de vida» solo para hechos citados por id
   del CV inicial; «Basado en lo que nos contaste» para lo aportado en esta
   adaptación; las coincidencias por palabras son «Se parece a», sin sello.
4. **Datos en contexto** (`asksForYears`, `yearsFit`): «~X años» solo si el
   requisito (o, en título/perfil, la pregunta) pide un número de años y la
   cifra lo responde (calculada en esa área, o pregunta sin área).
5. **Idioma fijo** (`language.ts`): detector determinista es/en (palabras
   función + terminaciones; las herramientas no cuentan; textos cortos =
   desconocido, nunca bloquea). `/extract` y `/tailor/start` devuelven el
   idioma; el servidor lo recalcula de los hechos en cada tarjeta. Los cinco
   prompts que redactan (`card_headline@3`, `card_rewrite@3`,
   `card_draft@3`, `card_summary@5`, `card_chat@4`) reciben el idioma desde
   el código (en el system, nunca en un bloque de datos). Si la propuesta
   sale en otro idioma: un reintento con entrada distinta (no pega en la
   caché) y propósito propio (`*_lang`, no gasta turnos de chat); si sigue
   mal, se descarta. Los títulos y fechas de la vista previa y el DOCX
   salen en el idioma del CV.

## Fuera de alcance

P1/P2 del informe (puntaje como «cobertura», «Aceptar todo», promesas
comerciales, archivo final legible, consentimiento ampliado). Elegir idioma
cuando vacante y CV difieren: se informa y se usa el del CV.

## Reglas

0 datos inventados (`validateProposal` sigue mandando), nunca una caja
vacía, edición precargada solo con texto verificado, 0 `window.confirm`,
hash del CSS global sin cambios, sin datos reales en el repo.
