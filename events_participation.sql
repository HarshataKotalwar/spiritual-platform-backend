-- Participation sessions for automated attendance.
-- Does not drop existing event_attendance or certificate data.

CREATE TABLE IF NOT EXISTS event_attendance_sessions (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL
        REFERENCES events(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    left_at TIMESTAMP,
    duration_seconds INTEGER,
    last_heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_attendance_sessions_event_id
    ON event_attendance_sessions (event_id);

CREATE INDEX IF NOT EXISTS idx_event_attendance_sessions_user_id
    ON event_attendance_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_event_attendance_sessions_open
    ON event_attendance_sessions (event_id, user_id)
    WHERE left_at IS NULL;

ALTER TABLE event_attendance
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'admin';

DO $$
BEGIN
    ALTER TABLE event_attendance
        ADD CONSTRAINT event_attendance_source_check
        CHECK (source IN ('auto', 'admin'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
