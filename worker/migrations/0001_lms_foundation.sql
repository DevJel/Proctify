PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 display_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS organization_applications (
 id TEXT PRIMARY KEY, organization_name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 organization_type TEXT NOT NULL CHECK(organization_type IN ('school','company','independent_publisher')),
 applicant_name TEXT NOT NULL, applicant_email TEXT NOT NULL COLLATE NOCASE, website TEXT,
 country_code TEXT, registration_reference TEXT,
 verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','in_review','verified','rejected')),
 reviewer_id TEXT, reviewer_note TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS organizations (
 id TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE REFERENCES organization_applications(id),
 name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 organization_type TEXT NOT NULL CHECK(organization_type IN ('school','company','independent_publisher')),
 owner_email TEXT NOT NULL COLLATE NOCASE,
 status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('verified','suspended','closed')),
 branding_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS organization_members (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','administrator','publisher','instructor','reviewer','learner')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','suspended')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS platform_admins (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS verification_documents (
 id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES organization_applications(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
 uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS organization_domains (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 hostname TEXT NOT NULL UNIQUE COLLATE NOCASE, verification_token_hash TEXT NOT NULL,
 verified_at TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','disabled')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS courses (
 id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id),
 owner_type TEXT NOT NULL CHECK(owner_type IN ('proctify','organization')),
 slug TEXT NOT NULL, title TEXT NOT NULL, short_description TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General',
 language_code TEXT NOT NULL DEFAULT 'en', level TEXT NOT NULL DEFAULT 'all_levels',
 price_minor INTEGER NOT NULL DEFAULT 0 CHECK(price_minor>=0), currency TEXT NOT NULL DEFAULT 'USD',
 certificate_enabled INTEGER NOT NULL DEFAULT 0 CHECK(certificate_enabled IN (0,1)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','published','archived')),
 created_by TEXT NOT NULL REFERENCES users(id), published_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,slug),
 CHECK((owner_type='proctify' AND organization_id IS NULL) OR (owner_type='organization' AND organization_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS course_modules (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS course_lessons (
 id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
 title TEXT NOT NULL, lesson_type TEXT NOT NULL CHECK(lesson_type IN ('video','text','document','link','presentation','quiz','assignment')),
 content_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
 is_preview INTEGER NOT NULL DEFAULT 0 CHECK(is_preview IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS learning_assets (
 id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id),
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 lesson_id TEXT REFERENCES course_lessons(id) ON DELETE CASCADE, object_key TEXT NOT NULL UNIQUE,
 file_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
 uploaded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS enrollments (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), learner_id TEXT NOT NULL REFERENCES users(id),
 organization_id TEXT REFERENCES organizations(id),
 source TEXT NOT NULL DEFAULT 'marketplace' CHECK(source IN ('marketplace','organization_assignment','promotion','admin_grant')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','refunded','revoked')),
 enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, UNIQUE(course_id,learner_id)
);
CREATE TABLE IF NOT EXISTS lesson_progress (
 enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
 lesson_id TEXT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','completed')),
 last_position_seconds INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(enrollment_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS assignments (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 lesson_id TEXT REFERENCES course_lessons(id) ON DELETE SET NULL,
 title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', due_at TEXT, max_score REAL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assignment_submissions (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES users(id), response_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','reviewed','returned')),
 score REAL, feedback TEXT, submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, UNIQUE(assignment_id,learner_id)
);
CREATE TABLE IF NOT EXISTS proctify_assessments (
 assessment_id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
 owner_type TEXT NOT NULL DEFAULT 'proctify' CHECK(owner_type='proctify'),
 catalog_version TEXT NOT NULL DEFAULT '1', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
INSERT OR IGNORE INTO proctify_assessments(assessment_id,title,category) VALUES
 ('behavioral','Behavioral Style Profile','Behavioral'),
 ('bigfive','Work Personality Inventory','Personality'),
 ('culture','Culture-Fit Profile','Culture'),
 ('cq','Cultural Intelligence (CQ)','Culture'),
 ('eq','Emotional Intelligence Profile','Behavioral'),
 ('conflict','Conflict Management Style','Behavioral'),
 ('values','Work Values & Motivators','Culture'),
 ('sjt','Workplace Judgment','Judgment'),
 ('cognitive','Cognitive Aptitude Battery','Cognitive'),
 ('english','English Proficiency Test','Language'),
 ('callcenter','Call Center Best Practices','Skills'),
 ('itskills','Information Technology','Skills');
CREATE TRIGGER IF NOT EXISTS protect_proctify_assessments_update BEFORE UPDATE ON proctify_assessments
BEGIN SELECT RAISE(ABORT,'Proctify-owned assessment catalog is read-only'); END;
CREATE TRIGGER IF NOT EXISTS protect_proctify_assessments_delete BEFORE DELETE ON proctify_assessments
BEGIN SELECT RAISE(ABORT,'Proctify-owned assessment catalog cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS assessment_attempts (
 id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES proctify_assessments(assessment_id),
 learner_id TEXT NOT NULL REFERENCES users(id), organization_id TEXT REFERENCES organizations(id),
 status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','submitted','scored','voided')),
 score_json TEXT, report_hash TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 submitted_at TEXT, scored_at TEXT
);
CREATE TABLE IF NOT EXISTS certificates (
 id TEXT PRIMARY KEY, verification_code TEXT NOT NULL UNIQUE, learner_id TEXT NOT NULL REFERENCES users(id),
 course_id TEXT REFERENCES courses(id), assessment_attempt_id TEXT REFERENCES assessment_attempts(id),
 issuer_type TEXT NOT NULL CHECK(issuer_type IN ('proctify','organization')),
 organization_id TEXT REFERENCES organizations(id), title TEXT NOT NULL,
 issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, revoked_at TEXT, revoke_reason TEXT,
 CHECK(course_id IS NOT NULL OR assessment_attempt_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id), currency TEXT NOT NULL,
 subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor>=0), discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor>=0),
 total_minor INTEGER NOT NULL CHECK(total_minor>=0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded','partially_refunded','cancelled')),
 provider TEXT NOT NULL, provider_reference TEXT UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL REFERENCES courses(id), publisher_organization_id TEXT REFERENCES organizations(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL,
 processed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider,provider_event_id)
);
CREATE TABLE IF NOT EXISTS publisher_ledger (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 order_item_id TEXT REFERENCES order_items(id),
 entry_type TEXT NOT NULL CHECK(entry_type IN ('sale','platform_fee','refund','adjustment','payout')),
 amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, reference TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS publisher_payouts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','processing','paid','failed','cancelled')),
 provider_reference TEXT UNIQUE, requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TEXT
);
CREATE TABLE IF NOT EXISTS course_reviews (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 review_text TEXT NOT NULL DEFAULT '', moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK(moderation_status IN ('pending','published','hidden')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(course_id,learner_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT, organization_id TEXT, action TEXT NOT NULL,
 target_type TEXT NOT NULL, target_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}',
 request_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_apps_status ON organization_applications(verification_status,created_at);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id,status);
CREATE INDEX IF NOT EXISTS idx_courses_public ON courses(status,published_at);
CREATE INDEX IF NOT EXISTS idx_courses_org ON courses(organization_id,status);
CREATE INDEX IF NOT EXISTS idx_enrollments_learner ON enrollments(learner_id,status);
CREATE INDEX IF NOT EXISTS idx_attempts_learner ON assessment_attempts(learner_id,started_at);
CREATE INDEX IF NOT EXISTS idx_certificates_learner ON certificates(learner_id,issued_at);
CREATE INDEX IF NOT EXISTS idx_ledger_org ON publisher_ledger(organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id,created_at);
