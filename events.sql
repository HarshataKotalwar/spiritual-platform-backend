CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    banner_url TEXT,

    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('online', 'offline')),

    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,

    location TEXT,
    meeting_url TEXT,

    capacity INTEGER,
    fee NUMERIC(10, 2) DEFAULT 0,

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'cancelled')),

    created_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_registrations (
    id SERIAL PRIMARY KEY,

    event_id INTEGER NOT NULL
        REFERENCES events(id)
        ON DELETE CASCADE,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    registered_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(event_id, user_id)
);

-- Attendance, certificates, indexes, and safer created_by deletion:
-- run events_ops.sql after this file.