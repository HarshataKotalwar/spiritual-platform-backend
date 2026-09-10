-- Volunteering opportunities, applications, attendance, and certificate records.
-- Does not alter Events or Community tables.

CREATE TABLE IF NOT EXISTS volunteer_opportunities (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100),
    banner_url TEXT,
    volunteer_type VARCHAR(20) NOT NULL
        CHECK (volunteer_type IN ('online', 'offline')),
    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    location TEXT,
    meeting_url TEXT,
    capacity INTEGER,
    requirements TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'closed', 'completed', 'cancelled')),
    created_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT volunteer_opportunities_time_check
        CHECK (end_time > start_time),
    CONSTRAINT volunteer_opportunities_capacity_check
        CHECK (capacity IS NULL OR capacity > 0)
);

CREATE TABLE IF NOT EXISTS volunteer_applications (
    id SERIAL PRIMARY KEY,
    opportunity_id INTEGER NOT NULL
        REFERENCES volunteer_opportunities(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'applied'
        CHECK (status IN ('applied', 'approved', 'rejected', 'cancelled', 'completed')),
    applied_at TIMESTAMP DEFAULT NOW(),
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    UNIQUE (opportunity_id, user_id)
);

CREATE TABLE IF NOT EXISTS volunteer_attendance (
    id SERIAL PRIMARY KEY,
    opportunity_id INTEGER NOT NULL
        REFERENCES volunteer_opportunities(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    application_id INTEGER NOT NULL
        REFERENCES volunteer_applications(id)
        ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'absent'
        CHECK (status IN ('present', 'absent', 'partial')),
    check_in TIMESTAMP,
    check_out TIMESTAMP,
    duration_minutes INTEGER NOT NULL DEFAULT 0
        CHECK (duration_minutes >= 0),
    source VARCHAR(20) NOT NULL DEFAULT 'admin'
        CHECK (source IN ('admin', 'system')),
    marked_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (opportunity_id, user_id)
);

CREATE TABLE IF NOT EXISTS volunteer_certificates (
    id SERIAL PRIMARY KEY,
    opportunity_id INTEGER NOT NULL
        REFERENCES volunteer_opportunities(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    application_id INTEGER NOT NULL
        REFERENCES volunteer_applications(id)
        ON DELETE CASCADE,
    certificate_number VARCHAR(80) NOT NULL UNIQUE,
    issued_at TIMESTAMP DEFAULT NOW(),
    certificate_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (opportunity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_volunteer_opportunities_status
    ON volunteer_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_volunteer_opportunities_event_date
    ON volunteer_opportunities (event_date);
CREATE INDEX IF NOT EXISTS idx_volunteer_opportunities_type
    ON volunteer_opportunities (volunteer_type);
CREATE INDEX IF NOT EXISTS idx_volunteer_applications_opportunity_id
    ON volunteer_applications (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_applications_user_id
    ON volunteer_applications (user_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_applications_status
    ON volunteer_applications (status);
CREATE INDEX IF NOT EXISTS idx_volunteer_attendance_opportunity_id
    ON volunteer_attendance (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_certificates_opportunity_id
    ON volunteer_certificates (opportunity_id);
