# Phase 4 Read Cutover: Parity Checks and Rollback Guide

## Date: 2026-06-03
## Status: Implementation Testing

This document provides parity-check commands and rollback instructions for each Phase 4 subsystem.

## PR 1: Auth Read Cutover (ENABLE_PG_READ_AUTH)

### Implementation Summary
- Modified `AuthService.readUsers()` to use `AuthRepository.readUsers()` when flag is enabled
- Modified `AuthService.readSessions()` to use `AuthRepository.readSessionsWithUsers()` when flag is enabled
- Maintains API compatibility by transforming Postgres results to legacy JSON structure
- Flag defaults to `false` - filesystem reads remain active by default

### Parity Check Commands

#### 1. User Count Parity
```bash
# Enable Postgres reads
export ENABLE_PG_READ_AUTH=true
node server/index.cjs &

# Check user count from API
curl -s http://localhost:8081/api/auth/users | jq '.users | length'

# Compare with Postgres direct query
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM users;"

# Compare with filesystem
node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('server/storage/users.json', 'utf8')); console.log(data.users.length);"
```

#### 2. Session Count Parity (Active Sessions Only)
```bash
# Check active session count from API
curl -s http://localhost:8081/api/auth/sessions | jq '.sessions | length'

# Compare with Postgres active sessions
psql -d doctor_dashboard -c "SELECT COUNT(*) FROM auth_sessions WHERE expires_at > NOW();"

# Compare with filesystem
node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('server/storage/auth_sessions.json', 'utf8')); const now = Date.now(); const active = data.sessions.filter(s => new Date(s.expiresAt) > now); console.log(active.length);"
```

#### 3. Login Authentication Test
```bash
# Test login with Postgres reads enabled
curl -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c /tmp/admin_cookies.txt

# Verify session is created and authenticated
curl -s http://localhost:8081/api/auth/me -b /tmp/admin_cookies.txt | jq '.authenticated'

# Logout to verify session revocation works
curl -X POST http://localhost:8081/api/auth/logout -b /tmp/admin_cookies.txt

# Verify session is revoked
curl -s http://localhost:8081/api/auth/me -b /tmp/admin_cookies.txt | jq '.authenticated'
```

#### 4. User Field Mapping Verification
```bash
# Check that user fields match expected structure
curl -s http://localhost:8081/api/auth/users | jq '.users[0] | {id, username, role, displayName, createdAt}'

# Verify Postgres returns same structure
psql -d doctor_dashboard -c "SELECT id, username, role, display_name as displayName, created_at as createdAt FROM users LIMIT 1;"
```

### Rollback Instructions

#### Immediate Rollback (Toggle Flag)
```bash
# Set flag back to false to restore filesystem reads
export ENABLE_PG_READ_AUTH=false

# Restart server (if running)
pkill -f "node server/index.cjs"
node server/index.cjs &

# Verify filesystem reads are restored
curl -s http://localhost:8081/api/auth/users | jq '.users | length'
```

#### Verification of Rollback
```bash
# Verify that legacy reads still work
node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('server/storage/users.json', 'utf8')); console.log('Filesystem users:', data.users.length);"

curl -s http://localhost:8081/api/auth/users | jq -r '"API users: \(.users | length)"'

# Both should return same count
```

### Expected Results

**With ENABLE_PG_READ_AUTH=true:**
- ✅ User count matches between API and Postgres
- ✅ Active session count matches between API and Postgres
- ✅ Login authentication works correctly
- ✅ Session revocation works correctly
- ✅ API response structure remains compatible with frontend

**With ENABLE_PG_READ_AUTH=false (rollback):**
- ✅ User count matches between API and filesystem
- ✅ Active session count matches between API and filesystem
- ✅ All auth operations work as before Phase 4
- ✅ No data loss or corruption

### Completion Criteria

- [ ] User count parity verified (API = Postgres)
- [ ] Session count parity verified (API = Postgres)
- [ ] Login authentication works
- [ ] Session revocation works
- [ ] API response structure unchanged
- [ ] Rollback by flag toggle restores filesystem reads
- [ ] No filesystem store deletion
- [ ] ENABLE_DUAL_WRITE_PHASE_2A still intact

## PR 2: Documents Read Cutover (ENABLE_PG_READ_DOCUMENTS)

*Implementation in progress...*

## PR 3: Voice Read Cutover (ENABLE_PG_READ_VOICE)

*To be implemented...*

## PR 4: Live Read Cutover (ENABLE_PG_READ_LIVE)

*To be implemented...*

## PR 5: Chat/Audit/Alerts/Analytics Read Cutover

*To be implemented...*