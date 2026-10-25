# Confirmed authentication measurement

Approved implementation scope: first phase of the SEO/conversion audit.
GA4 16–22 October 2026: 156 sign_up events from 11 users. Production emits
sign_up on repeated Supabase SIGNED_IN notifications and on unconfirmed
email requests. Remove those triggers and deduplicate confirmed callbacks.
This phase does not change indexing, content, authentication or billing.
