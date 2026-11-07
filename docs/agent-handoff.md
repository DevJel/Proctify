# PROCTORAVA Agent Handoff — Mandatory Project Instructions

> Read this document and the linked documents before changing code. This handoff is intentionally self-contained: do not depend on previous chat memory, conversation summaries or assumptions.

## 1. Product and repository identity

- Product: **PROCTORAVA**
- Description: Learning Management, Proctored Assessments and Verified Credentials.
- Repository: `DevJel/Proctify`
- Production frontend: `https://proctorava.pages.dev`
- Hosting: Cloudflare Pages, project `proctorava`, production branch `main`.
- Cloudflare account: **Proctorava and HRIS app**.
- Frontend source of truth: `index.html`, `assets/img/`, `fonts/`.
- Backend source of truth: `worker/src/`, `worker/migrations/`.
- Architecture and operations source of truth: `docs/` and this README.
- GitHub Pages workflow was removed. Do not restore GitHub Pages deployment.
- Keep current PROCTORAVA branding, logo, favicon, SVG artwork, assessment artwork, colours and existing assessment catalogue unless the user explicitly requests a design change.

## 2. User-facing product rules

- Explain work in plain language. Avoid unnecessary engineering jargon.
- Keep recruiter, educator and learner-facing wording simple and direct.
- Preserve the assessment-first experience while LMS work is completed.
- Proctify-owned assessment content, scoring, reporting, proctoring policy and certificates must remain protected.
- Verified schools, companies and independent publishers may own their own course content.
- Organization owners/admins manage groups, sections, subjects, courses, activities, educators, learners and communication.
- Educators only access groups/courses explicitly assigned to them.
- Platform administrators are controlled by the private `platform_admins` database table.
- Never grant roles because a visitor selected a role on a login page.

## 3. Authentication implementation and rules

Read `docs/authentication-architecture.md` first.

Three sign-in routes:
- Learner: `#/login/learner`
- Organization / Educator: `#/login/organization`
- Super Admin: `#/login/admin`

Authentication is passwordless email OTP:
- Challenge: `POST /api/auth/challenge`
- Verify: `POST /api/auth/verify`
- Current account: `GET /api/auth/me`
- Sign out: `POST /api/auth/logout`

Rules:
- OTP is six digits, expires after ten minutes, one use, maximum five attempts.
- At least 60 seconds between resend requests; five per email and twenty per IP per 15 minutes.
- OTP values are not stored in D1. Only keyed HMAC hashes are stored.
- Learner accounts are created after successful code verification.
- Organization access requires active membership in a verified organization. Verified owner email can claim the owner membership.
- Super Admin access requires an existing active `platform_admins` record. Never create an admin from the frontend or a public API.
- Learner and organization sessions last 12 hours; Super Admin sessions last 4 hours.
- Session IDs are stored in D1 and checked on protected API requests. Logout revokes the session.
- Frontend bearer token storage is `sessionStorage`; do not move it to localStorage.
- SES delivery is through the AWS SES v2 API. Required Worker secrets and variables are documented in `docs/authentication-architecture.md`.
- Super Admin currently has an allow-list and shorter session but does not yet have a second independent MFA factor. Treat this as a production security improvement/gate.
- Do not claim authentication is production-live until D1 migrations, Worker deployment, SES sender verification, secrets and end-to-end tests are complete.

## 4. Mandatory architecture and diagrams

The auth architecture, sign-in sequence, component map, role matrix, API contract and production limitations are documented in:
- `docs/authentication-architecture.md`
- `docs/lms-architecture.md`
- `docs/security.md`
- `docs/api.md`
- `docs/deployment.md`

Keep Mermaid diagrams in architecture/workflow documentation whenever the flow or dependency structure changes. Update diagrams and prose together.

## 5. Files and ownership

| Path | Responsibility |
|---|---|
| `index.html` | Existing responsive frontend, assessment experience, three login pages and browser API calls |
| `assets/img/` | Existing brand marks, favicon source art, assessment covers and hero images |
| `fonts/` | Inter and Lora font files and license |
| `worker/src/index.ts` | Main Cloudflare Worker router and LMS/business API |
| `worker/src/auth.ts` | Email OTP challenge, SES delivery, JWT issuance and verification, session validation |
| `worker/migrations/0001_lms_foundation.sql` | Core users, organizations, courses, assessments, certificates, orders and audit tables |
| `worker/migrations/0002_course_access_and_marketplace.sql` | Marketplace slug and course staff constraints |
| `worker/migrations/0003_educator_groups_and_communication.sql` | Groups, educators, learner assignments, activities and messages |
| `worker/migrations/0004_auth_sessions.sql` | OTP challenges and revocable sign-in sessions |
| `worker/wrangler.example.toml` | Safe template for Worker name, vars, D1 and R2 bindings |
| `worker/package.json` | Worker development, deployment and type-check commands |
| `scripts/check-frontend.mjs` | Static frontend/accessibility/route checks |
| `.github/workflows/lms-foundation-check.yml` | CI type-check, migration and frontend checks |
| `docs/authentication-architecture.md` | Authentication source of truth |
| `docs/agent-handoff.md` | Required handoff for future agents |
| `docs/api.md` | API route catalogue and access rules |
| `docs/security.md` | Security and privacy requirements |
| `docs/deployment.md` | Cloudflare and production runbook |
| `README.md` | Entry point, links, status and integration footer |

Do not duplicate auth logic in a second Worker module or place AWS credentials in frontend files. Keep one source of truth for each responsibility.

## 6. Environment and secrets

