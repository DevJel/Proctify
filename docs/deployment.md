# PROCTORAVA Deployment and Operations

## Frontend hosting — Cloudflare Pages
- Production project: `proctorava`
- Production URL: https://proctorava.pages.dev
- Cloudflare account: **Proctorava and HRIS app**
- Source repository: `DevJel/Proctify`
- Production branch: `main`
- Root directory: repository root
- Build command: none (the current frontend is static HTML and assets)
- Output directory: repository root
- GitHub Pages deployment workflow: removed. Do not restore it.
- GitHub remains the source repository; Cloudflare Pages is the production hosting destination.

Cloudflare deployment must be verified after each hosting change. Confirm the latest production deployment status and open the production URL before announcing a release.

## API setup
1. Copy `worker/wrangler.example.toml` to a private local `worker/wrangler.toml`.
2. Create the D1 database named `proctify-db` and place its actual ID in the private configuration.
3. Create the R2 bucket `proctify-course-assets`.
4. Install the Worker dependencies from the `worker` directory.
5. Apply migrations locally in order (`0001_lms_foundation.sql`, then `0002_course_access_and_marketplace.sql`), inspect the schema, then apply all migrations to the remote D1 database.
6. Configure the identity issuer, audience, allowed frontend origins, and encrypted secrets.
7. Configure Turnstile and Cloudflare edge rate limits for public registration and authentication endpoints.
8. Deploy the Worker only after the local API and authorization tests pass.
9. Point the frontend API base path to the deployed Worker and test the full browser-to-database flow.

## Required secrets and configuration
- `AUTH_JWT_SECRET`: private HMAC signing secret shared only with the approved identity issuer and Worker.
- `TURNSTILE_SECRET`: private Turnstile secret.
- `APP_ORIGIN`: exact comma-separated allowed frontend origins.
- `AUTH_ISSUER` and `AUTH_AUDIENCE`: exact values expected in verified login tokens. Tokens must include a signed boolean `email_verified: true` claim.
- Payment webhook signing secret: add only after a provider is selected.
- SES credentials: use a protected secret store or a narrowly scoped sending integration; never place them in frontend code.

## Super Admin bootstrap
The first platform administrator must be created through a controlled one-time database operation after the identity account is verified. Do not expose a public route that can grant Super Admin. Record the bootstrap in the audit log and remove temporary credentials immediately.

## Deployment safety
- Keep the existing assessment experience available while API and portal flows are tested in staging. The frontend production host is Cloudflare Pages.
- Apply D1 migrations to a staging database first.
- Back up the database before every production migration.
- Use additive migrations and avoid destructive changes to the existing assessment catalog.
- Keep payment, email and identity integrations disabled until their secrets and provider webhooks are verified.
- Monitor Worker errors, D1 usage, R2 access, failed logins, registration abuse and payment reconciliation.
- Test backup restoration and account/certificate export procedures.
