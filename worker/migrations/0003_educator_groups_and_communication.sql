PRAGMA foreign_keys = ON;

-- Organization-owned teaching groups and sections.
CREATE TABLE IF NOT EXISTS learning_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  section_code TEXT,
  subject TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_groups_section
  ON learning_groups(organization_id, section_code) WHERE section_code IS NOT NULL AND section_code <> '';
CREATE INDEX IF NOT EXISTS idx_learning_groups_org ON learning_groups(organization_id,status);

CREATE TABLE IF NOT EXISTS learning_group_educators (
  group_id TEXT NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS learning_group_learners (
  group_id TEXT NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id,learner_id)
);
CREATE INDEX IF NOT EXISTS idx_group_learners_learner ON learning_group_learners(learner_id,group_id);

-- A group may be assigned a course/subject as a whole; each learner keeps a normal enrollment.
CREATE TABLE IF NOT EXISTS learning_group_courses (
  group_id TEXT NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at TEXT,
  PRIMARY KEY(group_id,course_id)
);
CREATE INDEX IF NOT EXISTS idx_group_courses_course ON learning_group_courses(course_id,group_id);

CREATE TABLE IF NOT EXISTS learning_group_activities (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES course_lessons(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(course_id IS NOT NULL OR lesson_id IS NOT NULL OR assignment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_group_activities_group ON learning_group_activities(group_id,due_at);

CREATE TABLE IF NOT EXISTS learning_group_announcements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS learner_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES learning_groups(id) ON DELETE SET NULL,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_learner_messages_inbox ON learner_messages(recipient_id,created_at);
CREATE INDEX IF NOT EXISTS idx_learner_messages_org ON learner_messages(organization_id,group_id,created_at);
