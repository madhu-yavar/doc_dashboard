# Prescription Extraction Comparison Summary

**Test Date:** April 17, 2026
**Test File:** Doxper.pdf (2 pages, handwritten prescription)

## Methods Compared

### 1. OpenDataLoader-PDF (Local Mode)
- **Installation:** `pip install opendataloader-pdf`
- **Mode:** Local (no GPU, deterministic extraction)
- **Duration:** 4.28s
- **Output Format:** JSON with bounding boxes + Markdown

### 2. Qwen Vision 8B (GPU)
- **Model:** `Qwen/Qwen3-VL-8B-Instruct`
- **Endpoint:** `http://206.1.62.28:8000/v1/chat/completions`
- **Duration:** 18.19s
- **Output Format:** Structured JSON with semantic fields

## Results Comparison

| Metric | OpenDataLoader | Qwen Vision |
|--------|----------------|-------------|
| **Speed** | 4.28s ✅ (4.2x faster) | 18.19s |
| **GPU Required** | No ❌ | Yes ✅ |
| **Patient Name** | Extracted (raw text) | Extracted + Parsed |
| **Patient Age** | In raw text | Parsed: "21 Yrs" |
| **Patient Gender** | In raw text | Parsed: "Male" |
| **Patient ID** | In raw text | Parsed: "MH005618878" |
| **Doctor Name** | Extracted | Extracted |
| **Doctor Reg No** | In raw text | Parsed: "TMN 2017 0001362 KTK" |
| **Bounding Boxes** | Yes ✅ | No ❌ |
| **Structured Output** | No (requires parsing) | Yes ✅ |
| **Handwriting OCR** | No (digital text only) | Yes ✅ |

## Key Findings

### OpenDataLoader-PDF Strengths:
1. **Speed:** 4.2x faster than Qwen Vision
2. **Bounding Boxes:** Each element has precise coordinates
3. **No GPU Required:** Runs on CPU
4. **Structured Elements:** Detects paragraphs, images, headings
5. **Font Metadata:** Includes font name, size, color

### Qwen Vision Strengths:
1. **Structured Output:** Returns parsed JSON with semantic fields
2. **Handwriting Understanding:** Can read handwritten content
3. **Field Extraction:** Separates patient info, doctor info, medications
4. **Better for Scanned Documents:** OCR capabilities built-in

### OpenDataLoader-PDF Weaknesses:
1. **No Structured Fields:** Raw text requires post-processing
2. **Limited OCR:** Works best with digital PDFs
3. **No Handwriting Recognition:** Cannot extract handwritten notes

### Qwen Vision Weaknesses:
1. **Slower:** 4.2x slower processing time
2. **No Bounding Boxes:** Cannot pinpoint source location
3. **GPU Required:** Needs GPU server
4. **Token Limits:** Large documents may be truncated

## Extracted Data Comparison

### Patient Information
| Field | OpenDataLoader | Qwen Vision |
|-------|----------------|-------------|
| Name | "Mr Jerald PILLAI 21 Yrs / Male MH005618878 2022-01-08 09:09" | "Mr Jerald PILLAI" |
| Age | In text | "21 Yrs" |
| Gender | In text | "Male" |
| ID | In text | "MH005618878" |
| Date | In text | "2022-01-08 09:09" |

### Doctor Information
| Field | OpenDataLoader | Qwen Vision |
|-------|----------------|-------------|
| Name | "Dr. NEHA MISHRA (MBBS, MD (GEN MED), POST DOCTORAL FELLOWSHIP IN INFECTIOUS DISEASES (CMC VELLORE))" | Same |
| Reg Number | "TMN 2017 0001362 KTK Infectious Disease MHB" | "TMN 2017 0001362 KTK" |

## Recommendation

### Best Approach: Hybrid Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESCRIPTION EXTRACTION PIPELINE          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 1: OpenDataLoader-PDF (Fast, Local)                   │
│  ├─ Extract all text with bounding boxes                    │
│  ├─ Detect document structure (headings, paragraphs)        │
│  └─ Check if document has handwritten content               │
│                                                               │
│  Step 2: IF handwritten content detected → Qwen Vision       │
│  ├─ Process images of handwritten sections                  │
│  ├─ Extract structured fields (medications, dosages)        │
│  └─ Merge with OpenDataLoader results                       │
│                                                               │
│  Step 3: Output Structured JSON                              │
│  ├─ Patient info (parsed)                                   │
│  ├─ Doctor info (parsed)                                    │
│  ├─ Medications (list with dosage, frequency)               │
│  └─ Provenance (bounding boxes from OpenDataLoader)         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Strategy:

1. **Use OpenDataLoader as primary parser:**
   - Fast processing (4s vs 18s)
   - Bounding boxes for provenance
   - Works offline without GPU

2. **Use Qwen Vision for handwritten sections:**
   - Only when OpenDataLoader detects images
   - For medication list extraction (often handwritten)
   - For signature/doctor notes

3. **Merge results:**
   - OpenDataLoader provides structure and coordinates
   - Qwen Vision provides semantic field extraction

## Files Generated

```
experiments/results/
├── Doxper.json                    # OpenDataLoader raw output
├── Doxper.md                      # OpenDataLoader markdown output
├── Doxper_images/                 # Extracted images
├── comparison_*.json              # Full comparison results
└── comparison_report_*.md         # Human-readable report
```

## Next Steps

1. ✅ Compare both methods on standard prescription
2. ⏳ Test on more complex handwritten prescriptions
3. ⏳ Implement hybrid pipeline
4. ⏳ Test 30B Qwen model for better accuracy
5. ⏳ Add OCR mode to OpenDataLoader for scanned PDFs
