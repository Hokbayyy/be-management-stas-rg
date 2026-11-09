-- Migration 044: Lab Feedback Surveys (Facilities & Ecosystem)

CREATE TABLE IF NOT EXISTS lab_surveys (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    enforcement_type VARCHAR(30) NOT NULL DEFAULT 'BANNER_ALERT', -- 'MANDATORY_REDIRECT', 'BANNER_ALERT'
    post_deadline_policy VARCHAR(30) NOT NULL DEFAULT 'EXPIRE_SOFT', -- 'BLOCK_ACCESS', 'EXPIRE_SOFT'
    target_audience VARCHAR(50) NOT NULL DEFAULT 'ALL', -- 'ALL', 'RISET_ONLY', 'MAGANG_ONLY'
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_survey_questions (
    id VARCHAR(64) PRIMARY KEY,
    survey_id VARCHAR(64) NOT NULL REFERENCES lab_surveys(id) ON DELETE CASCADE,
    question_type VARCHAR(30) NOT NULL, -- 'SHORT_TEXT', 'PARAGRAPH', 'MULTIPLE_CHOICE', 'CHECKBOX', 'LINEAR_SCALE', 'DROPDOWN'
    category VARCHAR(30) NOT NULL DEFAULT 'GENERAL', -- 'FACILITY', 'ECOSYSTEM', 'GENERAL'
    title TEXT NOT NULL,
    description TEXT,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 1,
    options JSONB DEFAULT '[]'::jsonb, -- Array of string options: ["Opsi 1", "Opsi 2"]
    scale_config JSONB DEFAULT NULL, -- {"min": 1, "max": 5, "min_label": "Sangat Buruk", "max_label": "Sangat Baik"}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_survey_submissions (
    id VARCHAR(64) PRIMARY KEY,
    survey_id VARCHAR(64) NOT NULL REFERENCES lab_surveys(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lab_survey_student UNIQUE (survey_id, student_id)
);

CREATE TABLE IF NOT EXISTS lab_survey_answers (
    id VARCHAR(64) PRIMARY KEY,
    submission_id VARCHAR(64) NOT NULL REFERENCES lab_survey_submissions(id) ON DELETE CASCADE,
    question_id VARCHAR(64) NOT NULL REFERENCES lab_survey_questions(id) ON DELETE CASCADE,
    answer_text TEXT,
    answer_options JSONB DEFAULT '[]'::jsonb,
    answer_number NUMERIC(5, 2) DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_surveys_status ON lab_surveys(status);
CREATE INDEX IF NOT EXISTS idx_lab_surveys_dates ON lab_surveys(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_lab_survey_questions_survey ON lab_survey_questions(survey_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lab_survey_submissions_survey ON lab_survey_submissions(survey_id);
CREATE INDEX IF NOT EXISTS idx_lab_survey_submissions_student ON lab_survey_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_lab_survey_answers_submission ON lab_survey_answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_lab_survey_answers_question ON lab_survey_answers(question_id);
