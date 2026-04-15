/**
 * Outpatient Record Extractor Agent
 * Optimized for outpatient/OPD records - focuses on chief complaints, diagnosis, medications
 * Skips Risk Assessment (not typically in OPD) and Treatment (usually minimal)
 */

const PDFReaderTool = require("../tools/pdf/pdf_reader.tool.cjs");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
const ProvenanceBuilderTool = require("../tools/clinical/provenance_builder.tool.cjs");

// Skills - selective for outpatient records
const DocumentAnalyzerSkill = require("../skills/extraction/document_analyzer.skill.cjs");
const DemographicsExtractorSkill = require("../skills/extraction/demographics_extractor.skill.cjs");
const VitalsExtractorSkill = require("../skills/extraction/vitals_extractor.skill.cjs");
const ClinicalDataExtractorSkill = require("../skills/extraction/clinical_data_extractor.skill.cjs");
const CrossValidatorSkill = require("../skills/validation/cross_validator.skill.cjs");

class OutpatientExtractorAgent {
  constructor(config = {}) {
    this.name = "Outpatient Record Extractor";
    this.version = "1.0.0";
    this.type = "outpatient_extractor";
    this.documentType = "outpatient_record";

    // Initialize tools
    this.pdfReader = new PDFReaderTool(config);
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);
    this.provenanceBuilder = new ProvenanceBuilderTool(config);

