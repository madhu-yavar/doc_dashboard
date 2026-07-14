-- Migration: Add events_jsonb column to live_conversation_sessions
-- Reason: Enable proper event logging and WebSocket close attribution
-- Date: 2025-06-13

-- Add events_jsonb column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'live_conversation_sessions'
        AND column_name = 'events_jsonb'
    ) THEN
        ALTER TABLE live_conversation_sessions
        ADD COLUMN events_jsonb JSONB DEFAULT '[]';

        RAISE NOTICE 'events_jsonb column added successfully';
    ELSE
        RAISE NOTICE 'events_jsonb column already exists';
    END IF;
END $$;

-- Verify the change
SELECT
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'live_conversation_sessions'
  AND column_name = 'events_jsonb';