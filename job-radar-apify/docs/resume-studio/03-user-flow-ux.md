# 03 — User Flow & UX

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

| Tema | Estado |
|---|---|
| Puntos de entrada en el código actual | [V] `src/components/JobDetailPanel.tsx:224-234` (CTA aplicar), `src/sections/JobLanding.tsx:186-197` |
| Registro actual | [V] Supabase Auth: Google OAuth y correo+contraseña (`src/auth/auth-provider.tsx:172,190,199`) |
| Consentimiento actual | [V] solo texto pasivo «Al crear tu cuenta aceptas…» (`src/sections/Login.tsx:350-354`); nada se guarda |
| Recorrido propuesto | [P] |

## 0. Revisión 2 (2026-11-14, pedido del propietario) [P] — reemplaza §1 y §2

Más corto, minimalista y con estilo de agente:

```
Vacante ─[✦ Analizar mi perfil para esta vacante]─► Tu CV ─► Agente ─► Descarga
            (Aplicar sigue igual)                     │          │          │
                                     3 casillas + subir PDF/DOCX │   pases 1 o 3 meses
                                                       chat con el agente + CV en vivo
```

1. **Vacante.** Título, empresa, «Aplicar en {fuente}» y el botón con borde
   animado «✦ Analizar mi perfil para esta vacante».
2. **Tu CV.** Va directo a subir el archivo. **Sin onboarding**: el cargo y
   la ciudad salen de la vacante. Encima de la zona de carga van solo tres
   casillas sin marcar, de una línea cada una; el texto legal completo está
   detrás del enlace de cada una (panel lateral):
   - «Autorizo el tratamiento de mis datos personales. *Ver autorización*» (obligatoria);
   - «Acepto los términos del servicio. *Ver términos*» (obligatoria);
   - «Guardar mi hoja de vida en mi cuenta (opcional). *Qué guardamos*».
   La carga se activa solo con las dos obligatorias marcadas.
3. **Agente.** Izquierda: el agente trabaja a la vista (pasos con
   progreso), pregunta lo que falta con respuestas rápidas, muestra la
   compatibilidad y propone cambios con «Aplicar / Omitir». Derecha: el CV
   en vivo con marca de agua, puntaje, Antes/Después, plantilla y
   deshacer/rehacer. En móvil, pestañas «Agente / Tu CV».
4. **Descarga.** Pantalla de pase como la referencia, con la vacante arriba
   (empresa, cargo, compatibilidad). Dos planes, ventajas, «Desbloquear».
   Luego, descarga, aplicar y versiones.

## 1. Recorrido completo (versión 1, reemplazada por §0) [P]

```
Vacante /empleos/:id ──► [Analizar mi perfil para esta vacante]
Home / menú ──────────► /hoja-de-vida (landing con guía útil)
                              │
                              ▼
 S1 Entrada ─► S2 Onboarding (≤6 preguntas, omitibles)
                              │
                              ▼
 S3 Autorización de datos (antes de subir nada) ──► S4 Subir CV │ Crear desde cero
                              │                          │
                              ▼                          ▼
                     Revisión de datos extraídos (campo por campo)
                              │
                              ▼
 S5 Plantilla (3 opciones, 1 recomendada) ─► S6/S7 Editor: chat IA + vista previa
                              │
                              ▼
 S8 Elegir vacante (la de origen o buscar) ─► S9 Análisis de compatibilidad
                              │
                              ▼
 S10 Recomendaciones (aplicar una a una) ─► S11 Antes / después
                              │
                              ▼
 S12 Descargar: vista previa gratis con marca ─► Pago Wompi ─► PDF final + versiones
```

Registro/cuenta: se pide **solo** para guardar en el servidor o para pagar
(Wompi necesita un `userId` en la referencia; ver doc 06 §7). Hasta entonces,
el borrador vive en el `localStorage` del navegador del usuario y no sale de
él salvo para las llamadas a la IA que el usuario dispare [P]. Advertencia
visible en equipos compartidos: «Borra el borrador al terminar». Al registrarse, el borrador se sube tras la
autorización.

## 2. Por qué la autorización va antes de subir el CV [P]

El CV contiene datos personales y el procesamiento con IA puede implicar
transferencia internacional (doc 07). La autorización tiene que ser
**previa** al tratamiento (Ley 1581 art. 9). Por eso S3 va antes de S4, aun
sin cuenta: el usuario autoriza y la constancia se guarda con un id de sesión
anónimo que se vincula a la cuenta si se registra.

## 3. Estados por pantalla [P]

| Estado | Diseño |
|---|---|
| Carga/procesamiento | Esqueleto de la hoja con líneas grises; texto de progreso real («Leyendo tu archivo», «Separando secciones»). Nada de barras falsas. |
| Error de archivo | Tarjeta ink con borde rojo: qué pasó y qué hacer («El PDF es una imagen escaneada; súbelo en DOCX o créalo desde cero»). |
| Error de IA / presupuesto agotado | «El asistente no está disponible ahora. Puedes seguir editando a mano.» El editor manual nunca depende de la IA. |
| Vacío | Editor con plantilla y marcadores «Agrega tu primera experiencia» y un ejemplo ficticio desplegable. |
| Vacante sin requisitos | «Esta vacante no trae requisitos suficientes para un análisis». Ofrece revisar la calidad general del CV. |
| Vacante vencida | Análisis se conserva con la fecha de la foto; banner «La vacante ya no está publicada». |
| Recuperación de sesión | «Tienes un CV sin terminar del 14 nov. ¿Continuar?» |
| Pago pendiente | «Esperando confirmación de Wompi». Se consulta el estado; nunca se desbloquea solo por volver del checkout. |
| Pago rechazado | Mensaje de Wompi traducido + reintentar; el CV no se pierde. |

## 4. Accesibilidad [P]

- Contraste AA con los tokens del sitio (`--foreground` 210 7 % 6 % sobre blanco y TINTS).
- Chat como región `aria-live="polite"`; propuestas con botones etiquetados («Aplicar cambio en Resumen»).
- Vista previa navegable por teclado; el documento también se ofrece como texto plano accesible.
- `prefers-reduced-motion` desactiva animaciones; las del sitio ya lo respetan.
- Objetivos táctiles ≥ 44 px; la barra inferior del móvil (`BottomNav`) no tapa los botones del editor.

## 5. Responsive [P]

- **Escritorio (≥ 1024 px):** dos columnas, chat 40 % · vista previa 60 %.
- **Móvil:** pestañas «Chat · Vista previa · Análisis»; la vista previa es una hoja escalada a ancho completo con zoom; botón flotante «Ver cambios».

## 6. Animaciones discretas [P]

- Diff aplicado: resaltado verde-soft 1,2 s sobre la línea cambiada.
- Puntuación: el número se actualiza sin contador animado (evitar efecto «tragamonedas»).
- `ink-lift` en tarjetas interactivas, como en el resto del sitio.

## 7. Integración con el sitio actual [P]

- Header, footer y `BottomNav` actuales; el Resume Studio es una sección más.
- El botón en la vacante es secundario (outline ink) para no competir con «Aplicar».
- El sitio no carga código del Resume Studio en las páginas de vacantes: el botón es un enlace a `/hoja-de-vida/analizar?vacante=<uuid>` (ruta con *lazy import*). Así no cambia el peso del detalle de vacante ni la caché del dashboard.
