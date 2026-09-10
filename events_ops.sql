-- Events operational tables, indexes, and safer creator FK.
-- Does not drop existing event or registration data.

CREATE TABLE IF NOT EXISTS event_attendance (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL
        REFERENCES events(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('present', 'absent')),
    marked_at TIMESTAMP DEFAULT NOW(),
    marked_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS event_certificates (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL
        REFERENCES events(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    certificate_number VARCHAR(80) NOT NULL UNIQUE,
    issued_at TIMESTAMP DEFAULT NOW(),
    certificate_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_events_event_date ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations (event_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_user_id ON event_registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_event_attendance_event_id ON event_attendance (event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendance_user_id ON event_attendance (user_id);
CREATE INDEX IF NOT EXISTS idx_event_certificates_event_id ON event_certificates (event_id);
CREATE INDEX IF NOT EXISTS idx_event_certificates_user_id ON event_certificates (user_id);

DO $$
BEGIN
    ALTER TABLE events ALTER COLUMN created_by DROP NOT NULL;
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_created_by_fkey;
    ALTER TABLE events
        ADD CONSTRAINT events_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL;
EXCEPTION
    WHEN others THEN NULL;
END $$;
