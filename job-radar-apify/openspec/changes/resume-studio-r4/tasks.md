# Tasks: Resume Studio R4

Rama `codex/resume-studio-r4`, creada desde `codex/resume-studio-r3`. La
evidencia va en `validation.md`.

- [x] OpenSpec (este cambio).
- [ ] Config de pases (`passes.ts`), bandera `RESUME_STUDIO_PAYMENTS` y cupo gratis.
- [ ] Esquema: `transactions.product`, `rs_entitlements` y `rs_adaptation_quota`, también en el script de migración (TABLES, RLS y REVOKE).
- [ ] Firma H1 (`timingSafeEqual`) y aprobación transaccional con H2, idempotente y ramificada por producto.
- [ ] `POST /api/resume/checkout`, `GET /api/resume/pass` y `POST /api/resume/checkout/confirm` (consulta a la API de Wompi).
- [ ] Cupo en `/tailor/start` junto a los topes de R3.
- [ ] DOCX en el servidor detrás del pase; PDF por impresión, con marca de agua si no hay pase.
- [ ] Pantalla de pase, como el prototipo (IVA incluido, retracto, sin urgencia).
- [ ] Etiquetas de pases en el historial de pagos de Cuenta.
- [ ] Pruebas: T-PAY-1..5, regresión de la suscripción, cupos e IDOR. Unitarias: firma, DOCX y confirmación.
- [ ] Gates: tsc, build, test:unit, test:integration, test:resume-studio y T-FREE.
- [ ] PR en borrador contra `codex/resume-studio`; archivar el cambio.
