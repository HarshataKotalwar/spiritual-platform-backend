-- User-specific notification dismissal.
-- Soft-hides a notification for its owner without deleting the row.

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_notifications_user_active
    ON notifications (user_id, created_at DESC)
    WHERE dismissed_at IS NULL;
