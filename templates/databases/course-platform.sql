-- Course platform: instructors publish courses made of sections and
-- lessons; students enrol, work through lessons, and leave reviews.
--
-- SQLite dialect for Bunny Database. Money is stored in integer minor
-- units (cents). Timestamps are ISO 8601 UTC text, kept current by the
-- updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'student'
    CHECK (role IN ('student', 'instructor', 'admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A price of 0 makes the course free.
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  cover_image_url TEXT,
  level TEXT NOT NULL DEFAULT 'beginner'
    CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS courses_instructor_id_idx
  ON courses (instructor_id);
CREATE INDEX IF NOT EXISTS courses_status_idx ON courses (status);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sections_course_id_position_idx
  ON sections (course_id, position);

-- video_id holds the Bunny Stream video GUID when kind is 'video'.
-- is_preview marks a lesson that anyone can watch without enrolling.
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video'
    CHECK (kind IN ('video', 'text', 'quiz', 'assignment')),
  content TEXT,
  video_id TEXT,
  duration_seconds INTEGER,
  is_preview INTEGER NOT NULL DEFAULT 0 CHECK (is_preview IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (section_id, slug)
);

CREATE INDEX IF NOT EXISTS lessons_section_id_position_idx
  ON lessons (section_id, position);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'refunded')),
  paid_cents INTEGER NOT NULL DEFAULT 0,
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS enrollments_course_id_idx
  ON enrollments (course_id);

-- One row per lesson a student has opened. Rows are absent until the
-- student starts the lesson. Save watched_seconds when playback
-- pauses or the lesson finishes; writing it on a timer turns one
-- student watching one video into a steady stream of writes.
CREATE TABLE IF NOT EXISTS lesson_progress (
  enrollment_id INTEGER NOT NULL
    REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed')),
  watched_seconds INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (enrollment_id, lesson_id)
);
-- Searched when a lesson is deleted.
CREATE INDEX IF NOT EXISTS lesson_progress_lesson_id_idx
  ON lesson_progress (lesson_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (course_id, user_id)
);
-- Searched when a user is deleted.
CREATE INDEX IF NOT EXISTS reviews_user_id_idx ON reviews (user_id);

-- Lessons completed out of lessons in the course, per enrolled
-- student. A course with no lessons yet reports 0 percent.
CREATE VIEW IF NOT EXISTS enrollment_progress AS
SELECT
  e.id AS enrollment_id,
  e.user_id,
  e.course_id,
  COUNT(l.id) AS total_lessons,
  COUNT(lp.lesson_id) AS completed_lessons,
  CASE
    WHEN COUNT(l.id) = 0 THEN 0
    ELSE ROUND(100.0 * COUNT(lp.lesson_id) / COUNT(l.id))
  END AS percent_complete
FROM enrollments e
LEFT JOIN sections s ON s.course_id = e.course_id
LEFT JOIN lessons l ON l.section_id = s.id
LEFT JOIN lesson_progress lp
  ON lp.enrollment_id = e.id
  AND lp.lesson_id = l.id
  AND lp.status = 'completed'
GROUP BY e.id;

CREATE TRIGGER IF NOT EXISTS users_set_updated_at AFTER UPDATE ON users BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS courses_set_updated_at
AFTER UPDATE ON courses BEGIN
  UPDATE courses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS lessons_set_updated_at
AFTER UPDATE ON lessons BEGIN
  UPDATE lessons SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS lesson_progress_set_updated_at
AFTER UPDATE ON lesson_progress BEGIN
  UPDATE lesson_progress
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE enrollment_id = NEW.enrollment_id AND lesson_id = NEW.lesson_id;
END;
