# Handwritten Prescription Extraction

This module provides tools for extracting structured data from handwritten prescription documents using the Qwen Vision model.

## Components

### 1. Qwen Vision Client Tool
**File:** `tools/llm/qwen_vision_client.tool.cjs`

A multi-modal LLM client that supports:
- Text + Image input (vision capabilities)
- Automatic PDF to image conversion (using `pdftoppm`)
- Base64 image encoding
- Multiple model support (8B and 30B variants)

### 2. Prescription Extractor Skill
**File:** `skills/extraction/prescription_extractor.skill.cjs`

Extracts structured information from prescriptions including:
- Patient information (name, age, gender, ID, date)
- Doctor information (name, registration number, signature)
- Medications (name, dosage, form, quantity, frequency, duration, route, instructions)
- Diagnosis/Indication
- Additional notes (warnings, follow-up instructions)

## GPU Model Endpoints

The system is configured to use these GPU servers:

- **8B Model:** `http://206.1.62.28:8000/v1/chat/completions`
  - Model: `Qwen/Qwen3-VL-8B-Instruct`
  - Quantization: bfloat16
  - Use for faster processing

- **30B Model:** `http://206.1.62.28:8001/v1/chat/completions`
  - Model: `cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit`
  - Quantization: AWQ 4-bit
  - Use for better accuracy on difficult handwriting

## Usage

### Basic Test

```bash
# Test with 8B model
node test-prescription-extraction.cjs

# Test with 30B model
node test-prescription-extraction.cjs 30b

# Compare both models
node test-prescription-extraction.cjs compare
```

### Custom Test File

```bash
TEST_FILE=./path/to/prescription.pdf node test-prescription-extraction.cjs
```

### Programmatic Usage

```javascript
const PrescriptionExtractorSkill = require("./skills/extraction/prescription_extractor.skill.cjs");

const extractor = new PrescriptionExtractorSkill({
  qwenBaseUrl: "http://206.1.62.28:8000/v1/chat/completions",
  qwenModel: "Qwen/Qwen3-VL-8B-Instruct",
  timeout: 120000
});

const result = await extractor.execute({
  filePath: "./data/prescription.pdf",
  onProgress: (progress) => {
    console.log(progress.step, progress.status);
  }
});

if (result.success) {
  console.log("Medications:", result.data.medications);
  console.log("Patient:", result.data.patient);
  console.log("Doctor:", result.data.doctor);
}
```

## Output Format

```json
{
  "patient": {
    "name": "John Doe",
    "age": "45",
    "gender": "Male",
    "id": "MRN-12345",
    "date": "15-04-2026"
  },
  "doctor": {
    "name": "Dr. Smith",
    "registration_number": "KMC-12345",
    "signature_present": true
  },
  "medications": [
    {
      "name": "Amoxicillin",
      "dosage": "500mg",
      "form": "tablet",
      "quantity": "30",
      "frequency": "TDS",
      "duration": "5 days",
      "route": "oral",
      "instructions": "Take after meals",
      "confidence": "high"
    }
  ],
  "diagnosis": {
    "primary": "Upper Respiratory Infection",
    "symptoms": ["fever", "cough"]
  },
  "notes": {
    "warnings": ["Complete full course"],
    "follow_up": "Review after 3 days",
    "other_notes": ""
  },
  "extraction_metadata": {
    "total_medications": 1,
    "confidence": "high",
    "issues": []
  }
}
```

## Requirements

- Node.js
- `pdftoppm` (from poppler-utils) for PDF to image conversion
  - macOS: `brew install poppler`
  - Ubuntu: `sudo apt install poppler-utils`

## Environment Variables

```bash
# Optional - override default URLs
export QWEN_VISION_URL="http://206.1.62.28:8000/v1/chat/completions"
export QWEN_30B_URL="http://206.1.62.28:8001/v1/chat/completions"
```

## Notes

1. **Server Status:** The GPU servers at `206.1.62.28` must be running and accessible
2. **PDF Handling:** PDFs are automatically converted to PNG images at 300 DPI
3. **Timeout:** Default timeout is 120 seconds (adjustable via config)
4. **Memory:** Large PDFs may require significant memory during processing

## Troubleshooting

If you encounter connection errors:
1. Verify the GPU servers are running: `curl http://206.1.62.28:8000/v1/models`
2. Check if `pdftoppm` is installed: `which pdftoppm`
3. For timeout issues, increase the timeout value in config

## Future Enhancements

- Multi-page PDF support (currently processes first page only)
- Batch processing for multiple prescriptions
- Integration with the main document processing pipeline
- Confidence scoring per field
- Handwriting quality assessment
