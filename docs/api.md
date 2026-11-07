# Proctify API Foundation

Base path: `/api`. All API responses are JSON. The Worker is a separate deployment from the Cloudflare Pages frontend.

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
| `POST /organizations/{id}/courses/{courseId}/publish` | Publish a course after it has at least one module and lesson | Owner, administrator or publisher |
| `POST /organizations/{id}/courses/{courseId}/archive` | Archive a published course while preserving current learner access | Owner, administrator or publisher |
| `POST /organizations/{id}/courses/{courseId}/modules` | Add a curriculum module to a draft course | Owner, administrator, publisher or instructor |
| `POST /organizations/{id}/modules/{moduleId}/lessons` | Add a lesson to a draft module | Owner, administrator, publisher or instructor |
| `POST /organizations/{id}/courses/{courseId}/assignments` | Add an assignment to a draft course | Owner, administrator, publisher or assigned instructor |
| `GET /organizations/{id}/members` | View active organization member directory | Owner or administrator |
| `POST /organizations/{id}/members` | Add an existing verified Proctify account to the organization | Owner or administrator; only owner can assign administrators |
| `GET /organizations/{id}/courses/{courseId}/enrollments` | View course learners and completion totals | Owner, administrator, publisher or assigned instructor/reviewer |
| `POST /organizations/{id}/courses/{courseId}/enrollments` | Enroll an active organization learner in a free published course | Owner, administrator or publisher |
| `POST /organizations/{id}/courses/{courseId}/staff` | Assign an existing organization instructor or reviewer to a course | Owner or administrator |
| `GET /organizations/{id}/courses` | List courses visible to the signed-in organization member | Owner, administrator, publisher or assigned course staff |
| `POST /organizations/{id}/assignments/{assignmentId}/review` | Grade and provide feedback on a submission | Owner, administrator or assigned instructor/reviewer |
| `GET /learners/me/enrollments` | List the learner's courses and lesson completion counts | Signed-in learner |
| `GET /courses/{courseId}/assignments` | View assignments and own submission status | Enrolled learner |
| `GET /assessments/catalog` | List the Proctify-owned assessment catalog | Public; read-only |
| `GET /courses/{courseId}/curriculum` | Read published curriculum; non-enrolled learners see preview lessons only | Signed-in learner |
| `POST /courses/{courseId}/enroll` | Enroll in a free published course | Signed-in learner |
| `POST /enrollments/{id}/progress` | Save lesson progress for the signed-in learner | Enrollment owner |
| `POST /assignments/{id}/submissions` | Submit or resubmit an assignment | Enrolled learner |

## Educator and organization group endpoints

| Method and path | Purpose | Required role |
|---|---|---|
| `GET /organizations/{id}/groups` | List groups and sections visible to the signed-in organization user | Owner, administrator or assigned instructor |
| `POST /organizations/{id}/groups` | Create a class, cohort, department or section | Owner or administrator |
| `GET /organizations/{id}/groups/{groupId}/educators` | List educators assigned to a group | Group educator or organization administrator |
| `POST /organizations/{id}/groups/{groupId}/educators` | Assign an active organization instructor to a group | Owner or administrator |
| `GET /organizations/{id}/groups/{groupId}/learners` | View the group's learner roster | Group educator or organization administrator |
| `POST /organizations/{id}/groups/{groupId}/learners` | Add an active organization learner to a group | Owner or administrator |
| `GET /organizations/{id}/groups/{groupId}/courses` | View subjects/courses assigned to a group | Group educator or organization administrator |
| `POST /organizations/{id}/groups/{groupId}/courses` | Assign a published course to the group and enroll current group learners | Owner or administrator; paid seats require checkout |
| `GET /organizations/{id}/groups/{groupId}/activities` | List assigned learning activities and deadlines | Group educator or organization administrator |
| `POST /organizations/{id}/groups/{groupId}/activities` | Add a lesson or assignment activity from a course already assigned to the group | Group educator or organization administrator |
| `GET /organizations/{id}/groups/{groupId}/announcements` | Read group announcements | Group educator or organization administrator |
| `POST /organizations/{id}/groups/{groupId}/announcements` | Send an announcement to the group | Group educator or organization administrator |
| `GET /organizations/{id}/groups/{groupId}/messages` | View direct messages in the group conversation | Group educator or organization administrator |
| `POST /organizations/{id}/groups/{groupId}/messages` | Message one learner in the group | Group educator or organization administrator |
| `POST /organizations/{id}/learners/{learnerId}/messages` | Message an active learner in the same organization | Owner, administrator or instructor |
| `GET /learners/me/messages` | Read messages addressed to the signed-in learner | Signed-in learner |
| `GET /learners/me/groups` | List the learner's active groups and sections | Signed-in learner |
| `GET /learners/me/groups/{groupId}/announcements` | Read announcements for one of the learner's groups | Group learner |
| `POST /learners/me/groups/{groupId}/messages` | Send a private reply to an educator assigned to the group | Group learner |

