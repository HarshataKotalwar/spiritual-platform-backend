-- Community participation, moderation, and discovery fields.
-- Preserves existing groups, members, questions, and replies.

ALTER TABLE community_groups
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE community_groups
    ADD COLUMN IF NOT EXISTS category VARCHAR(80);

ALTER TABLE community_groups
    ADD COLUMN IF NOT EXISTS banner_url TEXT;

ALTER TABLE community_groups
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
    ALTER TABLE community_groups
        ADD CONSTRAINT community_groups_status_check
        CHECK (status IN ('active', 'archived', 'removed'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

UPDATE community_groups
SET status = CASE WHEN is_active THEN 'active' ELSE 'archived' END
WHERE status IS NULL OR (is_active = FALSE AND status = 'active');

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_groups_name_lower
    ON community_groups (LOWER(name));

ALTER TABLE community_questions
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
    ALTER TABLE community_questions
        ADD CONSTRAINT community_questions_status_check
        CHECK (status IN ('active', 'removed'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE community_replies
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE community_replies
    ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES community_replies(id) ON DELETE CASCADE;

DO $$
BEGIN
    ALTER TABLE community_replies
        ADD CONSTRAINT community_replies_status_check
        CHECK (status IN ('active', 'removed'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_community_questions_status
    ON community_questions (status);

CREATE INDEX IF NOT EXISTS idx_community_replies_status
    ON community_replies (status);

CREATE INDEX IF NOT EXISTS idx_community_replies_parent_id
    ON community_replies (parent_id);

CREATE INDEX IF NOT EXISTS idx_community_groups_status
    ON community_groups (status);
