# PostgreSQL Database Setup - Doctor Dashboard

## Phase 0: Schema Foundation

This directory contains the PostgreSQL database infrastructure for the Doctor Dashboard phased migration from file-based persistence to a relational database with HL7/FHIR interoperability support.

## Architecture

The schema implements the canonical PostgreSQL persistence architecture as defined in [postgres-persistence-interoperability-plan.md](../../docs/architecture/postgres-persistence-interoperability-plan.md).

### Schema Components

1. **Enums & Custom Types** - Identity states, document statuses, interoperability constants
2. **Master Data Tables** - Patients, encounters, practitioners, organizations, locations
3. **Application Identity** - Users, authentication sessions
4. **Clinical Documents** - Documents, assets, extractions, transcripts
5. **Review & Workflow** - Review items, resolutions, live conversation sessions
6. **Additional Tables** - Chat, alerts, audit, chart notes, prescriptions
7. **Interoperability Infrastructure** - HL7/FHIR endpoints, messages, resource links
8. **Analytics** - Document metrics (migrated from analytics.sqlite)

## Setup Instructions

### Prerequisites

1. **PostgreSQL Installation** (version 12+ recommended)
   ```bash
   # macOS
   brew install postgresql
   brew services start postgresql
   
   # Ubuntu/Debian
   sudo apt-get install postgresql
   sudo systemctl start postgresql
   ```

2. **Database Creation**
   ```bash
   # Create the database
   createdb doctor_dashboard
   
   # Or using psql
   psql -U postgres -c "CREATE DATABASE doctor_dashboard;"
   ```

3. **Environment Configuration**
   ```bash
   # Copy the example environment file
   cp .env.postgres.example .env
   
   # Edit .env with your PostgreSQL credentials
   # Update PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
   ```

4. **Install Dependencies**
   ```bash
   npm install pg
   ```

### Running Migrations

Create the complete database schema:
```bash
node server/db/migrate.cjs
```

Check schema status:
```bash
node server/db/migrate.cjs status
```

Drop all tables (use with caution!):
```bash
node server/db/migrate.cjs drop
```

### Schema Files

- **[postgres_client.cjs](postgres_client.cjs)** - PostgreSQL connection pool and query interface
- **[schema.cjs](schema.cjs)** - Complete schema definition with all tables, indexes, and constraints
- **[migrate.cjs](migrate.cjs)** - Migration runner CLI tool

## Table Dependencies

Tables are created in the following order to respect foreign key relationships:

```
1. Enums (custom types)
2. Master Data:
   - organizations → locations → practitioners
   - patients → patient_identifiers
   - encounters → encounter_identifiers
3. Application Identity:
   - users → auth_sessions
4. Clinical Documents:
   - documents → document_assets → document_extractions
   - transcripts → transcript_segments
5. Review & Workflow:
   - review_items → review_item_resolutions
   - live_conversation_sessions
6. Additional Tables:
   - chat_sessions → chat_messages → chat_confirmed_actions → chat_exports
   - chart_notes, prescription_artifacts
   - alert_deliveries
   - audit_runs → audit_events
7. Interoperability:
   - interop_endpoints → interop_messages → interop_message_events
   - interop_resource_links
   - identity_reconciliation_cases
8. Analytics:
   - analytics_document_metrics
```

## Important Constraints

### Identity States
- **Patient/Encounter identity_state**: `provisional`, `reconciled`, `conflicted`, `inactive`
- **Identifier status**: `observed`, `verified`, `deprecated`

### Document References
- **Exactly one** of `document_id` or `live_session_id` must be set in:
  - `document_assets`
  - `transcripts`
  - `review_items`

### Foreign Key Behaviors
- **CASCADE**: Deletes child records when parent is deleted (identifiers, sessions, messages, etc.)
- **SET NULL**: Sets foreign key to NULL when parent is deleted (optional references)
- **RESTRICT**: Prevents deletion of parent if child records exist (critical relationships)

### Unique Constraints
- `users.username`
- `documents.sha256_hash` (nullable)
- `patient_identifiers(identifier_system, identifier_value)`
- `encounter_identifiers(identifier_system, identifier_value)`
- `document_extractions(document_id, version_no)`
- `transcript_segments(transcript_id, segment_order)`
- `chart_notes(document_id, version_no)`
- `prescription_artifacts(document_id, version_no)`
- `interop_endpoints.name`
- `interop_messages(endpoint_id, control_id)` (when control_id present)
- `interop_resource_links` (composite unique on internal/external IDs)

## Index Strategy

The schema includes comprehensive indexes for:

- **Foreign key columns** for JOIN performance
- **Status columns** for workflow filtering
- **Date/time columns** for temporal queries
- **JSONB columns** using GIN indexes for JSON queries
- **Composite indexes** for common query patterns
- **Partial indexes** for filtered data (active sessions, non-null values)

## Next Steps

After completing Phase 0, proceed with:

1. **Phase 1**: Repository & Data-Access Layer - Implement persistence boundaries
2. **Phase 2**: Dual-Write - Begin writing to both old and new stores
3. **Phase 3**: Backfill - Migrate existing data from JSON files
4. **Phase 4**: Read Cutover - Switch application reads to PostgreSQL
5. **Phase 5**: Identity Reconciliation - Resolve patient/encounter conflicts
6. **Phase 6**: Cleanup - Remove legacy JSON file stores

See [postgres-persistence-interoperability-checklist.md](../../docs/architecture/postgres-persistence-interoperability-checklist.md) for detailed phase implementation.

## Troubleshooting

### Connection Issues
```bash
# Test PostgreSQL connection
psql -h localhost -U postgres -d doctor_dashboard

# Check PostgreSQL status
brew services list  # macOS
sudo systemctl status postgresql  # Linux
```

### Permission Issues
```sql
-- Grant permissions (run as postgres user)
GRANT ALL PRIVILEGES ON DATABASE doctor_dashboard TO your_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_user;
```

### Schema Conflicts
```bash
# Drop and recreate schema (CAUTION: deletes all data)
node server/db/migrate.cjs drop
node server/db/migrate.cjs
```

## Migration Progress Tracking

Each phase should be completed and validated before proceeding to the next:

- ✅ Phase 0: Schema Foundation (Current)
- ⬜ Phase 1: Repository & Data-Access Layer
- ⬜ Phase 2: Dual-Write
- ⬜ Phase 3: Backfill
- ⬜ Phase 4: Read Cutover
- ⬜ Phase 5: Identity Reconciliation
- ⬜ Phase 6: Cleanup

## Support

For questions or issues during migration, refer to:
- [Canonical Plan](../../docs/architecture/postgres-persistence-interoperability-plan.md)
- [Implementation Checklist](../../docs/architecture/postgres-persistence-interoperability-checklist.md)
- Database team or PostgreSQL documentation