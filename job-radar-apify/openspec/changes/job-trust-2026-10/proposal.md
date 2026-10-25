# Fechas de vacantes y acceso a la oferta original

**Base:** `origin/main` en `668f111`. **Alcance:** datos de fecha, advertencia de vigencia y recorrido de aplicación. Las descripciones y el trabajo SEO en curso quedan fuera.

## Problema

Una fecha relativa de origen queda congelada en la interfaz. El parser equipara minutos y textos desconocidos con la hora del rastreo. Computrabajo no ofrece hoy una comprobación permitida y fiable de cierre por vacante; una oferta puede aparecer reciente y estar retirada. El modal de aplicación permite continuar sin cuenta.

## Decisión del propietario

El detalle público de la vacante sigue abierto. Solo el clic en **Aplicar** pide registro o inicio de sesión. Las vacantes de Computrabajo permanecen visibles, identificadas como **Vigencia no verificada**. No se amplía la ruta de proxy que evita el bloqueo de la fuente.

## Contrato

- Una fecha desconocida nunca se convierte en “Hoy” ni se ingiere como publicación reciente.
- Las fechas relativas conocidas se traducen con su unidad real y el texto visible envejece desde el timestamp guardado.
- “Ver vacante” navega al detalle interno. En el detalle, el usuario anónimo ve un botón sin URL de salida y luego un modal con Google/correo. Con sesión válida, **Aplicar** abre la fuente.
- Computrabajo conserva su inventario, sin insignia “Nueva” basada solo en fecha; la interfaz advierte que su vigencia no está verificada.
- El inventario agregado se mide con una transacción de solo lectura. No se exportan URLs, títulos ni datos personales.

## Límite conocido

La advertencia no determina qué vacantes de Computrabajo ya cerraron. La verificación automática requiere un canal permitido de la fuente (API, feed o acuerdo). Los enlaces originales siguen presentes en contratos públicos existentes; esta fase controla el recorrido normal de la interfaz sin modificar esos contratos.
