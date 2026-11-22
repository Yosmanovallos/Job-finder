# Tasks: Resume Studio R4

Rama `codex/resume-studio-r4`, creada desde `codex/resume-studio-r3`. La
evidencia va en `validation.md`.

- [x] OpenSpec (este cambio).
- [x] Config de pases (`passes.ts`), bandera `RESUME_STUDIO_PAYMENTS` y cupo gratis.
- [x] Esquema: `transactions.product`, `rs_entitlements` y `rs_adaptation_quota`, también en el script de migración (TABLES, RLS y REVOKE).
- [x] Firma H1 (`timingSafeEqual`) y aprobación transaccional con H2, idempotente y ramificada por producto.
- [x] `POST /api/resume/checkout`, `GET /api/resume/pass` y `POST /api/resume/checkout/confirm` (consulta a la API de Wompi).
- [x] Cupo en `/tailor/start` junto a los topes de R3.
- [x] DOCX en el servidor detrás del pase; PDF por impresión, con marca de agua si no hay pase.
- [x] Pantalla de pase, como el prototipo (IVA incluido, retracto, sin urgencia).
- [x] Etiquetas de pases en el historial de pagos de Cuenta.
- [x] Pruebas: T-PAY-1..5, regresión de la suscripción, cupos e IDOR. Unitarias: firma, DOCX y confirmación.
- [x] Gates: tsc, build, test:unit, test:integration, test:resume-studio y T-FREE.
- [x] PR en borrador contra `codex/resume-studio`; archivar el cambio.
