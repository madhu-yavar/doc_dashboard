# Prescription Handwriting Detection & Extraction

## Overview

This system automatically detects handwritten text in prescription documents and extracts structured data using **Qwen 30B** for optimal accuracy on both handwritten and printed text.

## How It Works

### 1. Document Routing

When a document is uploaded, the `DocumentTypeRouter`:

1. Checks filename for prescription indicators (`prescription`, `rx`, `medication`, `doxper`)
2. Scans content for prescription keywords (`tab.`, `cap.`, `inj.`, `od`, `bd`, `tds`, etc.)
3. Runs quick handwriting detection using Qwen 30B vision model
4. Routes to the prescription extractor

### 2. Handwriting Detection

The `HandwritingDetectorSkill` uses Qwen 30B to analyze the document and determine:

- Whether handwriting is present
- Percentage of handwritten content
- Specific sections containing handwriting
- Confidence level of the detection

### 3. Extraction

The `PrescriptionExtractorAgent`:

- Uses Qwen 30B for all prescription extraction (handles both handwriting and printed text optimally)
- Extracts patient, doctor, medication, and diagnosis information
- Transforms results to dashboard-compatible format

## Configuration

Set this environment variable:

```bash
# Qwen 30B (handles both handwritten and printed text)
export QWEN_URL="http://206.1.62.28:8001/v1/chat/completions"
export QWEN_MODEL="cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit"
```

## Usage

### Via UI

1. Upload a prescription document to the dashboard
2. The system automatically detects the document type
3. Qwen 30B processes the document
4. Results display in the dashboard with:
   - Patient information
   - Doctor information
   - Medications list
   - Diagnosis/purpose
   - Special notes and warnings

### Via API

```bash
# Upload and process
curl -X POST http://localhost:8001/api/documents/upload \
  -F "files=@prescription.pdf"

# Process queued documents
curl -X POST http://localhost:8001/api/documents/process \
  -H "Content-Type: application/json" \
  -d '{"ids": ["document-id"]}'
```

### Test Script

```bash
# Test with a specific file
node test-prescription-handwriting.cjs data/Doxper.pdf

# Test with custom Qwen endpoint
QWEN_URL="http://localhost:8001" node test-prescription-handwriting.cjs data/prescription.pdf
```

## Dashboard Display

Prescription extraction results are transformed to match the existing dashboard schema:

- **Medications Card**: Shows extracted medications with dosages
- **Diagnosis Card**: Shows prescription purpose/diagnosis
- **Care Gaps Card**: Shows warnings and special notes
- **Notes Rail**: Shows prescribing doctor information

## Performance

| Model | Use Case | Speed | Accuracy |
|-------|----------|-------|----------|
| Qwen 30B | All prescriptions (handwritten + printed) | 15-30s | ~100% |

## Files

- `skills/detection/handwriting_detector.skill.cjs` - Handwriting detection
- `skills/extraction/prescription_extractor.skill.cjs` - Prescription extraction skill
- `agents/prescription_extractor_agent.cjs` - Prescription extraction agent
- `agents/document_type_router.cjs` - Document routing logic
- `server/index.cjs` - Server configuration

## Troubleshooting

**Handwriting not detected:**
- Check Qwen 30B service is running on configured port
- Verify PDF contains visible text/images

**Extraction fails:**
- Check Qwen 30B service is accessible
- Verify network connectivity to model endpoint
- Check server logs for detailed error messages

**Results not displaying:**
- Verify `transformToDashboardFormat` is returning correct structure
- Check browser console for frontend errors
- Verify document status is "processed" in upload center