Required Worker variables:
- `APP_ORIGIN`: exact frontend origins separated by commas.
- `AUTH_ISSUER`: exact identity issuer string.
- `AUTH_AUDIENCE`: `proctorava`.
- `AWS_REGION`: `ap-southeast-2`.
- `SES_FROM_EMAIL`: verified SES sender.

Required private Worker secrets:
- `AUTH_JWT_SECRET`: at least 32 characters; random; not the OTP secret.
- `AUTH_OTP_SECRET`: at least 32 characters; random; separate from JWT secret.
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- optional `AWS_SESSION_TOKEN`
- `TURNSTILE_SECRET` for organization applications.

Never commit actual values. Do not ask the user to paste credentials into source files or README. Use the Cloudflare secret store or an approved secret-management workflow.

## 7. Mandatory development workflow

1. Read this handoff, README, authentication architecture, API, security and deployment documents.
2. Inspect current `main` and open pull requests before editing.
3. Create a focused feature branch. Never work directly on production `main` unless explicitly requested and safe.
4. Preserve existing assessment content and visual assets.
5. Add additive D1 migrations only. Do not rewrite old production migrations.
6. Add or update API documentation, security documentation and Mermaid diagrams for every backend behavior change.
7. Update README links and current implementation status for every material feature.
8. Run Worker TypeScript checks, all D1 migration checks and frontend checks.
9. Test positive and negative access paths, including cross-organization access denial, suspended users, revoked sessions, expired codes, reused codes, wrong audience and rate limits.
10. Open a PR with a plain-language summary, test evidence, deployment impact and any remaining provider configuration.
11. Merge only after required checks pass.
12. Verify Cloudflare deployment status and test the actual production URL and API health endpoint before reporting success.

## 8. Required production completion plan

### Phase A — Code and CI
- Confirm the auth module and migration 0004 are in the main branch.
- Run `npm install --no-package-lock` and `npm run typecheck` inside `worker/`.
- Apply migrations 0001–0004 to a clean SQLite database in order.
- Add tests for valid code, wrong code, expired code, reuse, max attempts, email/IP rate limits, user suspension, organization membership and admin allow-list.
- Run `node scripts/check-frontend.mjs`.

### Phase B — Cloudflare resources
- Create the production D1 database and bind it as `DB`.
- Create the required R2 bucket and bind it as `ASSETS`.
- Apply migrations 0001–0004 to staging first, then production after backup.
- Deploy the Worker as `proctorava-api` with the exact production variables.
- Confirm `GET /api/health` reports database and identity readiness without exposing secrets.
- Confirm CORS allows only the intended frontend origins.
- Confirm the Pages frontend uses the deployed Worker URL.

### Phase C — Email and identity
- Verify the sender identity in Amazon SES in `ap-southeast-2`.
- Confirm SES production access and sending quota are appropriate.
- Create a dedicated least-privilege IAM sender principal; do not use an administrator credential.
- Add the required secrets through Cloudflare's secret mechanism.
- Send and receive real OTP emails for each audience.
- Confirm expired, wrong, reused and rate-limited codes fail safely.
- Bootstrap the first Super Admin privately and record the audit event.
- Add independent MFA for Super Admin before enabling high-impact admin operations.

### Phase D — Security and operations
- Configure Cloudflare edge rate limiting/WAF rules.
- Add Turnstile or equivalent bot protection to auth challenge requests.
- Verify staging and production use separate databases and secrets.
- Test D1 backup and restoration.
- Monitor Worker exceptions, SES bounces/complaints, rate-limit responses and failed sign-ins.
- Define support and recovery procedure for suspended accounts and lost email access.
- Define data retention and privacy notice for identity and proctoring information.

### Phase E — End-to-end acceptance
- Test learner code request, verification, protected API call and logout.
- Test verified organization owner and educator membership, and reject unverified/non-member users.
- Test Super Admin allow-list and reject an ordinary learner using the admin page.
- Test revoked and expired sessions are rejected by all protected API routes.
- Test no OTP or JWT appears in localStorage, URLs, console logs or analytics.
- Test desktop, tablet and mobile sign-in layouts.
- Record deployment ID, commit SHA, API health output and test results in the release notes.

## 9. Production blockers that must not be hidden

The presence of frontend pages or code in GitHub does not prove a live backend. Before saying "production authentication is complete", verify:
- D1 exists and migrations 0001–0004 have succeeded remotely.
- Worker is deployed and its live health endpoint is reachable.
- SES sender is verified and actual email delivery succeeds.
- All required Worker secrets are set.
- API CORS matches the production site.
- The frontend calls the deployed Worker.
- All end-to-end tests above pass.
- Super Admin MFA decision is closed and documented.

If any item is missing, report it plainly as pending. Do not claim deployment or email delivery succeeded based only on a successful GitHub merge.

## 10. Integration and connector rules

- Use the connected MCP/ISO connector only if it is actually available in the current environment. Do not claim a connector was used when it was not available.
- Keep connector-specific notes, setup and any exceptions in the README footer only.
- Do not mix connector-specific implementation code into unrelated UI or core business logic.
- Keep all external service calls behind documented service boundaries.

## 11. Definition of done for every future agent

A change is not complete until:
- code is committed and reviewed;
- database migrations are additive and tested;
- API and frontend contracts agree;
- documentation and README are updated;
- Mermaid diagrams match the implementation;
- security and failure paths are tested;
- deployment status is verified;
- remaining blockers are listed honestly.

The next agent must be able to continue from the repository and these documents alone, without asking the user to repeat decisions from chat.
