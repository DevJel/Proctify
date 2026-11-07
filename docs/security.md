# Proctify Security and Privacy Rules

## Access rules
- Every signed-in API request must have a valid, unexpired token from the configured identity issuer, with a signed `email_verified: true` claim.
- Suspended or deleted accounts must be rejected even if an old token has not expired.
- Existing account email addresses must not be silently overwritten by a new token claim.
- Organization actions must check active membership and the required role in D1.
- Instructor and reviewer permissions must be limited to courses explicitly assigned to them; organization-wide publisher and administrator roles are separately checked.
- Organization data must be filtered by organization ID in the database query itself.
- Super Admin actions must check the private platform administrator table.
- Never grant permissions from URL parameters, local storage, hidden buttons or user-submitted role names.
- The first Super Admin is bootstrapped privately after identity verification. No public endpoint can create one.

## Proctify assessment protection
- Assessment IDs and ownership are first-party records.
- Organization users may assign or purchase access but cannot change questions, scoring, reports, proctoring rules or certification policy.
- Attempts must be tied to the learner and any applicable organization.
- Preserve assessment history when course or organization records change.
- Keep answer keys and scoring rules out of public marketplace responses.

## Privacy and proctoring
- Explain what identity, camera, microphone, screen and browser activity is collected before an assessment begins.
- Obtain explicit consent before starting proctoring.
- Record the purpose, retention period and access policy for every sensitive recording.
- Restrict recordings to specifically authorized reviewers; log every access.
- Do not expose recordings or raw identity documents through public URLs.
- Public certificate verification should reveal only the minimum learner identity needed for verification; the API masks the learner's surname.
- Provide an appeal and human review path for proctoring flags.
- Set retention periods by data type and jurisdiction; do not assume one retention period fits every customer.

## Payments
- Verify provider webhook signatures against the raw request body.
- Deduplicate events by provider and provider event ID.
- Use idempotency keys for checkout creation and payout requests.
- Reconcile gross sales, platform fees, refunds, chargebacks and payouts.
- Require additional approval for payout destination changes and large payouts.
- Never store card numbers or security codes.

## Operational controls
- Keep secrets outside source control and browser bundles.
- Use separate staging and production databases and buckets.
- Apply least-privilege access to D1, R2, SES and payment services.
- Rate-limit registration, login, certificate lookup and sensitive actions.
- Validate Turnstile success against the requesting site's hostname; do not accept a successful challenge issued for a different website.
- Limit instructor/reviewer access to the courses explicitly assigned to them, including learner lists and submission reviews.
- Log security events without storing passwords, OTPs, bearer tokens or full identity documents.
- Back up D1 and periodically test restoration.
- Monitor unusual login attempts, cross-organization access denials and payout changes.

## Passwordless email OTP and sessions

- Use separate cryptographically random `AUTH_OTP_SECRET` and `AUTH_JWT_SECRET` values (minimum 32 characters each).
- Store only a keyed HMAC of the OTP, challenge ID and keyed email hash. Never store or log the code.
- Six-digit OTP expires after ten minutes, is single-use and allows at most five attempts.
- Enforce a 60-second resend delay, maximum five requests per email and twenty per IP per 15 minutes. Add Cloudflare edge rate limiting and bot protection before public launch.
- Challenge responses must not reveal whether an email has a role or account.
- Send through SES v2 with a dedicated least-privilege sender identity and AWS credentials held only as Worker secrets.
- Learner and organization sessions expire after 12 hours; Super Admin after 4 hours.
- Check the matching D1 session on every request and revoke it on logout.
- Keep bearer tokens in session-scoped browser storage. Never place them in URLs, logs or analytics.
- Reject suspended accounts, non-members, unverified organizations, inactive platform admins, expired codes, reused codes, revoked sessions and mismatched session audiences.
- Bootstrap Super Admin privately; no public endpoint may grant the role.
- Super Admin currently has an allow-list and shorter session but no independent second factor. Add WebAuthn/TOTP or an approved access gateway before enabling high-impact platform controls.

See [Authentication architecture](authentication-architecture.md) and [Agent handoff](agent-handoff.md).
