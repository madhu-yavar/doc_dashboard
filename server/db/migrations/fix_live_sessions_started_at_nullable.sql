-- Migration: Make live_conversation_sessions.started_at nullable
-- Reason: Draft sessions should not require a started_at timestamp
-- Date: 2025-06-18

-- Make started_at nullable to allow draft sessions without a start time
ALTER TABLE live_conversation_sessions
ALTER COLUMN started_at DROP NOT NULL;

-- Verify the change
SELECT
    column_name,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'live_conversation_sessions'
  AND column_name = 'started_at';
