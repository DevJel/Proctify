-- Marketplace slugs are globally unique because public course detail URLs use the slug alone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_global_slug ON courses(slug);

-- Course staff access is narrower than organization membership.
CREATE TABLE IF NOT EXISTS course_staff (
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('instructor','reviewer')),
 assigned_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(course_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_course_staff_user ON course_staff(user_id,role);
CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course_id,created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_learner ON assignment_submissions(learner_id,status);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment ON assessment_attempts(assessment_id,status);
