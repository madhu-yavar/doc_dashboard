/**
 * Chart Note Extractor Agent
 * Optimized for clinical chart notes, progress notes, and nursing notes
 * Focuses on Notes + Diagnosis, extracts clinical narrative and assessments
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
const ProvenanceBuilderTool = require("../tools/clinical/provenance_builder.tool.cjs");

// Skills - selective for chart notes
const DocumentAnalyzerSkill = require("../skills/extraction/document_analyzer.skill.cjs");
const DemographicsExtractorSkill = require("../skills/extraction/demographics_extractor.skill.cjs");
const ClinicalDataExtractorSkill = require("../skills/extraction/clinical_data_extractor.skill.cjs");

class ChartNoteExtractorAgent {
  constructor(config = {}) {
    this.name = "Chart Note Extractor";
    this.version = "1.0.0";
    this.type = "chart_note_extractor";
    this.documentType = "chart_note";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);
    this.provenanceBuilder = new ProvenanceBuilderTool(config);

    // CHART NOTE SPECIFIC - Focus on narrative extraction
    this.skills = [
      new DocumentAnalyzerSkill(),
      new DemographicsExtractorSkill(),
      new ClinicalDataExtractorSkill()
    ];

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 120000,
      totalTimeout: 300000,
      requireAllSteps: false,
      logSteps: true,
      saveIntermediates: true,
      ...config
    };
  }

  async process(pdfPath, options = {}) {
    const startTime = Date.now();
    const pdfName = options.pdfName || pdfPath.split("/").pop();
    const onProgress = options.onProgress || null;

    try {
      console.log(`\n📝 Processing CHART NOTE: ${pdfName}`);

      if (onProgress) {
        onProgress({ type: 'start', pdfName, totalSteps: this.skills.length, documentType: this.documentType });
      }

      // Step 1: Read PDF
      const pdfResult = await this.pdfReader.execute(pdfPath, 50000);
      if (!pdfResult.success) {
        throw new Error(`Failed to read PDF: ${pdfResult.error}`);
      }

      const pdfText = pdfResult.text;
      console.log(`   📖 PDF read: ${pdfText.length} chars, ${pdfResult.pages} pages`);

      // Step 2: Extract clinical notes using specialized prompt
      const notesResult = await this.extractClinicalNotes(pdfText);
      const demographicsResult = await this.extractDemographics(pdfText);

      const steps = [
        { step: 'document_analyzer', success: true, data: { document_type: 'Chart Note' } },
        { step: 'demographics_extractor', success: demographicsResult.success, data: demographicsResult.data },
        { step: 'clinical_notes_extractor', success: notesResult.success, data: notesResult.data, usage: notesResult.usage }
      ];

      const finalResult = this.assembleFinalResult(steps, pdfName);
      const endTime = Date.now();

      if (onProgress) {
        onProgress({
          type: 'complete',
          pdfName,
          latency: endTime - startTime,
          tokensUsed: (notesResult.usage?.totalTokens || 0) + (demographicsResult.usage?.totalTokens || 0)
        });
      }

      return {
        success: true,
        agent: this.name,
        agentType: this.type,
        documentType: this.documentType,
        pdfName: pdfName,
        pdfPath: pdfPath,
        latency: endTime - startTime,
        tokensUsed: (notesResult.usage?.totalTokens || 0) + (demographicsResult.usage?.totalTokens || 0),
        steps: steps.map(s => ({
          step: s.step,
          success: s.success,
          tokens: s.usage?.totalTokens || 0,
          latency: s.usage?.latency || 0,
          dataKeys: s.data ? Object.keys(s.data) : [],
          error: s.error || null
        })),
        data: finalResult
      };

    } catch (error) {
      console.error(`❌ Chart note extractor failed: ${error.message}`);
      return {
        success: false,
        agent: this.name,
        agentType: this.type,
        documentType: this.documentType,
        pdfName: pdfName,
        pdfPath: pdfPath,
        error: error.message,
        data: null
      };
    }
  }

  async extractClinicalNotes(pdfText) {
    const startTime = Date.now();

    const prompt = `You are a specialized clinical note extractor. Extract structured clinical notes from the following text.

Return a JSON object with this structure:
{
  "clinical_notes": [
    {
      "type": "Type of note (Resident Note|Consultant Note|Nursing Note|Progress Note|Handover|Discharge Note)",
      "date": "Date of the note",
      "time": "Time if available",
      "author": "Author/Physician name",
      "summary": "Brief summary of the note",
      "situation": "Current situation (SOAP S)",
      "background": "Background/context (SOAP S or O)",
      "assessment": "Clinical assessment (SOAP A)",
      "recommendations": "Plan/recommendations (SOAP P)",
      "diagnosis_mentioned": "Any diagnosis mentioned",
      "vitals_mentioned": "Any vitals mentioned",
      "medications_mentioned": "Any medications mentioned",
      "pending_items": ["Any pending actions, tests, follow-ups"],
      "risk_flags": ["Any risks or concerns mentioned"]
    }
  ],
  "diagnosis": {
    "principal": "Main diagnosis/condition",
    "secondary": ["Other diagnoses mentioned"]
  }
}

IMPORTANT:
- Extract EACH separate note as a separate entry
- Preserve clinical terminology exactly as written
- Include the author/physician name when available
- Extract all pending actions, follow-ups, and concerns
- For SOAP notes, map to S/O/A/P structure appropriately

Document text:
${pdfText.substring(0, 12000)}

Return only valid JSON, no explanation.`;

    try {
      const response = await this.gemmaClient.generate({
        prompt,
        maxTokens: 4000,
        temperature: 0.1
      });

      const usage = {
        totalTokens: response.usage?.totalTokens || 0,
        latency: Date.now() - startTime
      };

      let data;
      try {
        const cleaned = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        data = JSON.parse(cleaned);
      } catch (parseError) {
        console.warn('Failed to parse notes as JSON, using fallback');
        data = this.fallbackNotesExtraction(pdfText);
      }

      return {
        success: true,
        data,
        usage
      };

    } catch (error) {
      console.error('LLM notes extraction failed:', error.message);
      return {
        success: true,
        data: this.fallbackNotesExtraction(pdfText),
        usage: { totalTokens: 0, latency: Date.now() - startTime }
      };
    }
  }

  async extractDemographics(pdfText) {
    const startTime = Date.now();

    const prompt = `Extract only patient demographics from this text. Return JSON:
{
  "patient": {
    "name": "Patient name",
    "mrn": "MRN/Hospital number",
    "age": age,
    "gender": "gender"
  }
}

Text: ${pdfText.substring(0, 3000)}`;

    try {
      const response = await this.gemmaClient.generate({
        prompt,
        maxTokens: 500,
        temperature: 0.1
      });

      const usage = {
        totalTokens: response.usage?.totalTokens || 0,
        latency: Date.now() - startTime
      };

      let data;
      try {
        const cleaned = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        data = { patient: JSON.parse(cleaned).patient || {} };
      } catch {
        data = { patient: {} };
      }

      return {
        success: true,
        data,
        usage
      };
    } catch (error) {
      return {
        success: true,
        data: { patient: {} },
        usage: { totalTokens: 0, latency: Date.now() - startTime }
      };
    }
  }

  fallbackNotesExtraction(pdfText) {
    const results = {
      clinical_notes: [],
      diagnosis: { principal: '', secondary: [] }
    };

    // Try to identify note sections
    const notePatterns = [
      { regex: /Resident[s]?\s*Note[s]?\s*[:](.+?)(?=Resident|Consultant|Nursing|Progress|Handover|$)/gis, type: 'Resident Note' },
      { regex: /Consultant[s]?\s*Note[s]?\s*[:](.+?)(?=Resident|Consultant|Nursing|Progress|Handover|$)/gis, type: 'Consultant Note' },
      { regex: /Nursing\s*(?:Progress\s*)?Note[s]?\s*[:](.+?)(?=Resident|Consultant|Nursing|Progress|Handover|$)/gis, type: 'Nursing Note' },
      { regex: /Progress\s*Note[s]?\s*[:](.+?)(?=Resident|Consultant|Nursing|Progress|Handover|$)/gis, type: 'Progress Note' },
      { regex: /Handover\s*[:](.+?)(?=Resident|Consultant|Nursing|Progress|Handover|$)/gis, type: 'Handover' },
    ];

    for (const pattern of notePatterns) {
      const matches = [...pdfText.matchAll(pattern.regex)];
      for (const match of matches) {
        const noteText = match[1]?.trim();
        if (noteText && noteText.length > 20) {
          results.clinical_notes.push({
            type: pattern.type,
            summary: noteText.substring(0, 500),
            date: new Date().toISOString().split('T')[0]
          });
        }
      }
    }

    // If no structured notes found, create one from full text
    if (results.clinical_notes.length === 0) {
      results.clinical_notes.push({
        type: 'Clinical Note',
        summary: pdfText.substring(0, 1000),
        date: new Date().toISOString().split('T')[0]
      });
    }

    return results;
  }

  assembleFinalResult(steps, pdfName) {
    const result = {
      meta: {
        pdf_file: pdfName,
        processed_at: new Date().toISOString(),
        agent_version: this.version,
        document_type: this.documentType,
        extraction_focus: "Clinical narrative notes and assessments"
      },
      patient: {},
      clinical_notes: [],
      diagnosis: {},
      pending_items: {
        pending_labs: [],
        pending_radiology: [],
        pending_followups: [],
        pending_discharge_items: []
      },
      provenance: {}
    };

    for (const step of steps) {
      if (!step.success || !step.data) continue;
      const data = step.data;

      if (data.patient) result.patient = { ...result.patient, ...data.patient };
      if (data.clinical_notes) result.clinical_notes = [...result.clinical_notes, ...data.clinical_notes];
      if (data.diagnosis) result.diagnosis = { ...result.diagnosis, ...data.diagnosis };
      if (data.provenance) result.provenance = { ...result.provenance, ...data.provenance };

      // Extract pending items from notes
      if (data.clinical_notes) {
        for (const note of data.clinical_notes) {
          if (note.pending_items && Array.isArray(note.pending_items)) {
            for (const item of note.pending_items) {
              const itemLower = item.toLowerCase();
              if (itemLower.includes('lab') || itemLower.includes('blood') || itemLower.includes('cbc')) {
                result.pending_items.pending_labs.push({ test_name: item, priority: 'medium' });
              } else if (itemLower.includes('x-ray') || itemLower.includes('ct') || itemLower.includes('usg')) {
                result.pending_items.pending_radiology.push({ type: item, priority: 'medium' });
              } else if (itemLower.includes('follow') || itemLower.includes('review')) {
                result.pending_items.pending_followups.push({ department: 'TBD', purpose: item });
              }
            }
          }
        }
      }
    }

    return result;
  }
}

module.exports = ChartNoteExtractorAgent;
