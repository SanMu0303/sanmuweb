# Supabase migration status — 2026-09-14

Branch: migration/vercel-supabase. Original Sites production has not been changed.

Completed:
- Four PostgreSQL tables and the private research-images bucket verified remotely.
- Server-only HTTP client, paginated content repository and atomic optimistic revision updates.
- Next.js Node API route for session, library, feed, post/article detail, watchlist and administrator content reads/writes.
- Existing document validation extracted for reuse; member previews projected before filtering/searching.
- Password login uses Supabase Auth /token and /user, verified email plus ADMIN_EMAILS allowlist. Sites identity headers are ignored.
- Access token held in HttpOnly SameSite cookie (Secure on HTTPS), max one hour. There is no refresh-token persistence yet: log in again after expiry. Logout clears cookie and asks Auth to invalidate session refresh credentials.
- Password form and original login entry links adapted. No password or service key sent to browser code.
- Production build passes with dynamic /api/[...path]. New security/repository tests pass.

Runtime checks: production server on local port 3100 responds to session/library/posts/watchlist; anonymous admin access returns 401; login form renders.

Not complete, do not cut over production:
- Administrator Auth user was created and email confirmed. The user successfully logged in to /admin; login state survived refresh. Origin validation now handles the local 127.0.0.1 host and Vercel HTTPS without weakening CSRF checks.
- Managed images use signed direct uploads to private Supabase Storage, server validation, authorized signed downloads, transactional attachment and guarded deletion. Both SQL migrations are installed. Live integration checks passed for 1/4/9 images, a file above 4.5 MB, deletion, reversed ordering, revision conflicts and private access. Temporary deletion tombstones are cleaned on subsequent uploads after expiry; there is no scheduled cleanup job yet.
- Original source metadata is backed up under ignored .local/sites-backup-20260914: 21 articles, 3 watch items and 4 image records. The four original image files remain to be recovered from the owner-private Site. Import deliberately refuses to proceed without those originals and refuses to overwrite existing target records.
- GitHub remote is configured for SanMu0303/sanmuweb, but the available credential returns 403 on push. GitHub write authorization is still required.
- GitHub/Vercel deployment and custom domain cutover have not happened.

This branch now uses next build / next start, not static export + Sites packaging. Historical Sites worker scripts remain for reference and regression testing, but must not deploy this migration branch to Sites using old out/dist artifacts.

Latest validation: production build and all 9 migration unit tests pass; live storage integration passed twice and cleaned its test data on successful runs. No claim is made that Vercel production is deployed.

Next: recover four source images, import original content, authorize GitHub push, configure Vercel server environment, deploy and verify the public production URL.
