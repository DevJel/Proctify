# Proctify Security and Privacy Rules

## Access rules
- Every signed-in API request must have a valid, unexpired token from the configured identity issuer.
- Organization actions must check active membership and the required role in D1.
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
- Log security events without storing passwords, OTPs, bearer tokens or full identity documents.
- Back up D1 and periodically test restoration.
- Monitor unusual login attempts, cross-organization access denials and payout changes.
