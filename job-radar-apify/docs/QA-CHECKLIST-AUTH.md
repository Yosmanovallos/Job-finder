# Checklist manual de QA — flujo de auth/cuenta/suscripción

Todo lo que los tests automatizados (`npm run test:paywall`,
`test:password-reset`, `test:payment-flow`) no pueden cubrir porque requieren
un navegador real, una bandeja de entrada real, una cuenta de Google real o
el sandbox real de Wompi. Repetir esta lista completa después de cualquier
cambio grande en `src/auth/`, `src/sections/Login.tsx`,
`src/sections/Account.tsx` o `src/payments/`.

## Registro y confirmación de correo

- [ ] Crear una cuenta nueva con correo/contraseña en `/login`.
- [ ] Llega el correo de confirmación (revisar spam) y el link apunta al
      dominio de producción, no a `localhost`.
- [ ] Clic en el link de confirmación aterriza en `/auth/callback` y termina
      en `/dashboard` con el header ya mostrando "Mi cuenta".
- [ ] "¿No te llegó? Reenviar correo de confirmación" manda un segundo
      correo y respeta el cooldown de 30s (botón deshabilitado con cuenta
      regresiva).

## Login

- [ ] Login con correo/contraseña correctos entra al dashboard.
- [ ] Login con contraseña incorrecta muestra "Correo o contraseña
      incorrectos" (no un mensaje crudo en inglés).
- [ ] Login con Google: autorizar y confirmar que vuelve a `/auth/callback`
      y termina en `/dashboard` (o en `return_to` si se llegó desde un link
      con esa query), y el header pasa a "Mi cuenta".
- [ ] Recargar la página (F5) estando logueado mantiene la sesión (no vuelve
      a pedir login).

## Recuperación de contraseña

- [ ] "¿Olvidaste tu contraseña?" envía el correo de recuperación.
- [ ] El link del correo aterriza en `/reset-password` con el formulario de
      nueva contraseña habilitado (no el mensaje de "enlace no válido").
- [ ] Fijar una nueva contraseña y confirmar que la vieja ya no sirve y la
      nueva sí.
- [ ] Entrar directo a `/reset-password` sin haber hecho clic en ningún
      correo muestra el mensaje de "enlace no válido o expiró", no un
      formulario funcional.

## Rutas protegidas

- [ ] Estando deslogueado, entrar por URL directa a `/cuenta` redirige a
      `/login?return_to=%2Fcuenta`, y tras loguearse vuelve a `/cuenta`.
- [ ] Estando deslogueado, `/dashboard` sigue siendo accesible (freemium) —
      "Probar gratis" no debe pedir login.
- [ ] Cerrar sesión desde `/cuenta` limpia todo: header vuelve a "Iniciar
      sesión", y volver a entrar a `/cuenta` vuelve a redirigir a login.

## Perfil

- [ ] Editar el nombre en `/cuenta`, guardar, recargar la página — el nombre
      nuevo persiste (no vuelve al de antes).

## Pagos y suscripción

- [ ] Pagar el plan Pro con una tarjeta de sandbox de Wompi desde
      `/pricing`, confirmar que el dashboard muestra el banner de
      "Confirmando tu pago..." y luego "🎉 ¡Listo! Ya eres suscriptor Pro."
- [ ] El pago aprobado aparece en el historial de `/cuenta` con estado
      "Aprobado" y el monto correcto en COP.
- [ ] Estando ya en Pro, el botón en `/pricing` dice "Renovar ahora (30 días
      más)" y el flujo de Wompi funciona igual que la primera vez.
- [ ] La fecha de "Renueva" en `/cuenta` se actualiza tras cada pago
      aprobado.

## Nota sobre límites de Supabase durante las pruebas

Si en algún punto de este checklist Supabase empieza a devolver `email rate
limit exceeded`, no es un bug de esta sesión de pruebas — es el límite de
envíos del proveedor de correo por defecto de Supabase (ver
`docs/BACKLOG.md`, sección "Infraestructura de correo"). Espera unos minutos
o usa cuentas de correo distintas para seguir probando; no bloquea la
verificación del resto del checklist.
