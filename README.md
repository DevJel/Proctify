# Proctify

**Proctored, Verified Assessments and Learning Management**

Proctify brings together twelve first-party assessments, proctored skills testing, verified results and a multi-organization learning marketplace. Schools, companies and independent publishers can manage their own courses after verification, while Proctify retains ownership and control of its assessment and certification catalog.

By Operava Global Solutions.

## Current application

The existing assessment experience and its visual assets are preserved as the baseline. The configured GitHub Pages address is:

**https://devjel.github.io/Proctify/**

The latest GitHub Pages deployment workflow for the merged `main` commit reported failure. Verify the deployment in GitHub Actions before assuming the current site reflects the latest repository changes.

GitHub Pages publishes the static frontend from the repository root. It does not host the API, database, authentication, email delivery or payment processing.

## LMS architecture

See:
- [LMS architecture](docs/lms-architecture.md)
- [Implementation status](docs/implementation-status.md)
- [Deployment and operations](docs/deployment.md)
- [API foundation](docs/api.md)
- [Security and privacy rules](docs/security.md)

## Repository layout

- `index.html` — existing Proctify assessment application
- `assets/img/` — existing brand marks, assessment covers, hero art and seals
- `fonts/` — Inter and Lora fonts (see `FONTS-LICENSE.txt`)
- `worker/` — Cloudflare Worker API foundation and D1 migration
- `docs/` — architecture, implementation status and deployment guidance

## Important production notes

The LMS API foundation is separate from the GitHub Pages deployment. Provision D1, R2, identity verification, Turnstile, SES and a payment provider before enabling the related production features. Do not place secrets in this repository or browser code. Use staging and test role isolation before routing real learners.

The LMS validation workflow checks Worker TypeScript installation/type checking, applies the database migration to a clean SQLite database, confirms all twelve first-party assessment records exist, and confirms those records cannot be updated or deleted.

## Integration boundary

External services and connectors must remain behind clearly defined service boundaries. Keep connector credentials in protected secret storage, never in frontend code or committed configuration. The MCP-ISO connector is not currently available in the connected tool set for this repository; no claim of a live MCP-ISO connection is made. Keep its future adapter and credentials separate from application code. Connector-specific setup and any integration mixing or exceptions must be documented here in the README footer, not embedded as unrelated logic in application files.


## Design assets
- [SVG and icon guidelines](docs/visual-icon-guidelines.md) — shared outline icon style, theme behavior and accessibility rules.

---

**MCP-ISO connector note:** The MCP-ISO connector is not exposed in the current connected tool set, so no live connector use is claimed for this change. Keep any future connector-specific setup, adapters or exceptions documented here in the README footer; do not mix connector-specific code into the application UI or core logic.