Group course assignment only accepts published Proctify courses or published courses owned by the same organization. Paid courses cannot be assigned without a completed platform checkout. Learners must already be active members of the organization. Educators can only access groups explicitly assigned to them; organization administrators can manage all groups in their organization.

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

The token issuer must verify the user's email and include the signed `email_verified: true` claim before issuing a token. The Worker stores a new user only after token verification, then checks that the account is still active on every request. It does not silently reactivate suspended accounts or overwrite an existing account's email. Organization membership and assigned course-staff access are checked in D1 on each organization action. Super Admin status is read from the private `platform_admins` table; it is not accepted from a browser role selector or untrusted token claim.

## Current implementation limits

This is an API foundation, not a complete LMS service. Course module/lesson/assignment editing, free enrollment, preview-aware curriculum access, lesson progress, assignment submission and review, organization course lists, assigned course staff, learner enrollment summaries and a read-only Proctify assessment catalog are included. The educator group APIs now cover group/section creation, educator assignment, learner rosters, course assignment, lesson/assignment activities, group announcements and direct learner messages. A learner inbox endpoint is available. The static application still needs its educator and learner messaging screens wired to these endpoints. Assignment grading, assessment-session integration, email OTP delivery, SES notifications, payment checkout/webhooks, payout execution, custom-domain routing, file upload/download signing, and the final three login screens still require implementation and provider configuration. Paid course enrollment returns a clear checkout-required response until a payment provider is connected. Organization bulk enrollment is limited to free courses and existing active learner members so it cannot bypass platform checkout. Payment status must never be accepted from a browser request.

## Authentication endpoints

| Method and path | Purpose | Protection |
|---|---|---|
| `POST /auth/challenge` | Request a six-digit email code | Public; D1 email/IP rate limits; SES delivery |
| `POST /auth/verify` | Verify a code and issue a session | Public; challenge, expiry, attempt and one-use checks |
| `GET /auth/me` | Read current user, organization memberships and platform-admin status | Signed-in bearer session |
| `POST /auth/logout` | Revoke the current session | Signed-in bearer session |

Challenge body: `{"email":"person@example.com","audience":"learner"}`. Audience is `learner`, `organization` or `admin`. Optional `organizationId` can narrow organization access.

Verification body: `{"email":"person@example.com","challengeId":"...","code":"123456"}`. A successful response returns a signed bearer token, expiry and server-determined role. The browser must never submit a trusted role.

Learner and organization sessions last 12 hours; Super Admin sessions last 4 hours. Each issued token has a D1 session ID, checked on every protected request. Logout revokes the session. Tokens are held in `sessionStorage`, not `localStorage`.

See [Authentication architecture](authentication-architecture.md) for full request/response examples, rate limits, SES settings, error codes and production blockers. Production sign-in is not live until the Worker, D1, SES credentials and sender verification are deployed and tested.
