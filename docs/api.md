# Proctify API Foundation

Base path: `/api`. All API responses are JSON. The Worker is a separate deployment from GitHub Pages.

## Public endpoints

| Method and path | Purpose | Protection |
|---|---|---|
| `GET /health` | Service and configuration status | Public; reveals no secrets |
| `POST /organization-applications` | Submit a school, company or publisher application | Turnstile required |
| `GET /marketplace/courses` | List published courses | Public; only eligible courses returned |
| `GET /marketplace/courses/{slug}` | Read a published course detail page | Public; only eligible courses returned |
| `GET /certificates/{verificationCode}` | Verify certificate status | Public; returns limited verification details |

## Signed-in endpoints

| Method and path | Purpose | Required role |
|---|---|---|
| `POST /organizations/{id}/claim` | Claim verified organization using matching verified email | Applicant matching organization owner email |
| `POST /organizations/{id}/courses` | Create an organization-owned draft course | Owner, administrator or publisher |
| `POST /organizations/{id}/courses/{courseId}/publish` | Publish an organization course | Owner, administrator or publisher |

## Super Admin endpoints

| Method and path | Purpose | Required role |
|---|---|---|
| `GET /admin/organization-applications` | View applications awaiting review | Active platform admin |
| `POST /admin/organization-applications/{id}/decision` | Verify or reject an application | Active platform admin |

Decision body example:

```json
{ "decision": "verify", "note": "Organization details checked." }
```

Only the API can create a verified organization. The public application endpoint never grants publishing access.

## Identity token requirements

Protected endpoints require a bearer token signed with HS256 by the configured identity issuer. The Worker checks:
- signature and algorithm;
- issuer and audience;
- subject and email;
- expiration.

The token issuer must verify the user's email before issuing a token. The Worker stores the authenticated user identity and checks organization membership in D1 on each organization action. Super Admin status is read from the private `platform_admins` table; it is not accepted from a browser role selector or untrusted token claim.

## Current implementation limits

This is an API foundation, not a complete LMS service. Course module editing, lesson player progress APIs, assignment grading, assessment-session integration, email OTP delivery, SES notifications, payment checkout/webhooks, payout execution, custom-domain routing, file upload/download signing, and the final three login screens still require implementation and provider configuration. Payment status must never be accepted from a browser request.
