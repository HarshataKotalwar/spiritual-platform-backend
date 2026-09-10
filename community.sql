CREATE TABLE IF NOT EXISTS community_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL
        REFERENCES community_groups(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_questions (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL
        REFERENCES community_groups(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_replies (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL
        REFERENCES community_questions(id)
        ON DELETE CASCADE,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_group_members_group_id
    ON community_group_members (group_id);

CREATE INDEX IF NOT EXISTS idx_community_group_members_user_id
    ON community_group_members (user_id);

CREATE INDEX IF NOT EXISTS idx_community_questions_group_id
    ON community_questions (group_id);

CREATE INDEX IF NOT EXISTS idx_community_questions_user_id
    ON community_questions (user_id);

CREATE INDEX IF NOT EXISTS idx_community_replies_question_id
    ON community_replies (question_id);

INSERT INTO community_groups (name, description)
SELECT 'Meditation Circle',
       'A quiet space to share practice, stillness, and questions about meditation.'
WHERE NOT EXISTS (
    SELECT 1 FROM community_groups WHERE name = 'Meditation Circle'
);

INSERT INTO community_groups (name, description)
SELECT 'Sacred Study',
       'Reflect together on scripture, wisdom teachings, and inner inquiry.'
WHERE NOT EXISTS (
    SELECT 1 FROM community_groups WHERE name = 'Sacred Study'
);

INSERT INTO community_groups (name, description)
SELECT 'Daily Sadhana Support',
       'Encouragement and discussion for sustaining a daily spiritual practice.'
WHERE NOT EXISTS (
    SELECT 1 FROM community_groups WHERE name = 'Daily Sadhana Support'
);

-- Additional columns, nested replies, and moderation:
-- run community_ops.sql after this file.
