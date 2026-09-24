-- Help Centre, FAQ knowledge base, and support tickets.
-- Does not alter Events, Volunteering, Community, Meditation, or Notifications tables.

CREATE TABLE IF NOT EXISTS help_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS help_faqs (
    id SERIAL PRIMARY KEY,
    category_id INTEGER
        REFERENCES help_categories(id)
        ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    search_keywords TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS help_faq_feedback (
    id SERIAL PRIMARY KEY,
    faq_id INTEGER NOT NULL
        REFERENCES help_faqs(id)
        ON DELETE CASCADE,
    user_id INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    helpful BOOLEAN NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq;

CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    ticket_number VARCHAR(30) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    category_id INTEGER
        REFERENCES help_categories(id)
        ON DELETE SET NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open'
        CHECK (
            status IN (
                'open',
                'in_progress',
                'waiting_for_user',
                'resolved',
                'closed'
            )
        ),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    related_entity_type VARCHAR(50),
    related_entity_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL
        REFERENCES support_tickets(id)
        ON DELETE CASCADE,
    sender_user_id INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,
    sender_role VARCHAR(20) NOT NULL
        CHECK (sender_role IN ('user', 'mentor', 'admin')),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_help_faq_feedback_user
    ON help_faq_feedback (faq_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_help_categories_active
    ON help_categories (is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_help_faqs_status
    ON help_faqs (status);

CREATE INDEX IF NOT EXISTS idx_help_faqs_category
    ON help_faqs (category_id);

CREATE INDEX IF NOT EXISTS idx_help_faqs_display
    ON help_faqs (display_order, id);

CREATE INDEX IF NOT EXISTS idx_help_faqs_search
    ON help_faqs (status, category_id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
    ON support_tickets (user_id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
    ON support_tickets (status);

CREATE INDEX IF NOT EXISTS idx_support_tickets_priority
    ON support_tickets (priority);

CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at
    ON support_tickets (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_category
    ON support_tickets (category_id);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id
    ON support_ticket_messages (ticket_id, created_at);

INSERT INTO help_categories (name, slug, description, icon, display_order)
VALUES
    ('Events', 'events', 'Registration, sessions, and certificates.', 'Calendar', 10),
    ('Volunteering', 'volunteering', 'Applications and seva opportunities.', 'HeartHandshake', 20),
    ('Community', 'community', 'Groups, questions, and discussion.', 'MessagesSquare', 30),
    ('Meditation', 'meditation', 'Sessions, progress, and bookmarks.', 'Flower2', 40),
    ('Courses', 'courses', 'Learning and course access.', 'BookOpen', 50),
    ('Account & Login', 'account', 'Registration, verification, and passwords.', 'UserCog', 60),
    ('Technical Issue', 'technical', 'Something is not working as expected.', 'Wrench', 70),
    ('General', 'general', 'Other questions about the platform.', 'CircleHelp', 80)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    display_order = EXCLUDED.display_order,
    updated_at = NOW();

INSERT INTO help_faqs (category_id, question, answer, search_keywords, status, display_order)
SELECT c.id, v.question, v.answer, v.search_keywords, 'published', v.display_order
FROM (
    VALUES
        (
            'events',
            'How do I register for an event?',
            'Open Events, choose a published event, and select Register. You need to be signed in. If the event is a draft, cancelled, or already full, registration will not be available.',
            'register event sign up booking workshop',
            10
        ),
        (
            'events',
            'Where can I see my registered events?',
            'After you sign in, open My Events from your dashboard. That list shows events you have registered for, including attendance and certificate status when they are available.',
            'my events registered upcoming',
            20
        ),
        (
            'events',
            'How do I join an online event?',
            'Register first. Then open the event page near the scheduled start time. Registered participants can join the session from there. Meeting links are shown to registered participants and are hidden after the event ends.',
            'join online meeting link zoom session',
            30
        ),
        (
            'events',
            'What happens if an event is full?',
            'When an event reaches its capacity, new registrations are declined and you will see that the event is full. You can still view the event details and look for other published events.',
            'full capacity waitlist seats',
            40
        ),
        (
            'events',
            'Where can I find my event certificate?',
            'Certificates become available after your attendance is marked present and an admin issues the certificate. Check the event page or My Events. If attendance is still pending, the certificate will not appear yet.',
            'certificate attendance present download',
            50
        ),
        (
            'volunteering',
            'What is online volunteering?',
            'Online volunteering opportunities take place remotely and include a meeting link instead of a physical location. Offline opportunities meet at a listed place. Each opportunity shows its type on the Volunteering page.',
            'online volunteer virtual remote seva',
            10
        ),
        (
            'volunteering',
            'How do I apply for a volunteering opportunity?',
            'Open Volunteering, choose a published opportunity, and select Apply. You must be signed in. Applications are only accepted while the opportunity is published and still has capacity.',
            'apply volunteering application seva',
            20
        ),
        (
            'volunteering',
            'Where can I see my volunteering applications?',
            'Open My Volunteering from your dashboard after you sign in. You can review application status such as applied, approved, rejected, or completed.',
            'my volunteering applications status',
            30
        ),
        (
            'volunteering',
            'What happens after my application is approved?',
            'You will receive a notification and your status changes to approved. Join at the scheduled date and time shown on the opportunity. Attendance and completion are managed by an admin after you participate.',
            'approved volunteer next steps reminder',
            40
        ),
        (
            'community',
            'How do I join a community?',
            'Sign in and open Community. Choose a group and select Join. You need to be a member before you can start or reply to discussions in that group.',
            'join community group member',
            10
        ),
        (
            'community',
            'How do I ask a question?',
            'Join the community group first, then share a question from that group page. Title and details are required. Only members of an active group can post.',
            'ask question discussion post',
            20
        ),
        (
            'community',
            'How do I answer or comment?',
            'Open a discussion and add an answer if you are a group member. You can also comment on an existing answer. Mentors and participants use the same discussion thread.',
            'answer comment reply discussion',
            30
        ),
        (
            'community',
            'How do I report inappropriate content?',
            'There is no separate report button yet. Create a support request from Help and include a link or description of the discussion. Admins can remove questions and replies from Community management.',
            'report inappropriate moderation abuse',
            40
        ),
        (
            'meditation',
            'How do I access meditation content?',
            'Sign in and open Meditation from the Practice section of your dashboard. Available audio and video sessions are listed there when they have been added to the library.',
            'meditation listen session audio video',
            10
        ),
        (
            'meditation',
            'How do I bookmark meditation content?',
            'Open a meditation session while signed in and use Bookmark to save it. You can turn the bookmark off the same way. Bookmarking is stored on your account.',
            'bookmark save meditation favourite',
            20
        ),
        (
            'courses',
            'How do I find courses?',
            'Courses appear under Learning in your dashboard when they are available. A full course catalogue is not part of the platform yet. If you have a course question, create a support request.',
            'courses learning lessons catalogue',
            10
        ),
        (
            'account',
            'How do I register?',
            'Open Register, enter your name, email, and password, then submit. You will need to verify your email with a one-time code before you can sign in.',
            'register signup create account',
            10
        ),
        (
            'account',
            'How do I verify my account?',
            'After registration, check your email for a one-time code and enter it on the Verify Email page. If the code expires, request a new one from that page.',
            'verify otp email confirmation code',
            20
        ),
        (
            'account',
            'What should I do if I forgot my password?',
            'Open Forgot Password, enter your email, and follow the reset link sent to you. Then choose a new password on the Reset Password page.',
            'forgot password reset email',
            30
        ),
        (
            'account',
            'What should I do if I don''t receive my OTP?',
            'Check spam or junk folders, then use Resend on the Verify Email page. The code is time-limited. If it still does not arrive, create a support request with the email you used to register.',
            'otp missing resend verification code',
            40
        ),
        (
            'technical',
            'What should I do if a page is not working?',
            'Refresh the page, try another browser, and confirm you are signed in if the page is private. If the problem continues, create a support request and include the page and what you were trying to do.',
            'bug error broken page technical',
            10
        ),
        (
            'general',
            'How can I get more help?',
            'Search this Help Centre or ask the Help Assistant using a short question. If you still need a person, create a support request. You can follow your requests from My Support after you sign in.',
            'help support contact ticket assistant',
            10
        )
) AS v(slug, question, answer, search_keywords, display_order)
JOIN help_categories c ON c.slug = v.slug
WHERE NOT EXISTS (
    SELECT 1 FROM help_faqs f WHERE f.question = v.question
);
