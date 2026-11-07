import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
const sw = readFileSync("sw.js", "utf8");

assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, "viewport must be configured");
assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/, "PWA manifest must be linked");
assert.match(html, /class="skip-link" href="#view"/, "keyboard skip link must exist");
assert.match(html, /id="view"/, "main content target must exist");
assert.match(html, /aria-label="Main navigation"/, "main navigation must have an accessible label");
assert.ok(html.includes('href="#/login/learner"'), "learner sign-in entry must exist");
assert.ok(html.includes('href="#/login/organization"'), "organization and educator sign-in entry must exist");
assert.ok(html.includes('href="#/login/admin"'), "Super Admin sign-in entry must exist");
assert.match(html, /function LoginPage\(role="learner"\)/, "role-specific login page renderer must exist");
assert.match(html, /Sign-in connection is not active yet/, "unconfigured authentication must be clearly disclosed");

assert.match(html, /Courses &amp; assessments/, "course and assessment catalog tab must be visible");
assert.match(html, /My learning/, "learner results tab must be visible");
assert.match(html, /My certificates/, "certificate tab must be visible");
assert.match(html, /Verify certificate/, "certificate verification tab must be visible");
assert.match(html, /Admin console/, "platform administration tab must be visible");

assert.doesNotMatch(html, /PROCTIFY/, "visible product branding must use PROCTORAVA");
assert.match(html, /@media\(max-width:1024px\)/, "tablet layout breakpoint must exist");
assert.match(html, /@media\(max-width:760px\)/, "small tablet layout breakpoint must exist");
assert.match(html, /@media\(max-width:560px\)/, "mobile layout breakpoint must exist");
assert.match(html, /prefers-reduced-motion:reduce/, "reduced motion support must exist");
assert.match(html, /:focus-visible/, "visible keyboard focus must exist");
assert.match(html, /serviceWorker\.register\("\.\/sw\.js"/, "service worker must be registered");
assert.match(html, /\.pip \.pip-label\{position:static/, "video caption must not sit over the video");
assert.ok(manifest.name.includes("PROCTORAVA"), "manifest must use PROCTORAVA branding");
assert.ok(manifest.display === "standalone", "manifest must open in app mode");
assert.ok(manifest.icons.length >= 2, "manifest must provide install icons");
for (const icon of manifest.icons) assert.ok(existsSync(icon.src), `missing PWA icon: ${icon.src}`);
assert.match(sw, /url\.pathname\.includes\("\/api\/"\)/, "API requests must never enter offline cache");
assert.match(sw, /request\.headers\.has\("Authorization"\)/, "authenticated requests must never enter offline cache");
console.log("PROCTORAVA frontend checks passed.");
