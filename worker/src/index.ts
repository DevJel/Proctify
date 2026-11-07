import { authenticate, handlePublicAuthRoute, type Actor } from "./auth";

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  APP_ORIGIN: string;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWT_SECRET?: string;
  AUTH_OTP_SECRET?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  SES_FROM_EMAIL?: string;
  TURNSTILE_SECRET?: string;
}


const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status: number, code: string, message: string) => json({ ok: false, error: { code, message } }, status);
const id = () => crypto.randomUUID();
const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const positionValue = (value: unknown) => {
  const number = value == null ? 0 : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100_000, Math.floor(number))) : 0;
};

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.APP_ORIGIN || "").split(",").map(v => v.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { "vary": "Origin" };
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Content-Type,Authorization,CF-Turnstile-Token", "access-control-max-age": "86400", "vary": "Origin" };
}

async function readJson(request: Request): Promise<any> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 32_000) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (text.length > 32_000) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(text || "{}");
}


async function requireMember(env: Env, actor: Actor, organizationId: string, roles: string[]) {
  const row = await env.DB.prepare("SELECT m.role,o.status FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active'").bind(organizationId, actor.id).first<{ role: string; status: string }>();
  return !!row && row.status === "verified" && roles.includes(row.role);
}

async function requireCourseAccess(env: Env, actor: Actor, organizationId: string, courseId: string, organizationRoles: string[], courseRoles: string[]) {
  const member = await env.DB.prepare("SELECT m.role,o.status FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active'")
    .bind(organizationId, actor.id).first<{role:string;status:string}>();
  if (!member || member.status !== "verified") return false;
  if (organizationRoles.includes(member.role)) return true;
  if (!courseRoles.includes(member.role)) return false;
  const staff = await env.DB.prepare("SELECT role FROM course_staff WHERE course_id=? AND user_id=?").bind(courseId, actor.id).first<{role:string}>();
  return !!staff && courseRoles.includes(staff.role);
}

