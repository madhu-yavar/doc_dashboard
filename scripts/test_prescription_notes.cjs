const path = require('path');
require('dotenv').config();

const PrescriptionTwoStageAgent = require('../agents/prescription_two_stage_agent.cjs');

function summarizeDashboardNotes(clinicalNotes = []) {
  return clinicalNotes.map((note) => ({
    type: note.type,
    summary: note.summary,
    source_type: note.source_type,
    is_synthetic: note.is_synthetic,
    page_number: note.page_number ?? null,
    confidence: note.confidence ?? null,
    confidence_reason: note.confidence_reason ?? null,
    is_inferred: note.is_inferred ?? null,
  }));
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing in environment');
  }

  const files = process.argv.slice(2);
  if (!files.length) {
    throw new Error('Pass one or more PDF filenames from data/');
  }

  const agent = new PrescriptionTwoStageAgent();
  const results = [];

  for (const file of files) {
    const pdfPath = path.join(process.cwd(), 'data', file);
    const result = await agent.process(pdfPath, {
      pdfName: file,
      geminiApiKey: apiKey,
      onProgress: null,
    });

    const data = result?.data || {};
    const stage3 = data.stage3 || {};
    const notes = stage3.handwritten_notes || [];
    const dashboardNotes = data.clinical_notes || [];

    results.push({
      file,
      success: result.success,
      processing_time: result.metadata?.processing_time ?? null,
      stage3_complete: result.metadata?.stage3_complete ?? null,
      stage3_required: result.metadata?.stage3_required ?? null,
      stage3_skipped_reason: result.metadata?.stage3_skipped_reason ?? null,
      stage3_notes_count: notes.length,
      stage3_notes: notes,
      dashboard_notes_count: dashboardNotes.length,
      dashboard_notes: summarizeDashboardNotes(dashboardNotes),
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
