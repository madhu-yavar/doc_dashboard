# Discharge Date Display Issue - Fixed

## Problem
The dashboard was showing "Discharged: Apr 4, 2026, 12:16 PM" for all documents, which was actually the **timestamp when the PDF was processed**, not the actual discharge date from the medical record.

## Root Cause
1. The PDF documents are **admission/nursing assessment records**, not final discharge summaries
2. They don't contain a discharge date - only an admission date
3. The LLM correctly identified this: `"No discharge date is present as the document appears to be an initial inpatient record/admission summary"`
4. The frontend code had a fallback that used `document.processedAt` when discharge_date was missing:
   ```typescript
   dischargeDate: sample.discharge_date || document.processedAt || document.uploadedAt
   ```

## Fix Applied

### 1. Updated `src/lib/processedDocuments.ts` (line 195)
**Before:**
```typescript
dischargeDate: sample.discharge_date || document.processedAt || document.uploadedAt,
```

**After:**
```typescript
// If discharge_date is not present in the PDF, use null instead of processedAt
// This allows the UI to show "Not discharged yet" instead of the processing timestamp
dischargeDate: sample.discharge_date || null,
```

### 2. Updated `src/components/dashboard/PatientHeader.tsx`
**Before:**
```typescript
<span><strong className="text-foreground">Discharged:</strong> {formatDateTime(admission.dischargeDate)}</span>
```

**After:**
```typescript
<span><strong className="text-foreground">Discharged:</strong> {
  admission.dischargeDate
    ? formatDateTime(admission.dischargeDate)
    : <span className="text-amber-600">Not discharged yet</span>
}</span>
```

## Result
Now the dashboard will correctly show:
- **Discharged:** `25-03-2026` (or actual date from PDF)
- **Discharged:** `Not discharged yet` (in amber color) when not found in the document

Instead of misleadingly showing the processing timestamp as the discharge date.

## Files Changed
1. `src/lib/processedDocuments.ts` - Removed fallback to processedAt
2. `src/components/dashboard/PatientHeader.tsx` - Added null handling with amber warning