    // Initialize skills - OUTPATIENT SPECIFIC (no Risk Assessment)
    this.skills = [
      new DocumentAnalyzerSkill(),
      new DemographicsExtractorSkill(),
      new VitalsExtractorSkill(),
      new ClinicalDataExtractorSkill(),
      new CrossValidatorSkill()
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
      console.log(`\n🏥 Processing OUTPATIENT record: ${pdfName}`);

      // Emit starting event
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

      // Emit PDF read event
      if (onProgress) {
        onProgress({
          type: 'step',
          step: 'pdf_read',
          stepNumber: 0,
          totalSteps: this.skills.length,
          status: 'complete',
          data: { chars: pdfText.length, pages: pdfResult.pages }
        });
      }

      // Execute each skill in sequence
      const steps = [];
      let totalTokens = 0;
      let stepNumber = 0;

      for (const skill of this.skills) {
        stepNumber++;
        const stepName = skill.name;
        console.log(`\n   🔄 ${stepName}...`);

        const stepResult = await skill.execute({
          pdfText: pdfText,
          gemmaClient: this.gemmaClient,
          promptBuilder: this.promptBuilder,
          provenanceBuilder: this.provenanceBuilder,
          previousSteps: steps,
          documentType: this.documentType  // Pass document type to skills
        });

        steps.push(stepResult);

        if (stepResult.usage) {
          totalTokens += stepResult.usage.totalTokens || 0;
        }

        if (stepResult.success) {
          console.log(`      ✅ Completed (${stepResult.usage?.totalTokens || 0} tokens)`);
        } else {
          console.log(`      ❌ Failed: ${stepResult.error}`);
          if (!this.config.requireAllSteps) {
            console.log(`      ⚠️  Continuing despite failure...`);
          }
        }
      }

      // Assemble final result
      const finalResult = this.assembleFinalResult(steps, pdfName);

      const endTime = Date.now();

      // Emit complete event
      if (onProgress) {
        onProgress({
          type: 'complete',
          pdfName,
          latency: endTime - startTime,
          tokensUsed: totalTokens,
          confidence: finalResult.validation?.confidence_level || 'medium'
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
        tokensUsed: totalTokens,
        steps: steps.map(s => ({
          step: s.step,
          success: s.success,
          tokens: s.usage?.totalTokens || 0,
          latency: s.usage?.latency || 0,
          dataKeys: s.data ? Object.keys(s.data) : [],
          hasValidation: !!s.validation,
          validationIssues: s.validation?.issues?.length || 0,
          error: s.error || null
        })),
        data: finalResult
      };

    } catch (error) {
      console.error(`❌ Outpatient extractor failed: ${error.message}`);
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

  assembleFinalResult(steps, pdfName) {
    const result = {
      meta: {
        pdf_file: pdfName,
        processed_at: new Date().toISOString(),
        agent_version: this.version,
        document_type: this.documentType,
        extraction_focus: "Outpatient visit data - chief complaints, diagnosis, medications, vitals"
      },
      patient: {},
      vitals: {},
      diagnosis: {},
      medications: [],
      allergies: [],
      investigations: [],
      chief_complaints: [],
      visit_details: {},
      nursing_needs: [],
      provenance: {}
    };

    // Merge data from each step
    for (const step of steps) {
      if (!step.success || !step.data) continue;

      const data = step.data;

      // Patient demographics
      if (data.name) result.patient.name = data.name;
      if (data.mrn) result.patient.mrn = data.mrn;
      if (data.age) result.patient.age = data.age;
      if (data.gender) result.patient.gender = data.gender;
      if (data.admission_date) result.patient.admission_date = data.admission_date;
      if (data.discharge_date) result.patient.discharge_date = data.discharge_date;

      // Vitals - handle nested structure from vitals_extractor
      if (data.latest) {
        if (data.latest.bp) result.vitals.bp = data.latest.bp;
        if (data.latest.pulse?.value !== undefined) result.vitals.pulse = data.latest.pulse.value;
        if (data.latest.temperature?.value !== undefined) result.vitals.temperature = data.latest.temperature.value;
        if (data.latest.resp_rate !== undefined) result.vitals.resp_rate = data.latest.resp_rate;
        if (data.latest.spo2?.value !== undefined) result.vitals.spo2 = data.latest.spo2.value;
        if (data.latest.pain_score?.value !== undefined) result.vitals.pain_score = data.latest.pain_score.value;
        if (data.latest.grbs?.value !== undefined) result.vitals.grbs = data.latest.grbs.value;
      }
      // Also handle flat structure for backward compatibility
      if (data.bp) result.vitals.bp = data.bp;
      if (data.pulse && !result.vitals.pulse) result.vitals.pulse = data.pulse;
      if (data.temperature && !result.vitals.temperature) result.vitals.temperature = data.temperature;
      if (data.resp_rate && !result.vitals.resp_rate) result.vitals.resp_rate = data.resp_rate;
      if (data.spo2 && !result.vitals.spo2) result.vitals.spo2 = data.spo2;
      if (data.pain_score && !result.vitals.pain_score) result.vitals.pain_score = data.pain_score;
      if (data.grbs && !result.vitals.grbs) result.vitals.grbs = data.grbs;
      if (data.abnormal_flags) result.vitals.abnormal_flags = data.abnormal_flags;

      // Diagnosis
      if (data.diagnosis) {
        if (data.diagnosis.principal) result.diagnosis.principal = data.diagnosis.principal;
        if (data.diagnosis.icd_code) result.diagnosis.icd_code = data.diagnosis.icd_code;
        if (data.diagnosis.secondary) result.diagnosis.secondary = data.diagnosis.secondary;
        if (data.diagnosis.comorbidities) result.diagnosis.comorbidities = data.diagnosis.comorbidities;
      }

      // Medications
      if (data.medications && Array.isArray(data.medications)) {
        result.medications = [...result.medications, ...data.medications];
      }

      // Allergies
      if (data.allergies && Array.isArray(data.allergies)) {
        result.allergies = [...result.allergies, ...data.allergies];
      }

      // Investigations
      if (data.investigations && Array.isArray(data.investigations)) {
        result.investigations = [...result.investigations, ...data.investigations];
      }

      // Chief complaints (from clinical notes)
      if (data.chief_complaints) result.chief_complaints.push(data.chief_complaints);

      // Visit details
      if (data.visit_type) result.visit_details.visit_type = data.visit_type;
      if (data.department) result.visit_details.department = data.department;

      // Nursing needs
      if (data.nursing_needs && Array.isArray(data.nursing_needs)) {
        result.nursing_needs = [...result.nursing_needs, ...data.nursing_needs];
      }

      // Provenance/Audit Trail - IMPORTANT for data traceability
      if (data.provenance) {
        result.provenance = result.provenance || {};
        result.provenance = { ...result.provenance, ...data.provenance };
      }
    }

    // Get validation summary
    const validationStep = steps.find(s => s.step === 'cross_validator');
    if (validationStep && validationStep.data) {
      result.validation = validationStep.data.validation_summary;
    }

    return result;
  }
}

module.exports = OutpatientExtractorAgent;
