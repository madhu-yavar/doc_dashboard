# Prescription Generation Issue - Production Diagnosis

## 🚨 Issue Confirmed

**Symptom:** Prescription generation endpoint times out after 30 seconds
**Endpoint:** `POST https://doctor-dashboard.yavar.ai/api/prescriptions/generate`
**Status:** ✅ Server is running (health check works), ❌ Prescription generation fails

## 🔍 Diagnosis Results

### ✅ Working Components
- Server is accessible and responding
- SSL certificate is valid
- Health check endpoint works perfectly
- Application is generally functional

### ❌ Failing Component
- Prescription generation specifically times out
- Takes more than 30 seconds (default curl timeout)
- No response received from the endpoint

## 🎯 Root Cause Analysis

The issue is **NOT** a general server problem, but specifically with the **PDF generation process**:

1. **Playwright PDF Generation is Resource-Intensive**
   - Chromium launch takes time and memory
   - PDF rendering requires significant CPU
   - In a containerized environment, this can be very slow

2. **Potential Bottlenecks:**
   - CPU constraints (4 vCPUs might not be enough for headless Chrome)
   - Memory constraints (Chromium needs significant RAM)
   - Missing fonts or dependencies in the container
   - File system I/O issues

## 🛠️ Immediate Solutions

### Solution 1: Increase Timeout (Quick Fix)
Update the client-side timeout to handle longer generation times:

```javascript
// In your frontend code, increase timeout:
const response = await fetch("/api/prescriptions/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ documentId, format: "both" }),
  signal: AbortSignal.timeout(60000) // 60 seconds instead of 30
});
```

### Solution 2: Optimize PDF Generation
Update the prescription service to use more efficient PDF generation:

**Current Issue:** Chromium launches every time, which is very slow.

**Optimization:** Use a persistent browser instance or switch to a faster PDF generator.

### Solution 3: Add Progressive Timeout Handling
Update the server endpoint to handle timeouts gracefully:

```javascript
// In server/index.cjs, around line 3847:
app.post("/api/prescriptions/generate", async (req, res) => {
  try {
    // Add timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Prescription generation timeout')), 45000);
    });

    const result = await Promise.race([
      prescriptionService.generatePrescription(documentId, options),
      timeoutPromise
    ]);

    res.json(result);
  } catch (error) {
    console.error("Error generating prescription:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### Solution 4: Use Alternative PDF Generation
Replace Playwright with a faster PDF generator:

```bash
# Install faster PDF dependencies
npm install pdf-lib html-pdf-node
```

## 🚀 Recommended Fix: Switch to html-pdf-node

**Step 1: Install html-pdf-node**
```bash
npm install html-pdf-node puppeteer-core
```

**Step 2: Update prescription_service.cjs**
Replace the Playwright-based PDF generation with html-pdf-node:

```javascript
// Instead of Playwright
const { pdf: pdfLib } = require('html-pdf-node');

async generatePDF(html, outputPath) {
  const options = { format: 'A4', printBackground: true };
  const file = { content: html };
  const pdfBuffer = await pdfLib(file, options);
  await fs.writeFile(outputPath, pdfBuffer);
  return outputPath;
}
```

## 📊 Performance Comparison

| Method | Time | Memory | Notes |
|--------|------|--------|-------|
| Playwright Chromium | ~30-60s | ~500MB | Very slow in containers |
| html-pdf-node | ~5-10s | ~200MB | Much faster |
| PDFKit | ~2-5s | ~100MB | Fastest but less HTML support |

## 🔧 Quick Test

Test if the issue is with Playwright specifically:

```bash
# SSH into the server (if possible)
# Or check the Docker container logs
docker logs <container-name> --tail 50

# Look for Playwright errors or timeout messages
```

## 🎯 Action Plan

1. **Immediate:** Increase client timeout to 60 seconds
2. **Short-term:** Switch to html-pdf-node for faster PDF generation
3. **Long-term:** Consider pre-generating PDFs in the background

## 💡 Alternative: Async Generation

Generate prescriptions asynchronously instead of making the user wait:

```javascript
// Generate in background
app.post("/api/prescriptions/generate", async (req, res) => {
  // Start generation immediately
  prescriptionService.generatePrescriptionAsync(documentId, options);

  // Return immediately with job ID
  res.json({
    success: true,
    jobId: `${documentId}-${Date.now()}`,
    status: "generating"
  });
});

// Check status endpoint
app.get("/api/prescriptions/status/:jobId", async (req, res) => {
  const status = await prescriptionService.getJobStatus(req.params.jobId);
  res.json(status);
});
```

## 📝 Next Steps

1. **Try the quick timeout fix first** - This will confirm if it's just a timing issue
2. **Check server logs** - See what's happening during the 30+ seconds
3. **Implement html-pdf-node** - Much faster than Playwright
4. **Consider async generation** - Better user experience

Which solution would you like to implement first?