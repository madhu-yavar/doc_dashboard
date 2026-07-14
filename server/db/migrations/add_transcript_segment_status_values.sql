-- Migration: Add live transcript segment status values
-- Reason: Live transcript segments may be represented as interim/final in
-- application payloads. Existing databases need these enum values available
-- for direct repository writes and future schema-aligned persistence.

ALTER TYPE segment_status_enum ADD VALUE IF NOT EXISTS 'interim';
ALTER TYPE segment_status_enum ADD VALUE IF NOT EXISTS 'final';

-- Verify the enum values now available.
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'segment_status_enum'::regtype
ORDER BY enumsortorder;
