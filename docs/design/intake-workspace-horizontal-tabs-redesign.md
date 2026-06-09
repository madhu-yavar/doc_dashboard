# Intake Workspace - Horizontal Tabs UI Redesign

## Document Version: 1.0
**Status**: Draft - Pending Review
**Date**: 2026-05-28

---

## 1. Overview

### Objective
Transform the current Intake Workspace from a sidebar-based navigation to horizontal tabs, providing a cleaner, more intuitive interface for different document types.

### Scope
- **Frontend UI changes only** - No backend changes
- **No new features** - Existing content reorganized into tabs
- **No workflow changes** - All existing functionality preserved

---

## 2. Current State

### Current Navigation Structure
```
Intake Workspace (/upload)
│
├── Sidebar: "Documents" → Document queue (all types mixed)
│   ├── Upload PDFs (drag-drop)
│   ├── Queue table (all documents)
│   └── Process batch actions
│
└── Sidebar: "Voice" → VoiceWorkspace
    ├── Mode dropdown: Dictation | Live
    ├── Dictation: Audio upload, transcription queue
    └── Live: Real-time conversation capture
```

### Issues with Current Design
- Mixed document queue requires filtering after upload
- Voice mode hidden in dropdown
- No visual separation between document types
- User feels like uploading to a "mixed bucket"

---

## 3. Proposed Design

### New Navigation Structure
```
Intake Workspace (/upload)
│
└── Horizontal Tabs:
    ├── Dashboard → Analytics overview + filtered queue (NO upload)
    ├── Prescription → Prescription documents only
    ├── Inpatient → Discharge summaries only
    ├── Outpatient → OPD records only
    ├── Dictation → Audio file upload & transcription
    └── Live → Real-time conversation capture
```

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Clinical Operations                                                 [User] │
│                                                                            │
│  ┌────────┬─────────────┬───────────┬───────────┬───────────┬─────────┐    │
│  │Dashboard│Prescription│Inpatient  │Outpatient │Dictation  │Live     │    │
│  │   ●    │      ○     │     ○     │     ○     │     ○     │    ○    │    │
│  └────────┴─────────────┴───────────┴───────────┴───────────┴─────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                     │    │
│  │  [Content area - existing component for selected tab]              │    │
│  │                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tab Specifications

### 4.1 Dashboard Tab

**Purpose**: Analytics overview and bird's-eye view of all documents

**URL**: `/upload` or `/upload?tab=dashboard`

**Content**:
- Processing Insights widget (admin-only, existing `ProcessingInsights` component)
- Document Queue with filters (existing documents table)

**Features**:
| Component | Behavior |
|-----------|----------|
| Type Filter | Dropdown: All, Prescription, Inpatient, Outpatient, Lab Report, Chart Note, Voice |
| Date Filter | Dropdown: All Time, Today, Last 7 Days, Last 30 Days |
| Search | Existing search functionality (PDF name, patient, MRN) |
| Upload | **None** - No upload box on Dashboard tab |

**Visual**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Processing Insights (Admin Only)                               │   │
│  │  [Existing analytics charts - no changes]                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Document Queue                                                  │   │
│  │  Filter: [All Types ▼]  Date: [All Time ▼]  🔍 Search           │   │
│  │  ┌───────────────────────────────────────────────────────────┐   │   │
│  │  │ Existing documents table (filtered by Type selection)     │   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 4.2 Prescription Tab

**Purpose**: Handwritten prescription processing

**URL**: `/upload?tab=prescription`

**Document Type**: `prescription` (OPD forms with handwriting, prescription pads)

**Content**:
- Existing upload box (targeted for prescriptions, but backend classifies)
- Queue table filtered to show `prescription` type documents only
- All existing actions (View, Process, Delete, etc.)

**Upload Box Text**: "Upload handwritten prescriptions"

---

### 4.3 Inpatient Tab

**Purpose**: Discharge summary processing

**URL**: `/upload?tab=inpatient`

**Document Type**: `discharge_summary` (primarily), may include `inpatient_record`

**Content**:
- Existing upload box (targeted for discharge summaries)
- Queue table filtered to show `discharge_summary` type documents only
- All existing actions

**Upload Box Text**: "Upload discharge summaries"

---

### 4.4 Outpatient Tab

**Purpose**: OPD record processing (typed, no handwriting)

**URL**: `/upload?tab=outpatient`

**Document Type**: `outpatient_record` (OPD forms WITHOUT handwriting)

**Content**:
- Existing upload box (targeted for OPD records)
- Queue table filtered to show `outpatient_record` type documents only
- All existing actions

**Upload Box Text**: "Upload OPD records and consultation notes"

---

### 4.5 Dictation Tab

**Purpose**: Audio file upload and transcription

**URL**: `/upload?tab=dictation` (or `/upload?workspace=voice` for backward compatibility)

**Document Type**: `voice` (dictation mode)

