# PROCTORAVA

**Learning Management, Proctored Assessments and Verified Credentials**

PROCTORAVA brings together twelve first-party assessments, proctored skills testing, verified results and a multi-organization learning marketplace. Schools, companies and independent publishers can manage their own courses after verification, while PROCTORAVA retains ownership and control of its assessment and certification catalog.

By Operava Global Solutions.

## Current application

**Production site: https://proctorava.pages.dev**

The frontend is hosted by Cloudflare Pages in the **Proctorava and HRIS app** Cloudflare account. The project is connected to this repository and deploys the `main` branch automatically. GitHub Pages deployment has been removed; GitHub remains the source-code repository only.

Cloudflare Pages hosts the static frontend. The API, database, authentication, email delivery and payment services remain separate and must be configured and deployed independently.

## Experience and access review

- [Responsive, accessibility, PWA and authentication readiness review](docs/experience-access-review.md)

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
- `worker/` — Cloudflare Worker API foundation and D1 migration
- `docs/` — architecture, implementation status and deployment guidance

## Important production notes

The LMS API foundation is separate from the GitHub Pages deployment. Provision D1, R2, identity verification, Turnstile, SES and a payment provider before enabling the related production features. Do not place secrets in this repository or browser code. Use staging and test role isolation before routing real learners.

The LMS validation workflow checks Worker TypeScript installation/type checking, applies the database migration to a clean SQLite database, confirms all twelve first-party assessment records exist, and confirms those records cannot be updated or deleted.

## Integration boundary

External services and connectors must remain behind clearly defined service boundaries. Keep connector credentials in protected secret storage, never in frontend code or committed configuration. Connector-specific setup and any integration mixing or exceptions must be documented here in the README footer, not embedded as unrelated logic in application files.


## Design assets
- [SVG and icon guidelines](docs/visual-icon-guidelines.md) — shared outline icon style, theme behavior and accessibility rules.

---

**MCP-ISO connector note:** The connector is not available in the current connected tool set, so no live MCP-ISO connection is claimed. Keep any future connector-specific setup or exceptions documented here in this README footer; do not mix connector-specific code into the application UI or core logic.
