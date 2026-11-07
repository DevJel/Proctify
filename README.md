# PROCTORAVA

**Learning Management, Proctored Assessments and Verified Credentials**

PROCTORAVA brings together twelve first-party assessments, proctored skills testing, verified results and a multi-organization learning marketplace. Schools, companies and independent publishers can manage their own courses after verification, while PROCTORAVA retains ownership and control of its assessment and certification catalog.

By Operava Global Solutions.

## Current application

**Production site: https://proctorava.pages.dev**

The frontend is hosted by Cloudflare Pages in the **Proctorava and HRIS app** Cloudflare account. The project is connected to this repository and deploys the `main` branch automatically. GitHub Pages deployment has been removed; GitHub remains the source-code repository only.

Cloudflare Pages hosts the static frontend. The authentication API source and D1 migration are now included in this implementation branch; the production Worker, D1 database and SES delivery still require provisioning and end-to-end verification. Payments remain a separate integration.

## Experience and access review

- [Responsive, accessibility, PWA and authentication readiness review](docs/experience-access-review.md)

## Mandatory agent handoff and authentication

Every future agent must read [Agent handoff](docs/agent-handoff.md) first. It contains the complete product decisions, exact files, security requirements, environment settings, test expectations and production plan so no chat memory is required.

- [Authentication architecture and API contract](docs/authentication-architecture.md)
- [Authentication API routes](docs/api.md)

## LMS architecture

See:
- [LMS architecture](docs/lms-architecture.md)
- [Implementation status](docs/implementation-status.md)
- [Deployment and operations](docs/deployment.md)
- [API foundation](docs/api.md)
- [Security and privacy rules](docs/security.md)

## Repository layout

- `index.html` — existing PROCTORAVA assessment application
- `assets/img/` — existing brand marks, assessment covers, hero art and seals
- `fonts/` — Inter and Lora fonts (see `FONTS-LICENSE.txt`)
- `worker/src/index.ts` — Cloudflare Worker API router
- `worker/src/auth.ts` — passwordless email OTP, SES delivery, signed sessions and role checks
- `worker/migrations/` — ordered D1 schema migrations, including authentication sessions
- `docs/` — architecture, implementation status and deployment guidance

## Important production notes

The LMS API is separate from the Cloudflare Pages frontend. Authentication code now supports learner, organization/educator and Super Admin email OTP, but production authentication remains pending until D1, the Worker, SES sender credentials, secrets and full end-to-end tests are provisioned. Do not claim it is live before those checks pass. Do not place secrets in this repository or browser code. Use staging and test role isolation before routing real learners.

The LMS validation workflow checks Worker TypeScript, applies all D1 migrations including authentication sessions to a clean SQLite database, checks the OTP schema constraints, validates the frontend login contract, confirms all twelve first-party assessments exist and confirms they cannot be changed or deleted.

## Integration boundary

External services and connectors must remain behind clearly defined service boundaries. Keep connector credentials in protected secret storage, never in frontend code or committed configuration. Connector-specific setup and any integration mixing or exceptions must be documented here in the README footer, not embedded as unrelated logic in application files.


## Design assets
- [SVG and icon guidelines](docs/visual-icon-guidelines.md) — shared outline icon style, theme behavior and accessibility rules.

---

**MCP-ISO connector note:** The connector is not available in the current connected tool set, so no live MCP-ISO connection is claimed. Keep any future connector-specific setup or exceptions documented here in this README footer; do not mix connector-specific code into the application UI or core logic.
