# Proctify Deployment and Operations

## Current hosting
GitHub Pages deploys the static frontend from the repository root when changes reach `main`. The workflow does not deploy the API.

## API setup
1. Copy `worker/wrangler.example.toml` to a private local `worker/wrangler.toml`.
2. Create the D1 database named `proctify-db` and place its actual ID in the private configuration.
3. Create the R2 bucket `proctify-course-assets`.
4. Install the Worker dependencies from the `worker` directory.
5. Apply the migration locally, inspect the schema, then apply it to the remote D1 database.
6. Configure the identity issuer, audience, allowed frontend origins, and encrypted secrets.
7. Configure Turnstile and Cloudflare edge rate limits for public registration and authentication endpoints.
8. Deploy the Worker only after the local API and authorization tests pass.
9. Point the frontend API base path to the deployed Worker and test the full browser-to-database flow.

## Required secrets and configuration
- `AUTH_JWT_SECRET`: private HMAC signing secret shared only with the approved identity issuer and Worker.
- `TURNSTILE_SECRET`: private Turnstile secret.
- `APP_ORIGIN`: exact comma-separated allowed frontend origins.
- `AUTH_ISSUER` and `AUTH_AUDIENCE`: exact values expected in verified login tokens.
- Payment webhook signing secret: add only after a provider is selected.
- SES credentials: use a protected secret store or a narrowly scoped sending integration; never place them in frontend code.

## Super Admin bootstrap
The first platform administrator must be created through a controlled one-time database operation after the identity account is verified. Do not expose a public route that can grant Super Admin. Record the bootstrap in the audit log and remove temporary credentials immediately.

## Deployment safety
- Keep the current production Pages deployment unchanged until the new API and portal flows pass staging.
- Apply D1 migrations to a staging database first.
- Back up the database before every production migration.
- Use additive migrations and avoid destructive changes to the existing assessment catalog.
- Keep payment, email and identity integrations disabled until their secrets and provider webhooks are verified.
- Monitor Worker errors, D1 usage, R2 access, failed logins, registration abuse and payment reconciliation.
- Test backup restoration and account/certificate export procedures.
