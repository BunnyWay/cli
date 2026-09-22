-- Video website: channels publish Bunny Stream videos, gather them
-- into playlists, and viewers watch, react, comment, and subscribe.
--
-- SQLite dialect for Bunny Database. Timestamps are ISO 8601 UTC text,
-- kept current by the updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS channels_owner_id_idx ON channels (owner_id);

-- The media itself lives in Bunny Stream: stream_library_id and
-- stream_video_id are what you pass to the Stream API and player.
-- Bunny Stream counts plays for you, so refresh view_count from its
-- statistics on a schedule. Incrementing it on every play would send
-- one write per viewer to the same row, which SQLite serialises.
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  stream_library_id INTEGER NOT NULL,
  stream_video_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'unlisted', 'private')),
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  view_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS videos_channel_id_idx ON videos (channel_id);

-- Serves the browse page: public videos, newest first.
CREATE INDEX IF NOT EXISTS videos_visibility_published_at_idx
  ON videos (visibility, published_at DESC);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'private')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (channel_id, slug)
);

CREATE TABLE IF NOT EXISTS playlist_videos (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (playlist_id, video_id)
);
-- Searched when a video is deleted.
CREATE INDEX IF NOT EXISTS playlist_videos_video_id_idx
  ON playlist_videos (video_id);

-- Where a viewer got to, so the player can offer to resume. One row
-- per viewer per video rather than one per play: write it when
-- playback pauses or finishes, not on a timer while the video runs.
CREATE TABLE IF NOT EXISTS watch_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  watched_seconds INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, video_id)
);

-- Serves the continue watching row: what this viewer last picked up.
CREATE INDEX IF NOT EXISTS watch_progress_user_id_updated_at_idx
  ON watch_progress (user_id, updated_at DESC);
-- Searched when a video is deleted.
CREATE INDEX IF NOT EXISTS watch_progress_video_id_idx
  ON watch_progress (video_id);

-- The primary key allows one reaction per viewer per video, so
-- switching from a like to a dislike replaces the row.
CREATE TABLE IF NOT EXISTS reactions (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'dislike')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (video_id, user_id)
);
-- Searched when a user is deleted.
CREATE INDEX IF NOT EXISTS reactions_user_id_idx
  ON reactions (user_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS comments_video_id_idx ON comments (video_id);
-- Searched when a user or a parent comment is deleted.
CREATE INDEX IF NOT EXISTS comments_user_id_idx ON comments (user_id);
CREATE INDEX IF NOT EXISTS comments_parent_id_idx
  ON comments (parent_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  notify INTEGER NOT NULL DEFAULT 1 CHECK (notify IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_channel_id_idx
  ON subscriptions (channel_id);

CREATE TRIGGER IF NOT EXISTS users_set_updated_at AFTER UPDATE ON users BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS channels_set_updated_at
AFTER UPDATE ON channels BEGIN
  UPDATE channels SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

-- Named columns only, so refreshing view_count does not make the
-- video look freshly edited.
CREATE TRIGGER IF NOT EXISTS videos_set_updated_at
AFTER UPDATE OF
  title, description, thumbnail_url, duration_seconds, visibility,
  status, published_at
ON videos BEGIN
  UPDATE videos SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS playlists_set_updated_at
AFTER UPDATE ON playlists BEGIN
  UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS comments_set_updated_at
AFTER UPDATE ON comments BEGIN
  UPDATE comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS watch_progress_set_updated_at
AFTER UPDATE ON watch_progress BEGIN
  UPDATE watch_progress
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = NEW.user_id AND video_id = NEW.video_id;
END;
