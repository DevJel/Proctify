type AuthAudience = "learner" | "organization" | "admin";
type AuthEnv = {
  DB: D1Database;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_OTP_SECRET?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  SES_FROM_EMAIL?: string;
};
export type Actor = { id: string; email: string; name: string; sessionId?: string; loginAudience?: AuthAudience };
type AuthClaims = {
  sub: string; email: string; email_verified: boolean; name?: string;
  iss: string; aud: string | string[]; iat: number; exp: number;
  jti?: string; login_audience?: AuthAudience;
};
const authJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "pragma": "no-cache" }
});
const authFail = (status: number, code: string, message: string) =>
  authJson({ ok: false, error: { code, message } }, status);
const encoder = new TextEncoder();
const toHex = (bytes: Uint8Array) => Array.from(bytes).map(x => x.toString(16).padStart(2, "0")).join("");
const toB64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64Url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
async function digestHex(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function hmacRawKey(rawKey: Uint8Array, value: string) {
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function hmacBytes(secret: string, value: string) {
  return hmacRawKey(encoder.encode(secret), value);
}
async function hmacHex(secret: string, value: string) {
  return toHex(await hmacBytes(secret, value));
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function decodeJwtPart(part: string): any {
  return JSON.parse(new TextDecoder().decode(fromB64Url(part)));
}
function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validAudience(value: unknown): value is AuthAudience {
  return value === "learner" || value === "organization" || value === "admin";
}
async function readAuthBody(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 8000) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (text.length > 8000) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(text || "{}");
}
function randomCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}
async function sesSendOtp(env: AuthEnv, to: string, code: string) {
  const region = env.AWS_REGION || "ap-southeast-2";
  const accessKey = env.AWS_ACCESS_KEY_ID || "";
  const secretKey = env.AWS_SECRET_ACCESS_KEY || "";
  const from = env.SES_FROM_EMAIL || "";
  if (!accessKey || !secretKey || !from) throw new Error("EMAIL_NOT_CONFIGURED");
  const host = "email." + region + ".amazonaws.com";
  const path = "/v2/email/outbound-emails";
  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: {
      Subject: { Data: "Your PROCTORAVA sign-in code", Charset: "UTF-8" },
      Body: { Text: { Data: "Your PROCTORAVA sign-in code is " + code + ". It expires in 10 minutes. If you did not request this code, you can ignore this email. Never share this code with anyone.", Charset: "UTF-8" } }
    } }
  });
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await digestHex(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  if (env.AWS_SESSION_TOKEN) headers["x-amz-security-token"] = env.AWS_SESSION_TOKEN;
  const signedNames = ["content-type", "host", "x-amz-content-sha256", "x-amz-date", ...(env.AWS_SESSION_TOKEN ? ["x-amz-security-token"] : [])].join(";");
  const canonicalHeaders = "content-type:application/json\nhost:" + host + "\nx-amz-content-sha256:" + payloadHash +
    "\nx-amz-date:" + amzDate + "\n" + (env.AWS_SESSION_TOKEN ? "x-amz-security-token:" + env.AWS_SESSION_TOKEN + "\n" : "");
  const canonicalRequest = ["POST", path, "", canonicalHeaders, signedNames, payloadHash].join("\n");
  const scope = dateStamp + "/" + region + "/ses/aws4_request";
  const stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + await digestHex(canonicalRequest);
  const kDate = await hmacBytes("AWS4" + secretKey, dateStamp);
  const kRegion = await hmacRawKey(kDate, region);
  const kService = await hmacRawKey(kRegion, "ses");
  const kSigning = await hmacRawKey(kService, "aws4_request");
  const signature = toHex(await hmacRawKey(kSigning, stringToSign));
  headers.authorization = "AWS4-HMAC-SHA256 Credential=" + accessKey + "/" + scope + ", SignedHeaders=" + signedNames + ", Signature=" + signature;
  const response = await fetch("https://" + host + path, { method: "POST", headers, body: payload });
  if (!response.ok) {
    await response.text();
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
}
async function issueJwt(env: AuthEnv, claims: AuthClaims) {
  const secret = env.AUTH_JWT_SECRET || "";
  if (secret.length < 32) throw new Error("AUTH_NOT_CONFIGURED");
  const head = toB64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = toB64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await hmacBytes(secret, head + "." + body);
  return head + "." + body + "." + toB64Url(signature);
}
export async function authenticate(request: Request, env: AuthEnv): Promise<Actor | null> {
  if (!env.AUTH_JWT_SECRET) return null;
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJwtPart(parts[0]);
    const claims = decodeJwtPart(parts[1]) as AuthClaims;
    if (header.alg !== "HS256" || header.typ !== "JWT" || !claims.sub || !claims.email || claims.email_verified !== true ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
      !Number.isFinite(claims.iat) || claims.iat > Date.now() / 1000 + 60 || claims.exp - claims.iat > (claims.login_audience === "admin" ? 4 : 12) * 60 * 60 + 60) return null;
    if (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE || claims.iss !== env.AUTH_ISSUER) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.AUTH_AUDIENCE)) return null;
    const email = claims.email.trim().toLowerCase();
    if (!validEmail(email)) return null;
    const key = await crypto.subtle.importKey("raw", encoder.encode(env.AUTH_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signature = fromB64Url(parts[2]);
    if (!await crypto.subtle.verify("HMAC", key, signature, encoder.encode(parts[0] + "." + parts[1]))) return null;
    if (claims.jti) {
      const session = await env.DB.prepare("SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND audience=? AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(claims.jti, claims.sub, claims.login_audience || "").first();
      if (!session) return null;
    }
    await env.DB.prepare("INSERT OR IGNORE INTO users(id,email,display_name) VALUES(?,?,?)")
      .bind(claims.sub, email, String(claims.name || "").slice(0, 160)).run();
    const user = await env.DB.prepare("SELECT email,status,display_name FROM users WHERE id=?")
      .bind(claims.sub).first<{ email: string; status: string; display_name: string }>();
    if (!user || user.status !== "active" || user.email.toLowerCase() !== email) return null;
    return {
      id: claims.sub, email, name: user.display_name || "",
      sessionId: claims.jti, loginAudience: claims.login_audience
    };
  } catch { return null; }
}
async function createUserForEmail(env: AuthEnv, email: string, name: string) {
  let user = await env.DB.prepare("SELECT id,email,status,display_name FROM users WHERE email=? COLLATE NOCASE")
    .bind(email).first<{ id: string; email: string; status: string; display_name: string }>();
  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO users(id,email,display_name) VALUES(?,?,?)")
      .bind(userId, email, name.slice(0, 160)).run();
    user = await env.DB.prepare("SELECT id,email,status,display_name FROM users WHERE email=? COLLATE NOCASE")
      .bind(email).first<{ id: string; email: string; status: string; display_name: string }>();
  }
  return user;
}
async function handleChallenge(request: Request, env: AuthEnv) {
  let body: any;
  try { body = await readAuthBody(request); } catch { return authFail(400, "INVALID_REQUEST", "Check the email address and try again."); }
  const email = String(body.email || "").trim().toLowerCase();
  const audience = body.audience;
  const organizationId = String(body.organizationId || "").trim() || null;
  if (!validEmail(email) || !validAudience(audience) || (organizationId && !/^[A-Za-z0-9-]{6,80}$/.test(organizationId)))
    return authFail(422, "INVALID_SIGN_IN_DETAILS", "Enter a valid email address and choose the correct sign-in page.");
  if (!env.AUTH_OTP_SECRET || env.AUTH_OTP_SECRET.length < 32 || !env.AUTH_JWT_SECRET || env.AUTH_JWT_SECRET.length < 32 || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE)
    return authFail(503, "AUTH_NOT_CONFIGURED", "Secure sign-in is not configured yet. Please contact the platform administrator.");
  const emailHash = await hmacHex(env.AUTH_OTP_SECRET, "email:" + email);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hmacHex(env.AUTH_OTP_SECRET, "ip:" + ip);
  const recentEmail = await env.DB.prepare("SELECT COUNT(*) AS total FROM auth_challenges WHERE email_hash=? AND created_at >= datetime('now','-15 minutes')")
    .bind(emailHash).first<{ total: number }>();
  const recentIp = await env.DB.prepare("SELECT COUNT(*) AS total FROM auth_challenges WHERE request_ip_hash=? AND created_at >= datetime('now','-15 minutes')")
    .bind(ipHash).first<{ total: number }>();
  const last = await env.DB.prepare("SELECT created_at FROM auth_challenges WHERE email_hash=? ORDER BY created_at DESC LIMIT 1")
    .bind(emailHash).first<{ created_at: string }>();
  if (Number(recentEmail?.total || 0) >= 5 || Number(recentIp?.total || 0) >= 20 ||
      (last && Date.now() - new Date(last.created_at.replace(" ", "T") + "Z").getTime() < 60_000))
    return authFail(429, "TOO_MANY_REQUESTS", "Too many code requests. Wait a little before trying again.");
  await env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') OR created_at < datetime('now','-2 days')").run();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') OR revoked_at < datetime('now','-7 days')").run();
  const code = randomCode();
  const challengeId = crypto.randomUUID();
  const codeHash = await hmacHex(env.AUTH_OTP_SECRET, "code:" + challengeId + ":" + emailHash + ":" + code);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.prepare("INSERT INTO auth_challenges(id,email_hash,audience,organization_id,code_hash,expires_at,request_ip_hash) VALUES(?,?,?,?,?,?,?)")
    .bind(challengeId, emailHash, audience, organizationId, codeHash, expiresAt, ipHash).run();
  try {
    await sesSendOtp(env, email, code);
  } catch {
    await env.DB.prepare("UPDATE auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=?").bind(challengeId).run();
    return authFail(503, "EMAIL_DELIVERY_UNAVAILABLE", "We could not send your sign-in code. Please try again later.");
  }
  return authJson({
    ok: true, challengeId, expiresInSeconds: 600, resendAfterSeconds: 60,
    message: "If this address can use this sign-in option, a verification code has been sent."
  }, 202);
}
async function handleVerify(request: Request, env: AuthEnv) {
  let body: any;
  try { body = await readAuthBody(request); } catch { return authFail(400, "INVALID_REQUEST", "Enter the six-digit code and try again."); }
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const challengeId = String(body.challengeId || "");
  if (!validEmail(email) || !/^\d{6}$/.test(code) || !/^[A-Za-z0-9-]{20,80}$/.test(challengeId))
    return authFail(422, "INVALID_CODE", "Enter the six-digit code sent to your email.");
  if (!env.AUTH_OTP_SECRET || !env.AUTH_JWT_SECRET || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE)
    return authFail(503, "AUTH_NOT_CONFIGURED", "Secure sign-in is not configured yet.");
  const emailHash = await hmacHex(env.AUTH_OTP_SECRET, "email:" + email);
  const challenge = await env.DB.prepare("SELECT id,audience,organization_id,code_hash,attempts FROM auth_challenges WHERE id=? AND email_hash=? AND consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .bind(challengeId, emailHash).first<{ id: string; audience: AuthAudience; organization_id: string | null; code_hash: string; attempts: number }>();
  if (!challenge || challenge.attempts >= 5) return authFail(400, "CODE_INVALID_OR_EXPIRED", "This code is invalid or expired. Request a new code.");
  const candidateHash = await hmacHex(env.AUTH_OTP_SECRET, "code:" + challengeId + ":" + emailHash + ":" + code);
  if (!constantTimeEqual(candidateHash, challenge.code_hash)) {
    await env.DB.prepare("UPDATE auth_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts+1>=5 THEN CURRENT_TIMESTAMP ELSE consumed_at END WHERE id=? AND consumed_at IS NULL")
      .bind(challengeId).run();
    return authFail(400, "CODE_INVALID_OR_EXPIRED", "This code is invalid or expired. Request a new code.");
  }
  const audience = challenge.audience;
  let user = await env.DB.prepare("SELECT id,email,status,display_name FROM users WHERE email=? COLLATE NOCASE")
    .bind(email).first<{ id: string; email: string; status: string; display_name: string }>();
  let role = "learner";
  let organizations: Array<{ id: string; name: string; slug: string; role: string }> = [];
  if (audience === "learner") {
    if (!user) user = await createUserForEmail(env, email, "");
    if (!user || user.status !== "active") return authFail(403, "ACCOUNT_UNAVAILABLE", "This account is not active. Contact the platform administrator.");
  } else if (audience === "organization") {
    const owned = await env.DB.prepare("SELECT id FROM organizations WHERE owner_email=? COLLATE NOCASE AND status='verified'")
      .bind(email).all<{ id: string }>();
    if (!user && !(owned.results || []).length) {
      await env.DB.prepare("UPDATE auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL").bind(challengeId).run();
      return authFail(403, "ORGANIZATION_ACCESS_REQUIRED", "This email is not an active member of a verified organization.");
    }
    if (!user) user = await createUserForEmail(env, email, "");
    if (!user || user.status !== "active") return authFail(403, "ACCOUNT_UNAVAILABLE", "This account is not active. Contact the platform administrator.");
    for (const org of owned.results || []) {
      await env.DB.prepare("INSERT OR IGNORE INTO organization_members(organization_id,user_id,role,status) VALUES(?,?,'owner','active')")
        .bind(org.id, user.id).run();
    }
    const orgRows = await env.DB.prepare("SELECT o.id,o.name,o.slug,m.role FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.status='active' AND o.status='verified' ORDER BY o.name")
      .bind(user.id).all<{ id: string; name: string; slug: string; role: string }>();
    organizations = orgRows.results || [];
    if (challenge.organization_id) organizations = organizations.filter(x => x.id === challenge.organization_id);
    if (!organizations.length) {
      await env.DB.prepare("UPDATE auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL").bind(challengeId).run();
      return authFail(403, "ORGANIZATION_ACCESS_REQUIRED", "This email is not an active member of a verified organization.");
    }
    role = organizations[0].role;
  } else {
    if (!user || user.status !== "active") {
      await env.DB.prepare("UPDATE auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL").bind(challengeId).run();
      return authFail(403, "SUPER_ADMIN_REQUIRED", "This email is not authorized for Super Admin access.");
    }
    const admin = await env.DB.prepare("SELECT status FROM platform_admins WHERE user_id=?").bind(user.id).first<{ status: string }>();
    if (!admin || admin.status !== "active") {
      await env.DB.prepare("UPDATE auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL").bind(challengeId).run();
      return authFail(403, "SUPER_ADMIN_REQUIRED", "This email is not authorized for Super Admin access.");
    }
    role = "super_admin";
  }
  const consumed = await env.DB.prepare("UPDATE auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL AND attempts<5")
    .bind(challengeId).run();
  if (!consumed.meta.changes) return authFail(409, "CHALLENGE_ALREADY_USED", "This sign-in code has already been used. Request a new code.");
  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const lifetime = audience === "admin" ? 4 * 60 * 60 : 12 * 60 * 60;
  const expiresAt = new Date((now + lifetime) * 1000).toISOString();
  const token = await issueJwt(env, {
    sub: user.id, email, email_verified: true, name: user.display_name || "",
    iss: env.AUTH_ISSUER, aud: env.AUTH_AUDIENCE, iat: now, exp: now + lifetime,
    jti: sessionId, login_audience: audience
  });
  await env.DB.prepare("INSERT INTO auth_sessions(id,user_id,audience,expires_at) VALUES(?,?,?,?)")
    .bind(sessionId, user.id, audience, expiresAt).run();
  await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,target_type,target_id,detail_json) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), user.id, "auth.login", "user", user.id, JSON.stringify({ audience, sessionId })).run();
  return authJson({
    ok: true, token, tokenType: "Bearer", expiresAt,
    user: { id: user.id, email, name: user.display_name || "", role },
    audience, organizations
  });
}
export async function handlePublicAuthRoute(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.method === "POST" && path === "/api/auth/challenge") return handleChallenge(request, env);
  if (request.method === "POST" && path === "/api/auth/verify") return handleVerify(request, env);
  return null;
}