**Content**:
- **Existing `VoiceDictationWorkspace` component - NO CHANGES**
- Audio upload, transcription queue, transcript review
- All existing functionality preserved

---

### 4.6 Live Tab

**Purpose**: Real-time conversation capture

**URL**: `/upload?tab=live`

**Document Type**: `voice` (live mode)

**Content**:
- **Existing `LiveConversationWorkspace` component - NO CHANGES**
- Recording controls, live transcript, session management
- All existing functionality preserved

---

## 5. Document Type Reference

Backend classification (already implemented, no changes):

| Document Type | Backend Type | How It's Detected |
|---------------|--------------|-------------------|
| Prescription | `prescription` | OPD form + handwriting detected |
| Outpatient | `outpatient_record` | OPD form + NO handwriting |
| Inpatient | `discharge_summary` | Header says "DISCHARGE SUMMARY", contains risk scores |
| Inpatient (IPD) | `inpatient_record` | Header says "IPD", "IPD No." |
| Lab Report | `lab_report` | Has lab values, reference ranges |
| Chart Note | `chart_note` | SOAP note structure, progress notes |
| Voice | `voice` | Audio file upload |

**Note**: Upload on any tab uses backend classification. The tab is just a *hint* - final placement determined by classifier.

---

## 6. Technical Specifications

### 6.1 Routing

| URL | Tab |
|-----|-----|
| `/upload` | Dashboard (default) |
| `/upload?tab=dashboard` | Dashboard |
| `/upload?tab=prescription` | Prescription |
| `/upload?tab=inpatient` | Inpatient |
| `/upload?tab=outpatient` | Outpatient |
| `/upload?tab=dictation` | Dictation |
| `/upload?tab=live` | Live |

**Backward Compatibility**:
- `/upload?workspace=voice` → redirects to Dictation tab
- `/upload?mode=live` → redirects to Live tab

### 6.2 State Management

```typescript
type TabType = "dashboard" | "prescription" | "inpatient" | "outpatient" | "dictation" | "live";

// URL param drives state
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get("tab") || "dashboard";
```

### 6.3 Components to Modify

| Component | Change |
|-----------|--------|
| `UploadCenter.tsx` | Replace `WorkspaceSidebar` with horizontal tabs; add tab-based content switching |
| `WorkspaceSidebar` | **Remove** (functionality moved to tabs) |
| `VoiceWorkspace.tsx` | **Remove** (mode selector moved to tabs) |
| `ProcessingInsights.tsx` | **No change** (shown on Dashboard tab only) |
| `VoiceDictationWorkspace.tsx` | **No change** (shown on Dictation tab) |
| `LiveConversationWorkspace.tsx` | **No change** (shown on Live tab) |

---

## 7. Tab Filter Options

### Dashboard Tab Type Filter

```
Filter by Type:
┌─────────────────┐
│ All Types     ▼ │
├─────────────────┤
│ All Types       │
│ Prescription    │
│ Inpatient       │
│ Outpatient      │
│ Lab Report      │
│ Chart Note      │
│ Voice           │
└─────────────────┘
```

### Filter Mapping to Backend Types

| Filter Label | Backend Document Types Included |
|--------------|--------------------------------|
| All Types | All |
| Prescription | `prescription` |
| Inpatient | `discharge_summary`, `inpatient_record` |
| Outpatient | `outpatient_record` |
| Lab Report | `lab_report` |
| Chart Note | `chart_note` |
| Voice | `voice` |

---

## 8. Mobile Responsiveness

- Tabs scroll horizontally on small screens
- Tab bar: `overflow-x-auto` with hidden scrollbar
- Active tab remains visible on load
- Swipe gesture support (optional)

---

## 9. Implementation Checklist

### Phase 1: Structure
- [ ] Create tab state management
- [ ] Implement URL param handling
- [ ] Create tab bar component
- [ ] Add backward compatibility redirects

### Phase 2: Content Integration
- [ ] Move ProcessingInsights to Dashboard tab
- [ ] Add filter dropdowns to Dashboard queue
- [ ] Create prescription-specific queue view
- [ ] Create inpatient-specific queue view
- [ ] Create outpatient-specific queue view
- [ ] Integrate VoiceDictationWorkspace (no changes)
- [ ] Integrate LiveConversationWorkspace (no changes)

### Phase 3: Polish
- [ ] Add tab transition animations
- [ ] Test keyboard navigation
- [ ] Test mobile responsive behavior
- [ ] Verify backward compatibility

---

## 10. Questions for Review

1. **Tab Order**: Confirm `Dashboard | Prescription | Inpatient | Outpatient | Dictation | Live` is final?

2. **Filter Naming**: Should "Inpatient" filter show as "Inpatient (includes discharge)" for clarity?

3. **Badge Counts**: Should tabs show document count badges, or keep clean without badges?

4. **Empty States**: Any specific messaging needed when tabs are empty?

5. **Date Filter**: Should date filter have presets or use date picker?

---

**End of Document**
