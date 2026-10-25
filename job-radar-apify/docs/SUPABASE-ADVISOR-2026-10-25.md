# Supabase advisor fixes — 2026-10-25

Applied on production (project `wneeisleyngulowfcicp`) with the user's
authorization, from the Supabase dashboard. No user rows read or changed;
only aggregate counts were queried.

| Advisor finding | Before | Action | Verified |
|---|---|---|---|
| RLS Disabled in Public — `public.cv_pii_vault` (CRITICAL) | RLS off; `anon` and `authenticated` had SELECT/INSERT/UPDATE/DELETE/TRUNCATE. 0 rows, no reference in any branch of this repo (CV Generator retired 2026-10-18). | `ALTER TABLE … ENABLE ROW LEVEL SECURITY; REVOKE ALL … FROM anon, authenticated;` | RLS true; grantees only `postgres`, `service_role`. |
| Function Search Path Mutable — `public.jobs_set_identity_keys` | No `search_path` set. | `ALTER FUNCTION … SET search_path = ''` (also in `src/db/schema.sql`). | Rolled-back probe on a temp table: `analistadedatossr` / `accenture` / `bogota`, identical to before. |
| Leaked Password Protection Disabled (Auth) | Off. | Enabled "Prevent use of leaked passwords". Other Email-provider switches unchanged (sign-up on, confirm email on). | Saved; existing users unaffected (only new passwords are checked). |
| Service restrictions are active (Aug 15) | Quota alert from the previous plan. | None: org is on Pro; current cycle usage is low (17 MAU, 0.64 GB egress). | Historical notice. |
| Extension in Public — `vector` | Extension in `public`. | Not changed: moving an extension can break dependent objects; needs its own change. | — |
