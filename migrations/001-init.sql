-- 001 · Khởi tạo database hsk-tuky (đã chạy ngày 27/10/2026 qua connector Cloudflare)
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', pwd_hash TEXT NOT NULL, pwd_salt TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS session (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_session_user ON session(user_id);
CREATE TABLE IF NOT EXISTS progress (user_id TEXT PRIMARY KEY, learned TEXT NOT NULL DEFAULT '[]', stats TEXT NOT NULL DEFAULT '{}', level INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS comment (id INTEGER PRIMARY KEY AUTOINCREMENT, story_id INTEGER NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_comment_story ON comment(story_id, created_at);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, score INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_activity_user ON activity(user_id, created_at);
-- Tài khoản admin đầu tiên: nam / hsk2026 (bắt buộc đổi mật khẩu lần đầu)
