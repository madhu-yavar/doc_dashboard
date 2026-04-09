# Chart Note Generation - ReAct Agent Implementation

## What Changed

The chart note generation has been upgraded from a **single-shot LLM call** to a **ReAct-style reasoning agent** with explicit thinking steps.

## New Agent: `chart_note_agent.cjs`

Location: `/agents/chart_note_agent.cjs`

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CHART NOTE AGENT                         │
│                   (ReAct-Style Reasoning)                   │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ STEP 1 │        │ STEP 2  │        │ STEP 3  │
   │ ANALYZE │  ───► │ STRUCTURE│  ───► │ SUBJECTIVE│
   │Clinical │        │ SOAP    │        │ Section  │
   │ Picture │        │ Plan    │        │ (Think)  │
   └─────────┘        └─────────┘        └─────────┘
        │                   │                   │
        ▼                   ▼                   ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ STEP 4  │        │ STEP 5  │        │ STEP 6  │
   │OBJECTIVE│  ───► │ASSESSMENT│  ───► │   PLAN   │
   │ Section  │        │ Section  │        │ Section  │
   │ (Think)  │        │ (Think)  │        │ (Think)  │
   └─────────┘        └─────────┘        └─────────┘
                                            │
                                            ▼
                                     ┌─────────┐
                                     │ STEP 7  │
                                     │  REVIEW │
                                     │ REFINE  │
                                     └─────────┘
```

### 7-Step Reasoning Process

| Step | Purpose | Output |
|------|---------|--------|
| **1. Analyze Clinical Picture** | Understand the patient's hospital stay | THOUGHT, KEY_FINDINGS, PATIENT_STATUS, COMPLEXITY |
| **2. Determine SOAP Structure** | Plan what goes into each section | Subjective/Objective/Assessment/Plan requirements |
| **3. Generate Subjective** | Write history & presentation | Clinical reasoning + section content |
| **4. Generate Objective** | Write clinical findings | Data selection + measured values |
| **5. Generate Assessment** | Write diagnosis & judgment | Clinical synthesis + prognosis |
| **6. Generate Plan** | Write discharge planning | Medications + follow-up + education |
| **7. Review & Refine** | Quality check each section | Quality ratings + improvements |

### Example Output Format

Each step produces:
```
THOUGHT: [Explicit clinical reasoning]
SUBJECTIVE SECTION:
[The actual chart note content]
```

## Token Usage

- **Single-shot (old)**: ~2,500 tokens, 1 call
- **ReAct (new)**: ~6,000-8,000 tokens, 7 calls
- Trade-off: Higher quality for more tokens

## How to Restart

```bash
# Stop current server
# Then restart:
cd /Users/yavar/Documents/CoE/Manipal/doctor_dashboard
npm run dev
```

## What to Expect

1. **Longer generation time** (7 sequential LLM calls vs 1)
2. **More detailed chart notes** with:
   - Better clinical narrative
   - Specific values and interpretations
   - Complete SOAP sections
   - Clinical reasoning evident
3. **Console logs** showing each step:
   ```
   🤖 Chart Note Agent (ReAct-Style) starting...
   📝 Step 1: Analyzing clinical picture...
   📝 Step 2: Determining SOAP structure...
   📝 Step 3: Generating Subjective (S) section...
   ...
   ```

## Configuration

Edit `/agents/chart_note_agent.cjs`:
```javascript
this.config = {
  temperature: 0.3,      // Lower = more focused
  maxTokensPerStep: 1500, // Per-step limit
  timeoutPerStep: 60000,  // 60 seconds per step
  logSteps: true
};
```

## Files Modified

1. `/agents/chart_note_agent.cjs` (NEW)
2. `/server/index.cjs` (Updated to use agent)
3. `/tools/llm/prompt_builder.tool.cjs` (Enhanced SOAP prompt)
4. `/src/components/dashboard/StructuredChartNote.tsx` (SOAP UI)