async function verifyTurnstile(request: Request, env: Env, token: string) {
  if (!env.TURNSTILE_SECRET || !token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
  const origin = request.headers.get("Origin");
  let expectedHostname = new URL(request.url).hostname;
  if (origin) {
    try { expectedHostname = new URL(origin).hostname; } catch { return false; }
  }
  return response.ok && result.success === true && result.hostname === expectedHostname && (!result.action || result.action === "organization_application");
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();

  const publicAuthResponse = await handlePublicAuthRoute(request, env);
  if (publicAuthResponse) return publicAuthResponse;

  if (method === "GET" && path === "/api/health") {
    await env.DB.prepare("SELECT 1 AS ready").first();
    return json({ ok: true, service: "proctify-lms-api", mode: "connected", capabilities: { database: true, identity: Boolean(env.AUTH_JWT_SECRET && env.AUTH_OTP_SECRET), registration: Boolean(env.TURNSTILE_SECRET), payments: false, email: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.SES_FROM_EMAIL) } });
  }

  if (method === "POST" && path === "/api/organization-applications") {
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the information and try again."); }
    const name = String(body.organizationName || "").trim().slice(0, 160);
    const applicant = String(body.applicantName || "").trim().slice(0, 120);
    const email = String(body.applicantEmail || "").trim().toLowerCase().slice(0, 254);
    const type = String(body.organizationType || "");
    const slug = slugify(String(body.slug || name));
    if (!name || !applicant || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !slug || !["school","company","independent_publisher"].includes(type)) return fail(422, "VALIDATION_ERROR", "Enter a valid organization name, type and contact email.");
    const token = String(body.turnstileToken || request.headers.get("CF-Turnstile-Token") || "");
    if (!await verifyTurnstile(request, env, token)) return fail(403, "HUMAN_CHECK_FAILED", "Please complete the security check and try again.");
    const applicationId = id();
    try {
      await env.DB.prepare("INSERT INTO organization_applications(id,organization_name,slug,organization_type,applicant_name,applicant_email,website,country_code,registration_reference) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(applicationId, name, slug, type, applicant, email, String(body.website || "").slice(0, 240) || null, String(body.countryCode || "").slice(0, 2) || null, String(body.registrationReference || "").slice(0, 120) || null).run();
    } catch (error) {
      return fail(409, "APPLICATION_CONFLICT", "An application with this organization address may already exist.");
    }
    return json({ ok: true, applicationId, status: "pending", message: "Your organization application has been received. Publishing remains locked until verification." }, 201);
  }

  if (method === "GET" && path === "/api/assessments/catalog") {
    const catalog = await env.DB.prepare("SELECT assessment_id,title,category,catalog_version FROM proctify_assessments WHERE active=1 ORDER BY category,title").all();
    return json({ ok: true, owner: "Proctify", assessments: catalog.results || [] });
  }

  if (method === "GET" && path === "/api/marketplace/courses") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 24), 1), 60);
    const query = "%" + String(url.searchParams.get("q") || "").trim().slice(0, 80) + "%";
    const result = await env.DB.prepare("SELECT c.id,c.slug,c.title,c.short_description,c.category,c.level,c.price_minor,c.currency,c.certificate_enabled,o.name AS publisher_name,o.slug AS publisher_slug FROM courses c LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.status='published' AND (c.owner_type='proctify' OR o.status='verified') AND (?='%%' OR c.title LIKE ? OR c.short_description LIKE ? OR c.category LIKE ?) ORDER BY c.published_at DESC LIMIT ?")
      .bind(query, query, query, query, limit).all();
    return json({ ok: true, courses: result.results || [] });
  }

  const courseMatch = path.match(/^\/api\/marketplace\/courses\/([a-z0-9-]{1,80})$/);
  if (method === "GET" && courseMatch) {
    const course = await env.DB.prepare("SELECT c.id,c.slug,c.title,c.short_description,c.description,c.category,c.language_code,c.level,c.price_minor,c.currency,c.certificate_enabled,c.published_at,o.name AS publisher_name,o.slug AS publisher_slug FROM courses c LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.slug=? AND c.status='published' AND (c.owner_type='proctify' OR o.status='verified') LIMIT 1")
      .bind(courseMatch[1]).first();
    if (!course) return fail(404, "COURSE_NOT_FOUND", "This course is not available.");
    return json({ ok: true, course });
  }

  const certificateMatch = path.match(/^\/api\/certificates\/([A-Za-z0-9-]{6,100})$/);
  if (method === "GET" && certificateMatch) {
    const certificate = await env.DB.prepare("SELECT c.verification_code,c.title,c.issued_at,c.expires_at,c.revoked_at,u.display_name AS learner_name,CASE WHEN c.issuer_type='proctify' THEN 'Proctify' ELSE o.name END AS issuer_name FROM certificates c JOIN users u ON u.id=c.learner_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.verification_code=?").bind(certificateMatch[1]).first();
    if (!certificate) return fail(404, "CERTIFICATE_NOT_FOUND", "No certificate matches this verification code.");
    const record = certificate as any;
    return json({ ok: true, certificate: { ...record, valid: !record.revoked_at && (!record.expires_at || new Date(record.expires_at).getTime() > Date.now()) } });
  }

  const actor = await authenticate(request, env);
  if (!actor) return fail(401, "AUTH_REQUIRED", "Please sign in with an approved PROCTORAVA account.");

  if (method === "POST" && path === "/api/auth/logout") {
    if (actor.sessionId) {
      await env.DB.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND revoked_at IS NULL")
        .bind(actor.sessionId, actor.id).run();
    }
    return json({ ok: true, signedOut: true });
  }

  if (method === "GET" && path === "/api/auth/me") {
    const admin = await env.DB.prepare("SELECT status FROM platform_admins WHERE user_id=?")
      .bind(actor.id).first<{ status: string }>();
    const orgRows = await env.DB.prepare("SELECT o.id,o.name,o.slug,m.role FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.status='active' AND o.status='verified' ORDER BY o.name")
      .bind(actor.id).all();
    return json({ ok: true, user: { id: actor.id, email: actor.email, name: actor.name }, platformAdmin: admin?.status === "active", organizations: orgRows.results || [], session: { audience: actor.loginAudience || null } });
  }

  if (method === "GET" && path === "/api/admin/organization-applications") {
    const admin = await env.DB.prepare("SELECT status FROM platform_admins WHERE user_id=?").bind(actor.id).first<{status:string}>();
    if (!admin || admin.status !== "active") return fail(403, "SUPER_ADMIN_REQUIRED", "This action is restricted to Proctify Super Admins.");
    const rows = await env.DB.prepare("SELECT id,organization_name,slug,organization_type,applicant_name,applicant_email,website,country_code,registration_reference,verification_status,created_at FROM organization_applications WHERE verification_status IN ('pending','in_review') ORDER BY created_at ASC LIMIT 100").all();
    return json({ ok: true, applications: rows.results || [] });
  }

  const decisionMatch = path.match(/^\/api\/admin\/organization-applications\/([A-Za-z0-9-]+)\/decision$/);
  if (method === "POST" && decisionMatch) {
    const admin = await env.DB.prepare("SELECT status FROM platform_admins WHERE user_id=?").bind(actor.id).first<{status:string}>();
    if (!admin || admin.status !== "active") return fail(403, "SUPER_ADMIN_REQUIRED", "This action is restricted to Proctify Super Admins.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the review decision."); }
    const decision = String(body.decision || "");
    if (!["verify","reject"].includes(decision)) return fail(422, "INVALID_DECISION", "Choose verify or reject.");
    const application = await env.DB.prepare("SELECT * FROM organization_applications WHERE id=?").bind(decisionMatch[1]).first<any>();
    if (!application || !["pending","in_review"].includes(application.verification_status)) return fail(404, "APPLICATION_NOT_REVIEWABLE", "This application is not awaiting review.");
    if (decision === "verify") {
      const organizationId = id();
      try {
        const results = await env.DB.batch([
          env.DB.prepare("INSERT INTO organizations(id,application_id,name,slug,organization_type,owner_email) SELECT ?,id,organization_name,slug,organization_type,applicant_email FROM organization_applications WHERE id=? AND verification_status IN ('pending','in_review')")
            .bind(organizationId, application.id),
          env.DB.prepare("UPDATE organization_applications SET verification_status='verified',reviewer_id=?,reviewer_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND verification_status IN ('pending','in_review')")
            .bind(actor.id, String(body.note || "").slice(0, 1000), application.id),
          env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,target_type,target_id,detail_json) SELECT ?,?,?,?, ?,? WHERE EXISTS (SELECT 1 FROM organization_applications WHERE id=? AND verification_status='verified' AND reviewer_id=?)")
            .bind(id(), actor.id, "organization.verified", "organization_application", application.id, JSON.stringify({organizationId}), application.id, actor.id)
        ]);
        if (!results[0].meta.changes || !results[1].meta.changes) return fail(409, "APPLICATION_ALREADY_REVIEWED", "This application has already been reviewed or could not be verified.");
      } catch {
        return fail(409, "ORGANIZATION_CONFLICT", "The organization could not be created. Check whether its name or address is already in use.");
      }
      return json({ ok: true, status: "verified", organizationId });
    }
    const rejected = await env.DB.batch([
      env.DB.prepare("UPDATE organization_applications SET verification_status='rejected',reviewer_id=?,reviewer_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND verification_status IN ('pending','in_review')")
        .bind(actor.id, String(body.note || "").slice(0, 1000), application.id),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,target_type,target_id) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM organization_applications WHERE id=? AND verification_status='rejected' AND reviewer_id=?)")
        .bind(id(), actor.id, "organization.rejected", "organization_application", application.id, application.id, actor.id)
    ]);
    if (!rejected[0].meta.changes) return fail(409, "APPLICATION_ALREADY_REVIEWED", "This application has already been reviewed.");
    return json({ ok: true, status: "rejected" });
  }

  const claimMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/claim$/);
  if (method === "POST" && claimMatch) {
    const org = await env.DB.prepare("SELECT id,owner_email,status FROM organizations WHERE id=?").bind(claimMatch[1]).first<{id:string;owner_email:string;status:string}>();
    if (!org || org.status !== "verified" || org.owner_email.toLowerCase() !== actor.email) return fail(403, "CLAIM_NOT_ALLOWED", "This organization cannot be claimed by this account.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES(?,?, 'owner','active') ON CONFLICT(organization_id,user_id) DO UPDATE SET role='owner',status='active'")
        .bind(org.id, actor.id),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)")
        .bind(id(), actor.id, org.id, "organization.owner.claimed", "organization", org.id)
    ]);
    return json({ ok: true, organizationId: org.id, role: "owner" });
  }

  const membersMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/members$/);
  if (method === "GET" && membersMatch) {
    const orgId = membersMatch[1];
    if (!await requireMember(env, actor, orgId, ["owner","administrator"])) return fail(403, "MEMBER_ADMIN_REQUIRED", "Only organization owners and administrators can view the member directory.");
    const members = await env.DB.prepare("SELECT u.id,u.email,u.display_name,u.status AS account_status,m.role,m.status,m.created_at FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 WHEN 'publisher' THEN 2 WHEN 'instructor' THEN 3 WHEN 'reviewer' THEN 4 ELSE 5 END,u.display_name LIMIT 250")
      .bind(orgId).all();
    return json({ ok: true, members: members.results || [] });
  }

  if (method === "POST" && membersMatch) {
    const orgId = membersMatch[1];
    const owner = await requireMember(env, actor, orgId, ["owner"]);
    const admin = owner || await requireMember(env, actor, orgId, ["administrator"]);
    if (!admin) return fail(403, "MEMBER_ADMIN_REQUIRED", "Only organization owners and administrators can add members.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the member details."); }
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "");
    const allowed = owner ? ["administrator","publisher","instructor","reviewer","learner"] : ["publisher","instructor","reviewer","learner"];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowed.includes(role)) return fail(422, "INVALID_MEMBER", "Enter a verified account email and a role you are allowed to assign.");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND status='active'").bind(email).first<{id:string}>();
    if (!user) return fail(404, "ACCOUNT_NOT_FOUND", "The person must first create and verify a Proctify learner account.");
    const result = await env.DB.prepare("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES(?,?,?,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,status='active' WHERE organization_members.role!='owner'")
      .bind(orgId, user.id, role).run();
    if (!result.meta.changes) return fail(409, "OWNER_PROTECTED", "The organization owner role cannot be changed from the member directory.");
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id,detail_json) VALUES(?,?,?,?,?,?,?)")
      .bind(id(), actor.id, orgId, "organization.member.added_or_updated", "organization_member", user.id, JSON.stringify({email,role})).run();
    return json({ ok: true, userId: user.id, email, role }, 201);
  }

  const createCourse = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses$/);
  if (method === "POST" && createCourse) {
    const orgId = createCourse[1];
    if (!await requireMember(env, actor, orgId, ["owner","administrator","publisher"])) return fail(403, "PUBLISH_PERMISSION_REQUIRED", "Only an authorized publisher in a verified organization can create courses.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the course information."); }
    const title = String(body.title || "").trim().slice(0, 180);
    const slug = slugify(String(body.slug || title));
    if (!title || !slug) return fail(422, "COURSE_DETAILS_REQUIRED", "A course title is required.");
    const priceMinor = body.priceMinor == null ? 0 : Number(body.priceMinor);
    const currency = String(body.currency || "USD").toUpperCase();
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 0 || !/^[A-Z]{3}$/.test(currency)) return fail(422, "INVALID_PRICE", "Enter a valid whole-number price in minor currency units and a three-letter currency code.");
    const courseId = id();
    try {
      await env.DB.prepare("INSERT INTO courses(id,organization_id,owner_type,slug,title,short_description,description,category,language_code,level,price_minor,currency,certificate_enabled,created_by) VALUES(?,?,'organization',?,?,?,?,?,?,?,?,?,?,?)")
        .bind(courseId, orgId, slug, title, String(body.shortDescription || "").slice(0, 280), String(body.description || "").slice(0, 12000), String(body.category || "General").slice(0, 80), String(body.languageCode || "en").slice(0, 8), String(body.level || "all_levels").slice(0, 30), priceMinor, currency, body.certificateEnabled === true ? 1 : 0, actor.id).run();
    } catch {
      return fail(409, "COURSE_SLUG_CONFLICT", "That course address is already in use. Choose a different course address.");
    }
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.created", "course", courseId).run();
    return json({ ok: true, courseId, status: "draft" }, 201);
  }

  const assignStaffMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/staff$/);
  if (method === "POST" && assignStaffMatch) {
    const [, orgId, courseId] = assignStaffMatch;
    if (!await requireMember(env, actor, orgId, ["owner","administrator"])) return fail(403, "STAFF_ADMIN_REQUIRED", "Only organization owners and administrators can assign course staff.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the staff assignment."); }
    const userId = String(body.userId || "");
    const role = String(body.role || "");
    if (!userId || !["instructor","reviewer"].includes(role)) return fail(422, "INVALID_STAFF_ASSIGNMENT", "Choose an existing organization member and an instructor or reviewer role.");
    const course = await env.DB.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND owner_type='organization'").bind(courseId, orgId).first();
    if (!course) return fail(404, "COURSE_NOT_FOUND", "This course does not belong to the organization.");
    const member = await env.DB.prepare("SELECT m.user_id,m.role FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND u.status='active'").bind(orgId, userId).first<{user_id:string;role:string}>();
    if (!member || member.role !== role) return fail(404, "ACTIVE_MEMBER_REQUIRED", "The person must already be an active organization member with the matching instructor or reviewer role.");
    await env.DB.prepare("INSERT INTO course_staff(course_id,user_id,role,assigned_by) VALUES(?,?,?,?) ON CONFLICT(course_id,user_id) DO UPDATE SET role=excluded.role,assigned_by=excluded.assigned_by")
      .bind(courseId, userId, role, actor.id).run();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id,detail_json) VALUES(?,?,?,?,?,?,?)")
      .bind(id(), actor.id, orgId, "course.staff.assigned", "course_staff", courseId, JSON.stringify({userId,role})).run();
    return json({ ok: true, courseId, userId, role });
  }

  const orgEnrollmentsMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/enrollments$/);
  if (method === "GET" && orgEnrollmentsMatch) {
    const [, orgId, courseId] = orgEnrollmentsMatch;
    if (!await requireCourseAccess(env, actor, orgId, courseId, ["owner","administrator","publisher"], ["instructor","reviewer"])) return fail(403, "ORGANIZATION_ACCESS_REQUIRED", "You do not have access to this course's learners.");
    const course = await env.DB.prepare("SELECT id FROM courses WHERE id=? AND organization_id=?").bind(courseId, orgId).first();
    if (!course) return fail(404, "COURSE_NOT_FOUND", "This course does not belong to the organization.");
    const rows = await env.DB.prepare("SELECT e.id AS enrollment_id,e.status,e.enrolled_at,u.id AS learner_id,u.display_name,u.email,COUNT(DISTINCT l.id) AS lesson_count,COUNT(DISTINCT CASE WHEN p.status='completed' THEN p.lesson_id END) AS completed_lessons FROM enrollments e JOIN users u ON u.id=e.learner_id LEFT JOIN course_modules m ON m.course_id=e.course_id LEFT JOIN course_lessons l ON l.module_id=m.id LEFT JOIN lesson_progress p ON p.enrollment_id=e.id AND p.lesson_id=l.id WHERE e.course_id=? AND e.organization_id=? GROUP BY e.id ORDER BY e.enrolled_at DESC LIMIT 250")
      .bind(courseId, orgId).all();
    return json({ ok: true, enrollments: rows.results || [] });
  }

  if (method === "POST" && orgEnrollmentsMatch) {
    const [, orgId, courseId] = orgEnrollmentsMatch;
    if (!await requireMember(env, actor, orgId, ["owner","administrator","publisher"])) return fail(403, "ENROLLMENT_ADMIN_REQUIRED", "Only organization owners, administrators and publishers can enroll learners.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the learner details."); }
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(422, "INVALID_LEARNER_EMAIL", "Enter the learner's verified Proctify account email.");
    const course = await env.DB.prepare("SELECT c.id,c.price_minor FROM courses c JOIN organizations o ON o.id=c.organization_id WHERE c.id=? AND c.organization_id=? AND c.owner_type='organization' AND c.status='published' AND o.status='verified'")
      .bind(courseId, orgId).first<{id:string;price_minor:number}>();
    if (!course) return fail(404, "COURSE_NOT_AVAILABLE", "This published course is not available for organization enrollment.");
    if (course.price_minor > 0) return fail(402, "CHECKOUT_REQUIRED", "Paid course seats must be purchased through Proctify checkout before assignment.");
    const learner = await env.DB.prepare("SELECT u.id FROM users u JOIN organization_members m ON m.user_id=u.id WHERE u.email=? COLLATE NOCASE AND u.status='active' AND m.organization_id=? AND m.role='learner' AND m.status='active'")
      .bind(email, orgId).first<{id:string}>();
    if (!learner) return fail(404, "ACTIVE_LEARNER_REQUIRED", "Add the person as an active learner in this organization before enrolling them.");
    const enrollmentId = id();
    await env.DB.prepare("INSERT OR IGNORE INTO enrollments(id,course_id,learner_id,organization_id,source,status) VALUES(?,?,?,?,'organization_assignment','active')")
      .bind(enrollmentId, courseId, learner.id, orgId).run();
    const enrollment = await env.DB.prepare("SELECT id,status,enrolled_at FROM enrollments WHERE course_id=? AND learner_id=?").bind(courseId, learner.id).first();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id,detail_json) VALUES(?,?,?,?,?,?,?)")
      .bind(id(), actor.id, orgId, "course.learner.enrolled", "enrollment", enrollmentId, JSON.stringify({courseId,learnerId:learner.id})).run();
    return json({ ok: true, enrollment }, 201);
  }

  const publishMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/publish$/);
  if (method === "POST" && publishMatch) {
    const [, orgId, courseId] = publishMatch;
    if (!await requireMember(env, actor, orgId, ["owner","administrator","publisher"])) return fail(403, "PUBLISH_PERMISSION_REQUIRED", "Only an authorized publisher in a verified organization can publish courses.");
    const result = await env.DB.prepare("UPDATE courses SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND owner_type='organization' AND status IN ('draft','review') AND EXISTS (SELECT 1 FROM course_modules m JOIN course_lessons l ON l.module_id=m.id WHERE m.course_id=courses.id)").bind(courseId, orgId).run();
    if (!result.meta.changes) return fail(404, "COURSE_NOT_FOUND", "The draft course was not found in this organization.");
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.published", "course", courseId).run();
    return json({ ok: true, courseId, status: "published" });
  }

  if (method === "GET" && path === "/api/learners/me/enrollments") {
    const rows = await env.DB.prepare("SELECT e.id AS enrollment_id,e.status,e.enrolled_at,e.completed_at,c.id AS course_id,c.slug,c.title,c.short_description,c.category,c.level,COUNT(DISTINCT l.id) AS lesson_count,COUNT(DISTINCT CASE WHEN p.status='completed' THEN p.lesson_id END) AS completed_lessons FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN course_modules m ON m.course_id=c.id LEFT JOIN course_lessons l ON l.module_id=m.id LEFT JOIN lesson_progress p ON p.enrollment_id=e.id AND p.lesson_id=l.id WHERE e.learner_id=? AND e.status IN ('active','completed') GROUP BY e.id ORDER BY e.enrolled_at DESC LIMIT 100")
      .bind(actor.id).all();
    return json({ ok: true, enrollments: rows.results || [] });
  }

  const orgCoursesMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses$/);
  if (method === "GET" && orgCoursesMatch) {
    const orgId = orgCoursesMatch[1];
    if (!await requireMember(env, actor, orgId, ["owner","administrator","publisher","instructor","reviewer"])) return fail(403, "ORGANIZATION_ACCESS_REQUIRED", "You do not have access to this organization's courses.");
    const rows = await env.DB.prepare("SELECT c.id,c.slug,c.title,c.status,c.price_minor,c.currency,c.published_at,c.updated_at,COUNT(DISTINCT e.id) AS learner_count FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id WHERE c.organization_id=? AND c.owner_type='organization' AND (EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id=c.organization_id AND m.user_id=? AND m.status='active' AND m.role IN ('owner','administrator','publisher')) OR EXISTS (SELECT 1 FROM course_staff s WHERE s.course_id=c.id AND s.user_id=?)) GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100")
      .bind(orgId, actor.id, actor.id).all();
    return json({ ok: true, courses: rows.results || [] });
  }

  const archiveMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/archive$/);
  if (method === "POST" && archiveMatch) {
    const [, orgId, courseId] = archiveMatch;
    if (!await requireMember(env, actor, orgId, ["owner","administrator","publisher"])) return fail(403, "COURSE_ARCHIVE_PERMISSION_REQUIRED", "Only an authorized organization publisher can archive a course.");
    const result = await env.DB.prepare("UPDATE courses SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND owner_type='organization' AND status='published'").bind(courseId, orgId).run();
    if (!result.meta.changes) return fail(404, "PUBLISHED_COURSE_NOT_FOUND", "Only a published course in this organization can be archived.");
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.archived", "course", courseId).run();
    return json({ ok: true, courseId, status: "archived", existingEnrollmentsPreserved: true });
  }

  const curriculumMatch = path.match(/^\/api\/courses\/([A-Za-z0-9-]+)\/curriculum$/);
  if (method === "GET" && curriculumMatch) {
    const courseId = curriculumMatch[1];
    const enrollment = await env.DB.prepare("SELECT e.id FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE e.course_id=? AND e.learner_id=? AND e.status IN ('active','completed') AND c.status IN ('published','archived') AND (c.owner_type='proctify' OR o.status='verified')").bind(courseId, actor.id).first();
    const rows = await env.DB.prepare("SELECT m.id AS module_id,m.title AS module_title,m.position AS module_position,l.id AS lesson_id,l.title AS lesson_title,l.lesson_type,l.content_json,l.position AS lesson_position,l.is_preview FROM course_modules m JOIN course_lessons l ON l.module_id=m.id JOIN courses c ON c.id=m.course_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.id=? AND c.status IN ('published','archived') AND (c.owner_type='proctify' OR o.status='verified') AND (c.status='published' OR (c.status='archived' AND ?=1)) AND (?=1 OR l.is_preview=1) ORDER BY m.position,l.position")
      .bind(courseId, enrollment ? 1 : 0, enrollment ? 1 : 0).all();
    return json({ ok: true, enrolled: Boolean(enrollment), curriculum: rows.results || [] });
  }

  const assignmentCreate = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/assignments$/);
  if (method === "POST" && assignmentCreate) {
    const [, orgId, courseId] = assignmentCreate;
    if (!await requireCourseAccess(env, actor, orgId, courseId, ["owner","administrator","publisher"], ["instructor"])) return fail(403, "COURSE_EDIT_PERMISSION_REQUIRED", "You do not have permission to add assignments to this course.");
    const course = await env.DB.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND owner_type='organization' AND status='draft'").bind(courseId, orgId).first();
    if (!course) return fail(404, "DRAFT_COURSE_NOT_FOUND", "Assignments can only be added to a draft course in this organization.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the assignment details."); }
    const title = String(body.title || "").trim().slice(0, 180);
    if (!title) return fail(422, "ASSIGNMENT_TITLE_REQUIRED", "An assignment title is required.");
    const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return fail(422, "INVALID_DUE_DATE", "Enter a valid assignment deadline.");
    const maxScore = body.maxScore == null ? null : Number(body.maxScore);
    if (maxScore !== null && (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1_000_000)) return fail(422, "INVALID_MAX_SCORE", "Enter a positive maximum score.");
    const assignmentId = id();
    await env.DB.prepare("INSERT INTO assignments(id,course_id,title,instructions,due_at,max_score) VALUES(?,?,?,?,?,?)")
      .bind(assignmentId, courseId, title, String(body.instructions || "").slice(0, 5000), dueAt ? dueAt.toISOString() : null, maxScore).run();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.assignment.created", "assignment", assignmentId).run();
    return json({ ok: true, assignmentId }, 201);
  }

  const moduleMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/modules$/);
  if (method === "POST" && moduleMatch) {
    const [, orgId, courseId] = moduleMatch;
    if (!await requireCourseAccess(env, actor, orgId, courseId, ["owner","administrator","publisher"], ["instructor"])) return fail(403, "COURSE_EDIT_PERMISSION_REQUIRED", "You do not have permission to edit this course.");
    const course = await env.DB.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND owner_type='organization' AND status='draft'").bind(courseId, orgId).first();
    if (!course) return fail(404, "DRAFT_COURSE_NOT_FOUND", "Only a draft course in this organization can be edited.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the module details."); }
    const title = String(body.title || "").trim().slice(0, 180);
    if (!title) return fail(422, "MODULE_TITLE_REQUIRED", "A module title is required.");
    const moduleId = id();
    await env.DB.prepare("INSERT INTO course_modules(id,course_id,title,position) VALUES(?,?,?,?)").bind(moduleId, courseId, title, positionValue(body.position)).run();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.module.created", "course_module", moduleId).run();
    return json({ ok: true, moduleId }, 201);
  }

  const lessonMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/modules\/([A-Za-z0-9-]+)\/lessons$/);
  if (method === "POST" && lessonMatch) {
    const [, orgId, moduleId] = lessonMatch;
    const module = await env.DB.prepare("SELECT m.id,m.course_id FROM course_modules m JOIN courses c ON c.id=m.course_id WHERE m.id=? AND c.organization_id=? AND c.status='draft' AND c.owner_type='organization'").bind(moduleId, orgId).first<{id:string;course_id:string}>();
    if (!module) return fail(404, "DRAFT_MODULE_NOT_FOUND", "This module is not part of an editable draft course.");
    if (!await requireCourseAccess(env, actor, orgId, module.course_id, ["owner","administrator","publisher"], ["instructor"])) return fail(403, "COURSE_EDIT_PERMISSION_REQUIRED", "You do not have permission to edit this course.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the lesson details."); }
    const title = String(body.title || "").trim().slice(0, 180);
    const lessonType = String(body.lessonType || "text");
    const allowedTypes = ["video","text","document","link","presentation","quiz","assignment"];
    if (!title || !allowedTypes.includes(lessonType)) return fail(422, "LESSON_DETAILS_REQUIRED", "Enter a lesson title and choose a supported lesson type.");
    if (body.content != null && (typeof body.content !== "object" || Array.isArray(body.content))) return fail(422, "INVALID_LESSON_CONTENT", "Lesson content must be structured lesson information.");
    const contentJson = JSON.stringify(body.content || {});
    if (contentJson.length > 20_000) return fail(413, "LESSON_CONTENT_TOO_LARGE", "Keep lesson details under 20 KB. Store large files in private course storage.");
    const lessonId = id();
    await env.DB.prepare("INSERT INTO course_lessons(id,module_id,title,lesson_type,content_json,position,is_preview) VALUES(?,?,?,?,?,?,?)")
      .bind(lessonId, moduleId, title, lessonType, contentJson, positionValue(body.position), body.isPreview === true ? 1 : 0).run();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.lesson.created", "course_lesson", lessonId).run();
    return json({ ok: true, lessonId }, 201);
  }

  const enrollMatch = path.match(/^\/api\/courses\/([A-Za-z0-9-]+)\/enroll$/);
  if (method === "POST" && enrollMatch) {
    const course = await env.DB.prepare("SELECT c.id,c.organization_id,c.price_minor,c.status FROM courses c LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.id=? AND c.status='published' AND (c.owner_type='proctify' OR o.status='verified')").bind(enrollMatch[1]).first<{id:string;organization_id:string|null;price_minor:number;status:string}>();
    if (!course) return fail(404, "COURSE_NOT_AVAILABLE", "This course is not available for enrollment.");
    if (course.price_minor > 0) return fail(402, "CHECKOUT_REQUIRED", "This course requires checkout. Paid enrollment will be enabled when the payment provider is connected.");
    const enrollmentId = id();
    await env.DB.prepare("INSERT OR IGNORE INTO enrollments(id,course_id,learner_id,organization_id,source,status) VALUES(?,?,?,?, 'marketplace','active')").bind(enrollmentId, course.id, actor.id, course.organization_id).run();
    const enrollment = await env.DB.prepare("SELECT id,status,enrolled_at FROM enrollments WHERE course_id=? AND learner_id=?").bind(course.id, actor.id).first();
    return json({ ok: true, enrollment }, 201);
  }

  const progressMatch = path.match(/^\/api\/enrollments\/([A-Za-z0-9-]+)\/progress$/);
  if (method === "POST" && progressMatch) {
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the progress update."); }
    const lessonId = String(body.lessonId || "");
    const enrollment = await env.DB.prepare("SELECT e.id,e.course_id FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE e.id=? AND e.learner_id=? AND e.status='active' AND c.status IN ('published','archived') AND (c.owner_type='proctify' OR o.status='verified')").bind(progressMatch[1], actor.id).first<{id:string;course_id:string}>();
    if (!enrollment) return fail(404, "ENROLLMENT_NOT_FOUND", "This active enrollment was not found for your account.");
    const lesson = await env.DB.prepare("SELECT l.id FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE l.id=? AND m.course_id=?").bind(lessonId, enrollment.course_id).first();
    if (!lesson) return fail(404, "LESSON_NOT_IN_COURSE", "This lesson is not part of the enrolled course.");
    const status = body.status === "completed" ? "completed" : "in_progress";
    const seconds = Math.max(0, Math.min(86_400, Math.floor(Number(body.lastPositionSeconds || 0))));
    await env.DB.prepare("INSERT INTO lesson_progress(enrollment_id,lesson_id,status,last_position_seconds,completed_at,updated_at) VALUES(?,?,?,?,CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP) ON CONFLICT(enrollment_id,lesson_id) DO UPDATE SET status=excluded.status,last_position_seconds=excluded.last_position_seconds,completed_at=CASE WHEN excluded.status='completed' THEN CURRENT_TIMESTAMP ELSE lesson_progress.completed_at END,updated_at=CURRENT_TIMESTAMP")
      .bind(enrollment.id, lessonId, status, seconds, status).run();
    return json({ ok: true, lessonId, status, lastPositionSeconds: seconds });
  }

  const courseAssignmentsMatch = path.match(/^\/api\/courses\/([A-Za-z0-9-]+)\/assignments$/);
  if (method === "GET" && courseAssignmentsMatch) {
    const courseId = courseAssignmentsMatch[1];
    const enrollment = await env.DB.prepare("SELECT e.id FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE e.course_id=? AND e.learner_id=? AND e.status IN ('active','completed') AND c.status IN ('published','archived') AND (c.owner_type='proctify' OR o.status='verified')").bind(courseId, actor.id).first();
    if (!enrollment) return fail(403, "ENROLLMENT_REQUIRED", "Enroll in this available course to view its assignments.");
    const rows = await env.DB.prepare("SELECT a.id,a.title,a.instructions,a.due_at,a.max_score,s.status AS submission_status,s.score,s.feedback,s.submitted_at FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id AND s.learner_id=? WHERE a.course_id=? ORDER BY a.created_at ASC")
      .bind(actor.id, courseId).all();
    return json({ ok: true, assignments: rows.results || [] });
  }

  const reviewAssignment = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/assignments\/([A-Za-z0-9-]+)\/review$/);
  if (method === "POST" && reviewAssignment) {
    const [, orgId, assignmentId] = reviewAssignment;
    const assignmentCourse = await env.DB.prepare("SELECT course_id FROM assignments WHERE id=?").bind(assignmentId).first<{course_id:string}>();
    if (!assignmentCourse || !await requireCourseAccess(env, actor, orgId, assignmentCourse.course_id, ["owner","administrator"], ["instructor","reviewer"])) return fail(403, "REVIEW_PERMISSION_REQUIRED", "You do not have permission to review this course's assignments.");
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the review details."); }
    const submissionId = String(body.submissionId || "");
    const assignment = await env.DB.prepare("SELECT a.id,a.max_score FROM assignments a JOIN courses c ON c.id=a.course_id WHERE a.id=? AND c.organization_id=?").bind(assignmentId, orgId).first<{id:string;max_score:number|null}>();
    if (!assignment) return fail(404, "ASSIGNMENT_NOT_FOUND", "This assignment is not part of your organization.");
    const score = body.score == null ? null : Number(body.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || (assignment.max_score !== null && score > assignment.max_score))) return fail(422, "INVALID_SCORE", "The score must be within the assignment's allowed range.");
    const updated = await env.DB.prepare("UPDATE assignment_submissions SET status='reviewed',score=?,feedback=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND assignment_id=? AND status IN ('submitted','returned')")
      .bind(score, String(body.feedback || "").slice(0, 5000), actor.id, submissionId, assignmentId).run();
    if (!updated.meta.changes) return fail(404, "SUBMISSION_NOT_REVIEWABLE", "The submission was not found or has already been reviewed.");
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "assignment.reviewed", "assignment_submission", submissionId).run();
    return json({ ok: true, status: "reviewed" });
  }

  const submissionMatch = path.match(/^\/api\/assignments\/([A-Za-z0-9-]+)\/submissions$/);
  if (method === "POST" && submissionMatch) {
    let body: any;
    try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check your assignment response."); }
    const assignment = await env.DB.prepare("SELECT a.id,a.course_id,a.due_at FROM assignments a JOIN courses c ON c.id=a.course_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE a.id=? AND c.status IN ('published','archived') AND (c.owner_type='proctify' OR o.status='verified')").bind(submissionMatch[1]).first<{id:string;course_id:string;due_at:string|null}>();
    if (!assignment) return fail(404, "ASSIGNMENT_NOT_FOUND", "This assignment is not available.");
    const enrollment = await env.DB.prepare("SELECT id FROM enrollments WHERE course_id=? AND learner_id=? AND status IN ('active','completed')").bind(assignment.course_id, actor.id).first();
    if (!enrollment) return fail(403, "ENROLLMENT_REQUIRED", "Enroll in this course before submitting the assignment.");
    if (assignment.due_at && new Date(assignment.due_at).getTime() < Date.now()) return fail(409, "ASSIGNMENT_CLOSED", "The submission deadline has passed.");
    const responseJson = JSON.stringify(body.response ?? {});
    if (responseJson.length > 20_000) return fail(413, "SUBMISSION_TOO_LARGE", "Keep your response under 20 KB or use an approved course file upload.");
    const submissionId = id();
    const saved = await env.DB.prepare("INSERT INTO assignment_submissions(id,assignment_id,learner_id,response_json,status) VALUES(?,?,?,?,'submitted') ON CONFLICT(assignment_id,learner_id) DO UPDATE SET response_json=excluded.response_json,status='submitted',submitted_at=CURRENT_TIMESTAMP,score=NULL,feedback=NULL,reviewed_by=NULL,reviewed_at=NULL WHERE assignment_submissions.status IN ('submitted','returned')")
      .bind(submissionId, assignment.id, actor.id, responseJson).run();
    if (!saved.meta.changes) return fail(409, "SUBMISSION_ALREADY_REVIEWED", "This submission has already been reviewed. Contact the instructor if you need another attempt.");
    return json({ ok: true, assignmentId: assignment.id, status: "submitted" }, 201);
  }


  // Educator groups and sections. All group data is scoped to a verified organization.
  const groupBase = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/groups$/);
  if (groupBase && method === "POST") {
    const orgId = groupBase[1];
    if (!await requireMember(env, actor, orgId, ["owner","administrator"])) return fail(403, "GROUP_ADMIN_REQUIRED", "Only organization owners and administrators can create groups.");
    let body: any; try { body = await readJson(request); } catch { return fail(400, "INVALID_JSON", "Please check the group details."); }
    const name = String(body.name || "").trim().slice(0, 120);
    const sectionCode = String(body.sectionCode || "").trim().slice(0, 40) || null;
    if (!name) return fail(422, "GROUP_NAME_REQUIRED", "Enter a group or section name.");
    const groupId = id();
    try {
      await env.DB.prepare("INSERT INTO learning_groups(id,organization_id,name,section_code,subject,description,created_by) VALUES(?,?,?,?,?,?,?)")
        .bind(groupId, orgId, name, sectionCode, String(body.subject || "").trim().slice(0,120), String(body.description || "").trim().slice(0,1000), actor.id).run();
    } catch { return fail(409, "SECTION_CODE_EXISTS", "That section code is already used in this organization."); }
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)")
      .bind(id(),actor.id,orgId,"learning_group.created","learning_group",groupId).run();
    return json({ok:true,groupId,name,sectionCode},201);
  }
  if (groupBase && method === "GET") {
    const orgId = groupBase[1];
    if (!await requireMember(env,actor,orgId,["owner","administrator","instructor"])) return fail(403,"GROUP_ACCESS_REQUIRED","You do not have access to this organization's groups.");
    const rows = await env.DB.prepare("SELECT g.id,g.name,g.section_code,g.subject,g.description,g.status,g.created_at,COUNT(DISTINCT gl.learner_id) AS learner_count,COUNT(DISTINCT gc.course_id) AS assigned_course_count FROM learning_groups g LEFT JOIN learning_group_learners gl ON gl.group_id=g.id LEFT JOIN learning_group_courses gc ON gc.group_id=g.id WHERE g.organization_id=? AND (EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=g.organization_id AND m.user_id=? AND m.role IN ('owner','administrator') AND m.status='active') OR EXISTS(SELECT 1 FROM learning_group_educators ge WHERE ge.group_id=g.id AND ge.user_id=?)) GROUP BY g.id ORDER BY g.created_at DESC LIMIT 200")
      .bind(orgId,actor.id,actor.id).all();
    return json({ok:true,groups:rows.results||[]});
  }

  const groupRoute = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/groups\/([A-Za-z0-9-]+)(?:\/(educators|learners|courses|activities|announcements|messages))?$/);
  if (groupRoute) {
    const [,orgId,groupId,section] = groupRoute;
    const group = await env.DB.prepare("SELECT id,organization_id,name FROM learning_groups WHERE id=? AND organization_id=? AND status='active'").bind(groupId,orgId).first<{id:string;organization_id:string;name:string}>();
    if (!group) return fail(404,"GROUP_NOT_FOUND","This group was not found in your organization.");
    const admin = await requireMember(env,actor,orgId,["owner","administrator"]);
    const educator = await env.DB.prepare("SELECT 1 AS allowed FROM learning_group_educators WHERE group_id=? AND user_id=?").bind(groupId,actor.id).first();
    const educatorAllowed = Boolean(educator);
    if (!admin && !educatorAllowed) return fail(403,"GROUP_ACCESS_REQUIRED","You are not assigned to this group.");

    if (section === "educators" && method === "POST") {
      if (!admin) return fail(403,"GROUP_ADMIN_REQUIRED","Only organization administrators can assign educators.");
      let body:any; try { body=await readJson(request); } catch { return fail(400,"INVALID_JSON","Please check the educator details."); }
      const userId=String(body.userId||"");
      const member=await env.DB.prepare("SELECT user_id FROM organization_members WHERE organization_id=? AND user_id=? AND role='instructor' AND status='active'").bind(orgId,userId).first();
      if (!member) return fail(404,"ACTIVE_EDUCATOR_REQUIRED","Choose an active instructor in this organization.");
      await env.DB.prepare("INSERT OR IGNORE INTO learning_group_educators(group_id,user_id,assigned_by) VALUES(?,?,?)").bind(groupId,userId,actor.id).run();
      return json({ok:true,groupId,userId},201);
    }
    if (section === "educators" && method === "GET") {
      const rows=await env.DB.prepare("SELECT u.id,u.display_name,u.email FROM learning_group_educators ge JOIN users u ON u.id=ge.user_id WHERE ge.group_id=? ORDER BY u.display_name").bind(groupId).all();
      return json({ok:true,educators:rows.results||[]});
    }
    if (section === "learners" && method === "POST") {
      if (!admin) return fail(403,"GROUP_ADMIN_REQUIRED","Only organization administrators can add learners to a group.");
      let body:any; try { body=await readJson(request); } catch { return fail(400,"INVALID_JSON","Please check the learner details."); }
      const email=String(body.email||"").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(422,"INVALID_LEARNER_EMAIL","Enter the learner's verified account email.");
      const learner=await env.DB.prepare("SELECT u.id FROM users u JOIN organization_members m ON m.user_id=u.id WHERE u.email=? COLLATE NOCASE AND u.status='active' AND m.organization_id=? AND m.role='learner' AND m.status='active'").bind(email,orgId).first<{id:string}>();
      if (!learner) return fail(404,"ACTIVE_LEARNER_REQUIRED","The learner must have an active account in this organization first.");
      await env.DB.prepare("INSERT OR IGNORE INTO learning_group_learners(group_id,organization_id,learner_id,added_by) VALUES(?,?,?,?)").bind(groupId,orgId,learner.id,actor.id).run();
      return json({ok:true,groupId,learnerId:learner.id},201);
    }
    if (section === "learners" && method === "GET") {
      const rows=await env.DB.prepare("SELECT u.id AS learner_id,u.display_name,u.email,gl.created_at AS added_at FROM learning_group_learners gl JOIN users u ON u.id=gl.learner_id WHERE gl.group_id=? ORDER BY u.display_name").bind(groupId).all();
      return json({ok:true,learners:rows.results||[]});
    }
    if (section === "courses" && method === "POST") {
      if (!admin) return fail(403,"GROUP_ADMIN_REQUIRED","Only organization administrators can assign courses to a group.");
      let body:any; try { body=await readJson(request); } catch { return fail(400,"INVALID_JSON","Please check the course assignment."); }
      const courseId=String(body.courseId||"");
      const course=await env.DB.prepare("SELECT c.id,c.price_minor,c.status FROM courses c LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.id=? AND c.status='published' AND (c.owner_type='proctify' OR (c.organization_id=? AND o.status='verified'))").bind(courseId,orgId).first<{id:string;price_minor:number;status:string}>();
      if (!course) return fail(404,"COURSE_NOT_AVAILABLE","Choose a published Proctify course or a course owned by this organization.");
      if (course.price_minor>0) return fail(402,"CHECKOUT_REQUIRED","Paid course seats must be purchased through platform checkout before assignment.");
      const dueAt=body.dueAt?new Date(String(body.dueAt)):null;
      if(dueAt&&Number.isNaN(dueAt.getTime())) return fail(422,"INVALID_DUE_DATE","Enter a valid due date.");
      await env.DB.prepare("INSERT OR IGNORE INTO learning_group_courses(group_id,course_id,assigned_by,due_at) VALUES(?,?,?,?)").bind(groupId,courseId,actor.id,dueAt?dueAt.toISOString():null).run();
      const learners=await env.DB.prepare("SELECT learner_id FROM learning_group_learners WHERE group_id=?").bind(groupId).all<{learner_id:string}>();
      for(const learner of learners.results||[]) await env.DB.prepare("INSERT OR IGNORE INTO enrollments(id,course_id,learner_id,organization_id,source,status) VALUES(?,?,?,?, 'organization_assignment','active')").bind(id(),courseId,learner.learner_id,orgId).run();
      return json({ok:true,groupId,courseId,enrolledLearners:(learners.results||[]).length},201);
    }
    if (section === "courses" && method === "GET") {
      const rows=await env.DB.prepare("SELECT c.id,c.title,c.slug,c.category,c.status,gc.assigned_at,gc.due_at FROM learning_group_courses gc JOIN courses c ON c.id=gc.course_id WHERE gc.group_id=? ORDER BY gc.assigned_at DESC").bind(groupId).all();
      return json({ok:true,courses:rows.results||[]});
    }
    if (section === "activities" && method === "POST") {
      let body:any; try { body=await readJson(request); } catch { return fail(400,"INVALID_JSON","Please check the activity details."); }
      const title=String(body.title||"").trim().slice(0,180);
      const courseId=String(body.courseId||"");
      const lessonId=String(body.lessonId||"")||null;
      const assignmentId=String(body.assignmentId||"")||null;
      if(!title||(!lessonId&&!assignmentId)) return fail(422,"ACTIVITY_DETAILS_REQUIRED","Enter an activity title and choose a lesson or assignment.");
      const assigned=await env.DB.prepare("SELECT 1 AS ok FROM learning_group_courses WHERE group_id=? AND course_id=?").bind(groupId,courseId).first();
      if(!assigned) return fail(403,"COURSE_NOT_ASSIGNED","Assign this course to the group before adding an activity.");
      if(lessonId){const valid=await env.DB.prepare("SELECT 1 AS ok FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE l.id=? AND m.course_id=?").bind(lessonId,courseId).first();if(!valid)return fail(422,"LESSON_NOT_IN_COURSE","Choose a lesson from the assigned course.");}
      if(assignmentId){const valid=await env.DB.prepare("SELECT 1 AS ok FROM assignments WHERE id=? AND course_id=?").bind(assignmentId,courseId).first();if(!valid)return fail(422,"ASSIGNMENT_NOT_IN_COURSE","Choose an assignment from the assigned course.");}
      const dueAt=body.dueAt?new Date(String(body.dueAt)):null;if(dueAt&&Number.isNaN(dueAt.getTime()))return fail(422,"INVALID_DUE_DATE","Enter a valid due date.");
      const activityId=id();
      await env.DB.prepare("INSERT INTO learning_group_activities(id,group_id,course_id,lesson_id,assignment_id,title,instructions,due_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)").bind(activityId,groupId,courseId,lessonId,assignmentId,title,String(body.instructions||"").slice(0,3000),dueAt?dueAt.toISOString():null,actor.id).run();
      return json({ok:true,activityId},201);
    }
    if (section === "activities" && method === "GET") {
      const rows=await env.DB.prepare("SELECT id,course_id,lesson_id,assignment_id,title,instructions,due_at,created_at FROM learning_group_activities WHERE group_id=? ORDER BY due_at").bind(groupId).all();
      return json({ok:true,activities:rows.results||[]});
    }
    if (section === "announcements" && method === "POST") {
      let body:any; try { body=await readJson(request); } catch { return fail(400,"INVALID_JSON","Please check the announcement."); }
      const title=String(body.title||"").trim().slice(0,180), message=String(body.body||"").trim().slice(0,5000);
      if(!title||!message)return fail(422,"ANNOUNCEMENT_REQUIRED","Enter an announcement title and message.");
      const announcementId=id();
      await env.DB.prepare("INSERT INTO learning_group_announcements(id,group_id,sender_id,title,body) VALUES(?,?,?,?,?)").bind(announcementId,groupId,actor.id,title,message).run();
      return json({ok:true,announcementId},201);
    }
    if (section === "announcements" && method === "GET") {
      const rows=await env.DB.prepare("SELECT a.id,a.title,a.body,a.created_at,u.display_name AS sender_name FROM learning_group_announcements a JOIN users u ON u.id=a.sender_id WHERE a.group_id=? ORDER BY a.created_at DESC LIMIT 100").bind(groupId).all();
      return json({ok:true,announcements:rows.results||[]});
    }
    if (section === "messages" && method === "POST") {
      let body:any; try { body=await readJson(request); } catch { return fail(400,"INVALID_JSON","Please check the message."); }
      const recipientId=String(body.recipientId||"");
      const recipient=await env.DB.prepare("SELECT 1 AS ok FROM learning_group_learners WHERE group_id=? AND learner_id=?").bind(groupId,recipientId).first();
      if(!recipient)return fail(404,"LEARNER_NOT_IN_GROUP","Choose a learner who belongs to this group.");
      const message=String(body.body||"").trim().slice(0,5000);
      if(!message)return fail(422,"MESSAGE_REQUIRED","Enter a message before sending.");
      const messageId=id();
      await env.DB.prepare("INSERT INTO learner_messages(id,organization_id,group_id,sender_id,recipient_id,subject,body) VALUES(?,?,?,?,?,?,?)").bind(messageId,orgId,groupId,actor.id,recipientId,String(body.subject||"").slice(0,180),message).run();
      return json({ok:true,messageId},201);
    }
    if (section === "messages" && method === "GET") {
      const rows=await env.DB.prepare("SELECT id,sender_id,recipient_id,subject,body,read_at,created_at FROM learner_messages WHERE group_id=? AND (sender_id=? OR recipient_id=?) ORDER BY created_at DESC LIMIT 100").bind(groupId,actor.id,actor.id).all();
      return json({ok:true,messages:rows.results||[]});
    }
  }
  const learnerInbox = path.match(/^\/api\/learners\/me\/messages$/);
  if (learnerInbox && method === "GET") {
    const rows=await env.DB.prepare("SELECT id,organization_id,group_id,sender_id,subject,body,read_at,created_at FROM learner_messages WHERE recipient_id=? ORDER BY created_at DESC LIMIT 100").bind(actor.id).all();
    return json({ok:true,messages:rows.results||[]});
  }
  const learnerMessage = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/learners\/([A-Za-z0-9-]+)\/messages$/);
  if (learnerMessage && method === "POST") {
    const [,orgId,recipientId]=learnerMessage;
    if(!await requireMember(env,actor,orgId,["owner","administrator","instructor"]))return fail(403,"MESSAGE_PERMISSION_REQUIRED","Only organization administrators and educators can message learners.");
    const membership=await env.DB.prepare("SELECT 1 AS ok FROM organization_members WHERE organization_id=? AND user_id=? AND role='learner' AND status='active'").bind(orgId,recipientId).first();
    if(!membership)return fail(404,"LEARNER_NOT_FOUND","This learner is not an active member of your organization.");
    let body:any;try{body=await readJson(request);}catch{return fail(400,"INVALID_JSON","Please check the message.");}
    const message=String(body.body||"").trim().slice(0,5000);if(!message)return fail(422,"MESSAGE_REQUIRED","Enter a message before sending.");
    const messageId=id();
    await env.DB.prepare("INSERT INTO learner_messages(id,organization_id,sender_id,recipient_id,subject,body) VALUES(?,?,?,?,?,?)").bind(messageId,orgId,actor.id,recipientId,String(body.subject||"").slice(0,180),message).run();
    return json({ok:true,messageId},201);
  }


  const learnerGroups = path.match(/^\/api\/learners\/me\/groups$/);
  if (learnerGroups && method === "GET") {
    const rows=await env.DB.prepare("SELECT g.id,g.name,g.section_code,g.subject,o.name AS organization_name FROM learning_group_learners gl JOIN learning_groups g ON g.id=gl.group_id JOIN organizations o ON o.id=g.organization_id WHERE gl.learner_id=? AND g.status='active' AND o.status='verified' ORDER BY g.name").bind(actor.id).all();
    return json({ok:true,groups:rows.results||[]});
  }
  const learnerGroupAnnouncements = path.match(/^\/api\/learners\/me\/groups\/([A-Za-z0-9-]+)\/announcements$/);
  if (learnerGroupAnnouncements && method === "GET") {
    const groupId=learnerGroupAnnouncements[1];
    const member=await env.DB.prepare("SELECT 1 AS ok FROM learning_group_learners gl JOIN learning_groups g ON g.id=gl.group_id JOIN organizations o ON o.id=g.organization_id WHERE gl.group_id=? AND gl.learner_id=? AND g.status='active' AND o.status='verified'").bind(groupId,actor.id).first();
    if(!member)return fail(404,"GROUP_NOT_FOUND","This group is not available to your learner account.");
    const rows=await env.DB.prepare("SELECT a.id,a.title,a.body,a.created_at,u.display_name AS sender_name FROM learning_group_announcements a JOIN users u ON u.id=a.sender_id WHERE a.group_id=? ORDER BY a.created_at DESC LIMIT 100").bind(groupId).all();
    return json({ok:true,announcements:rows.results||[]});
  }
  const learnerGroupReply = path.match(/^\/api\/learners\/me\/groups\/([A-Za-z0-9-]+)\/messages$/);
  if (learnerGroupReply && method === "POST") {
    const groupId=learnerGroupReply[1];
    const membership=await env.DB.prepare("SELECT g.organization_id FROM learning_group_learners gl JOIN learning_groups g ON g.id=gl.group_id JOIN organizations o ON o.id=g.organization_id WHERE gl.group_id=? AND gl.learner_id=? AND g.status='active' AND o.status='verified'").bind(groupId,actor.id).first<{organization_id:string}>();
    if(!membership)return fail(404,"GROUP_NOT_FOUND","This group is not available to your learner account.");
    let body:any;try{body=await readJson(request);}catch{return fail(400,"INVALID_JSON","Please check your message.");}
    const educatorId=String(body.recipientId||"");
    const educator=await env.DB.prepare("SELECT 1 AS ok FROM learning_group_educators WHERE group_id=? AND user_id=?").bind(groupId,educatorId).first();
    if(!educator)return fail(404,"EDUCATOR_NOT_ASSIGNED","Choose an educator assigned to this group.");
    const message=String(body.body||"").trim().slice(0,5000);if(!message)return fail(422,"MESSAGE_REQUIRED","Enter a message before sending.");
    const messageId=id();
    await env.DB.prepare("INSERT INTO learner_messages(id,organization_id,group_id,sender_id,recipient_id,subject,body) VALUES(?,?,?,?,?,?,?)").bind(messageId,membership.organization_id,groupId,actor.id,educatorId,String(body.subject||"").slice(0,180),message).run();
    return json({ok:true,messageId},201);
  }

  return fail(404, "NOT_FOUND", "This Proctify service route does not exist.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const response = await route(request, env);
      const merged = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      return new Response(response.body, { status: response.status, headers: merged });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected service error";
      if (message === "REQUEST_TOO_LARGE") return fail(413, "REQUEST_TOO_LARGE", "The submitted information is too large.");
      return fail(500, "SERVICE_ERROR", "The service could not complete this request. Please try again.");
    }
  }
};
