export interface Env {
  DB: D1Database;
  APP_ORIGIN: string;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWT_SECRET?: string;
  TURNSTILE_SECRET?: string;
}

type Claims = { sub: string; email: string; name?: string; iss: string; aud: string | string[]; exp: number };
type Actor = { id: string; email: string; name: string };

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status: number, code: string, message: string) => json({ ok: false, error: { code, message } }, status);
const id = () => crypto.randomUUID();
const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const b64url = (value: string) => btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const decodePart = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - part.length % 4) % 4)));

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

async function authenticate(request: Request, env: Env): Promise<Actor | null> {
  if (!env.AUTH_JWT_SECRET) return null;
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]) as Claims;
    if (header.alg !== "HS256" || !claims.sub || !claims.email || claims.exp <= Date.now() / 1000) return null;
    if (claims.iss !== env.AUTH_ISSUER) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.AUTH_AUDIENCE)) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[2].length % 4) % 4)), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify("HMAC", key, signature, signed)) return null;
    await env.DB.prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, updated_at=CURRENT_TIMESTAMP").bind(claims.sub, claims.email.toLowerCase(), claims.name || "").run();
    return { id: claims.sub, email: claims.email.toLowerCase(), name: claims.name || "" };
  } catch { return null; }
}

async function requireMember(env: Env, actor: Actor, organizationId: string, roles: string[]) {
  const row = await env.DB.prepare("SELECT m.role,o.status FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active'").bind(organizationId, actor.id).first<{ role: string; status: string }>();
  return !!row && row.status === "verified" && roles.includes(row.role);
}

async function verifyTurnstile(request: Request, env: Env, token: string) {
  if (!env.TURNSTILE_SECRET || !token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json() as { success?: boolean };
  return response.ok && result.success === true;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/health") {
    await env.DB.prepare("SELECT 1 AS ready").first();
    return json({ ok: true, service: "proctify-lms-api", mode: "connected", capabilities: { database: true, identity: Boolean(env.AUTH_JWT_SECRET), registration: Boolean(env.TURNSTILE_SECRET), payments: false, email: false } });
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
    const certificate = await env.DB.prepare("SELECT c.verification_code,c.title,c.issued_at,c.expires_at,c.revoked_at,u.display_name AS learner_name,o.name AS issuer_name FROM certificates c JOIN users u ON u.id=c.learner_id LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.verification_code=?").bind(certificateMatch[1]).first();
    if (!certificate) return fail(404, "CERTIFICATE_NOT_FOUND", "No certificate matches this verification code.");
    const record = certificate as any;
    return json({ ok: true, certificate: { ...record, valid: !record.revoked_at && (!record.expires_at || new Date(record.expires_at).getTime() > Date.now()) } });
  }

  const actor = await authenticate(request, env);
  if (!actor) return fail(401, "AUTH_REQUIRED", "Please sign in with an approved Proctify account.");

  if (method === "GET" && path === "/api/admin/organization-applications") {
    const admin = await env.DB.prepare("SELECT status FROM platform_admins WHERE user_id=?").bind(actor.id).first<{status:string}>();
    if (!admin || admin.status !== "active") return fail(403, "SUPER_ADMIN_REQUIRED", "This action is restricted to Proctify Super Admins.");
    const rows = await env.DB.prepare("SELECT id,organization_name,slug,organization_type,applicant_name,applicant_email,website,country_code,verification_status,created_at FROM organization_applications WHERE verification_status IN ('pending','in_review') ORDER BY created_at ASC LIMIT 100").all();
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
        await env.DB.prepare("INSERT INTO organizations(id,application_id,name,slug,organization_type,owner_email) VALUES(?,?,?,?,?,?)")
          .bind(organizationId, application.id, application.organization_name, application.slug, application.organization_type, application.applicant_email).run();
      } catch {
        return fail(409, "ORGANIZATION_CONFLICT", "An organization with this name or address already exists.");
      }
      await env.DB.prepare("UPDATE organization_applications SET verification_status='verified',reviewer_id=?,reviewer_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(actor.id, String(body.note || "").slice(0, 1000), application.id).run();
      await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,target_type,target_id,detail_json) VALUES(?,?,?,?,?,?)")
        .bind(id(), actor.id, "organization.verified", "organization_application", application.id, JSON.stringify({organizationId})).run();
      return json({ ok: true, status: "verified", organizationId });
    }
    await env.DB.prepare("UPDATE organization_applications SET verification_status='rejected',reviewer_id=?,reviewer_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(actor.id, String(body.note || "").slice(0, 1000), application.id).run();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,target_type,target_id) VALUES(?,?,?,?,?)")
      .bind(id(), actor.id, "organization.rejected", "organization_application", application.id).run();
    return json({ ok: true, status: "rejected" });
  }

  const claimMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/claim$/);
  if (method === "POST" && claimMatch) {
    const org = await env.DB.prepare("SELECT id,owner_email,status FROM organizations WHERE id=?").bind(claimMatch[1]).first<{id:string;owner_email:string;status:string}>();
    if (!org || org.status !== "verified" || org.owner_email.toLowerCase() !== actor.email) return fail(403, "CLAIM_NOT_ALLOWED", "This organization cannot be claimed by this account.");
    await env.DB.prepare("INSERT OR IGNORE INTO organization_members(organization_id,user_id,role,status) VALUES(?,?, 'owner','active')").bind(org.id, actor.id).run();
    return json({ ok: true, organizationId: org.id, role: "owner" });
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
    const courseId = id();
    await env.DB.prepare("INSERT INTO courses(id,organization_id,owner_type,slug,title,short_description,description,category,language_code,level,price_minor,currency,certificate_enabled,created_by) VALUES(?,?,'organization',?,?,?,?,?,?,?,?,?,?,?)")
      .bind(courseId, orgId, slug, title, String(body.shortDescription || "").slice(0, 280), String(body.description || "").slice(0, 12000), String(body.category || "General").slice(0, 80), String(body.languageCode || "en").slice(0, 8), String(body.level || "all_levels").slice(0, 30), Math.max(0, Math.floor(Number(body.priceMinor || 0))), String(body.currency || "USD").toUpperCase().slice(0, 3), body.certificateEnabled ? 1 : 0, actor.id).run();
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.created", "course", courseId).run();
    return json({ ok: true, courseId, status: "draft" }, 201);
  }

  const publishMatch = path.match(/^\/api\/organizations\/([A-Za-z0-9-]+)\/courses\/([A-Za-z0-9-]+)\/publish$/);
  if (method === "POST" && publishMatch) {
    const [, orgId, courseId] = publishMatch;
    if (!await requireMember(env, actor, orgId, ["owner","administrator","publisher"])) return fail(403, "PUBLISH_PERMISSION_REQUIRED", "Only an authorized publisher in a verified organization can publish courses.");
    const result = await env.DB.prepare("UPDATE courses SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND owner_type='organization' AND status IN ('draft','review')").bind(courseId, orgId).run();
    if (!result.meta.changes) return fail(404, "COURSE_NOT_FOUND", "The draft course was not found in this organization.");
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,organization_id,action,target_type,target_id) VALUES(?,?,?,?,?,?)").bind(id(), actor.id, orgId, "course.published", "course", courseId).run();
    return json({ ok: true, courseId, status: "published" });
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
