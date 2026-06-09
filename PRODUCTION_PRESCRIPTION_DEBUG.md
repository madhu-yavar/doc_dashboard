# Prescription Generation Debug Guide

## Issue: Prescription Download Not Working

The endpoint is failing:
```
POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate
Body: {"documentId":"voice-live-live-1780483830844-c45144be","format":"both","updateData":null}
```

## Potential Causes & Solutions

### 1. Check Server Logs (Most Important)

First, check the actual error from production server logs:

```bash
# If running in Docker
docker logs <container-name> --tail 50

# Or check application logs
tail -f /app/logs/app.log
```

Look for error messages containing:
- "Error generating prescription:"
- "Document not found:"
- "PrescriptionService requires"
- "chromium" or "playwright"

### 2. Database Document Missing

The document might not exist in the production database.

**Check if document exists:**
```bash
# Connect to PostgreSQL
docker exec -it <postgres-container> psql -U doctor_dashboard -d doctor_dashboard

# Check for the document
SELECT id, document_id, created_at, status FROM live_sessions
WHERE document_id = 'live-1780483830844-c45144be' OR id = 'live-1780483830844-c45144be';

# Check documents table
SELECT id, name, status, document_type FROM documents
WHERE id LIKE '%1780483830844%' OR name LIKE '%1780483830844%';
```

**If document doesn't exist:**
- The session might have expired or been deleted
- The document ID might be incorrect
- Database synchronization issue

### 3. Playwright/Chromium Issues

**Check if Playwright is working:**
```bash
# SSH into the server
docker exec -it <container-name> sh

# Test Playwright
node -e "const { chromium } = require('playwright'); chromium.launch().then(browser => { console.log('✅ Chromium works'); browser.close(); }).catch(e => console.error('❌ Chromium failed:', e.message));"
```

**Common Playwright fixes:**
```bash
# If Playwright fails, reinstall dependencies
docker exec -it <container-name> npx playwright install --with-deps chromium

# Check available fonts
fc-list | head -10
```

### 4. File System Permissions

**Check if output directory is writable:**
```bash
docker exec -it <container-name> ls -la /app/server/storage/prescriptions

# If permissions issue
docker exec -it <container-name> mkdir -p /app/server/storage/prescriptions
docker exec -it <container-name> chown -R nodejs:nodejs /app/server/storage
```

### 5. Memory/CPU Constraints

PDF generation can be memory-intensive. Check if the server has enough resources:

```bash
# Check container resources
docker stats <container-name>

# Check system memory
free -h

# If memory is low, the container might get killed during PDF generation
```

## Quick Debug Steps

### Step 1: Test the endpoint locally
```bash
curl -X POST http://localhost:3000/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"both"}' \
  -v
```

### Step 2: Check production server response
```bash
curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"both"}' \
  -v
```

Look for the actual error message in the response.

### Step 3: Enable debug logging
```bash
# In production, set debug environment variable
export PRESCRIPTION_DEBUG=true

# Or add temporary logging in the server
# Edit server/index.cjs around line 3866:
console.error("Error generating prescription:", error.message, error.stack);
```

## Common Error Messages & Solutions

### "Document not found: voice-live-live-1780483830844-c45144be"
**Cause:** Document doesn't exist in database
**Solution:** Check database, use a valid document ID

### "PrescriptionService requires liveSessionsRepository"
**Cause:** Repository not initialized
**Solution:** Check server initialization logs

### "Failed to launch browser"
**Cause:** Playwright/Chromium not installed or missing dependencies
**Solution:** Reinstall Playwright with dependencies

### "EACCES: permission denied"
**Cause:** Output directory not writable
**Solution:** Fix file permissions

### "Insufficient memory"
**Cause:** PDF generation needs more memory
**Solution:** Increase container memory limit

## Testing with Known Document

Instead of testing with an unknown document ID, test with a document that exists:

```bash
# Get a list of recent documents
docker exec -it <postgres-container> psql -U doctor_dashboard -d doctor_dashboard \
  -c "SELECT document_id FROM live_sessions ORDER BY created_at DESC LIMIT 5;"

# Use one of those IDs to test
curl -X POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<actual-document-id>","format":"both"}'
```

## Monitor Prescription Generation

Add logging to track the issue:

```javascript
// In server/index.cjs, around line 3847
app.post("/api/prescriptions/generate", async (req, res) => {
  try {
    console.log('[PRESCRIPTION] Request received:', req.body);
    const { documentId, format = "both", updateData = null } = req.body;

    if (!documentId) {
      console.log('[PRESCRIPTION] Missing documentId');
      return res.status(400).json({ success: false, error: "documentId is required" });
    }

    console.log('[PRESCRIPTION] Initializing service...');
    await prescriptionService.initialize();

    console.log('[PRESCRIPTION] Generating prescription for:', documentId);
    const result = await prescriptionService.generatePrescription(documentId, {
      format,
      updateData
    });

    console.log('[PRESCRIPTION] Success:', result.urls);
    res.json(result);
  } catch (error) {
    console.error("[PRESCRIPTION] Error:", error.message, error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

## Next Steps

1. **Check server logs** - This is the most important step
2. **Verify document exists** - Use a valid document ID
3. **Test Playwright** - Ensure PDF generation works
4. **Check resources** - Ensure sufficient memory/CPU
5. **Add monitoring** - Track prescription generation success rate

## Prevention

Add better error handling and validation:

```javascript
// Validate document exists before generation
const docExists = await prescriptionService.documentExists(documentId);
if (!docExists) {
  return res.status(404).json({
    success: false,
    error: `Document not found: ${documentId}`,
    suggestion: "Please verify the document exists and try again"
  });
}
```

Let me know what error message you see in the logs, and I can provide a more specific solution!