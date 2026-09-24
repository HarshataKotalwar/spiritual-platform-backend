-- Centralized notification management.
-- Does not alter Events, Volunteering, Community, Courses, or Meditation tables.

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    entity_type VARCHAR(100),
    entity_id INTEGER,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed_at TIMESTAMP,
    source VARCHAR(20) NOT NULL DEFAULT 'automatic'
        CHECK (source IN ('automatic', 'manual')),
    channel VARCHAR(20) NOT NULL DEFAULT 'in_app'
        CHECK (channel IN ('in_app', 'email', 'push')),
    rule_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    event_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    volunteering_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    camp_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    course_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    meditation_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    community_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_rules (
    id SERIAL PRIMARY KEY,
    notification_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    timing_minutes INTEGER,
    audience VARCHAR(100) NOT NULL,
    title_template TEXT,
    message_template TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT notification_rules_timing_check
        CHECK (timing_minutes IS NULL OR timing_minutes > 0)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    notification_type VARCHAR(100) NOT NULL,
    rule_id INTEGER
        REFERENCES notification_rules(id)
        ON DELETE SET NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id INTEGER NOT NULL,
    occurrence_key VARCHAR(120) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT notification_deliveries_unique
        UNIQUE (user_id, notification_type, entity_type, entity_id, occurrence_key, channel)
);

DO $$
BEGIN
    ALTER TABLE notifications
        ADD CONSTRAINT notifications_rule_id_fkey
        FOREIGN KEY (rule_id)
        REFERENCES notification_rules(id)
        ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
    ON notifications (is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type
    ON notifications (type);

CREATE INDEX IF NOT EXISTS idx_notifications_entity
    ON notifications (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, is_read, created_at DESC);

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_notifications_user_active
    ON notifications (user_id, created_at DESC)
    WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id
    ON notification_preferences (user_id);

CREATE INDEX IF NOT EXISTS idx_notification_rules_type
    ON notification_rules (notification_type, entity_type);

CREATE INDEX IF NOT EXISTS idx_notification_rules_enabled
    ON notification_rules (enabled);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_entity
    ON notification_deliveries (entity_type, entity_id, notification_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_rules_natural
    ON notification_rules (
        notification_type,
        entity_type,
        audience,
        (COALESCE(timing_minutes, -1))
    );

INSERT INTO notification_rules (
    notification_type,
    entity_type,
    enabled,
    timing_minutes,
    audience,
    title_template,
    message_template
)
SELECT v.notification_type, v.entity_type, v.enabled, v.timing_minutes, v.audience, v.title_template, v.message_template
FROM (
    VALUES
        ('EVENT_PUBLISHED', 'event', TRUE, NULL::integer, 'all', 'New Event Available', '{{title}} has been added.'),
        ('EVENT_REMINDER', 'event', TRUE, 1440, 'registered_participants', 'Event reminder', '{{title}} starts in 24 hours.'),
        ('EVENT_REMINDER', 'event', TRUE, 60, 'registered_participants', 'Event reminder', '{{title}} starts in 1 hour.'),
        ('VOLUNTEERING_PUBLISHED', 'volunteering', TRUE, NULL, 'all', 'New Volunteering Opportunity', '{{title}} has been added.'),
        ('VOLUNTEERING_REMINDER', 'volunteering', TRUE, 1440, 'approved_volunteers', 'Volunteering reminder', '{{title}} starts in 24 hours.'),
        ('VOLUNTEERING_REMINDER', 'volunteering', TRUE, 60, 'approved_volunteers', 'Volunteering reminder', '{{title}} starts in 1 hour.'),
        ('NEW_COURSE', 'course', TRUE, NULL, 'all', 'New Course Available', '{{title}} has been added.'),
        ('NEW_MEDITATION', 'meditation', TRUE, NULL, 'all', 'New Meditation Available', '{{title}} has been added.'),
        ('NEW_CAMP', 'camp', TRUE, NULL, 'all', 'New Camp Available', '{{title}} has been added.')
) AS v(notification_type, entity_type, enabled, timing_minutes, audience, title_template, message_template)
WHERE NOT EXISTS (
    SELECT 1
    FROM notification_rules r
    WHERE r.notification_type = v.notification_type
      AND r.entity_type = v.entity_type
      AND r.audience = v.audience
      AND COALESCE(r.timing_minutes, -1) = COALESCE(v.timing_minutes, -1)
);
