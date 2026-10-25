# Preserve real jobs through browser rendering

Google URL Inspection live test, 2026-10-24 21:17 Bogota: a live sitemap
URL (`ed2e6351-2f8f-45fd-ab16-cee5dd966080`) returned HTTP 200, allowed
indexing, a self canonical and 3,453 characters of SSR description, but
Google rendered "Esta vacante ya no esta disponible" and reported Soft 404.
Its resource report identifies /api/jobs/<id> as blocked by robots.txt.
The public API returns the real job to an ordinary HTTP client.

The browser replaces SSR with a loading state and treats any failed detail
fetch as absence. Carry the already-public server job into the client and
distinguish real absence from transient fetch failures. Do not open private
API routes, alter readiness or loosen Google eligibility.
