/**
 * Voice Extractor Agent
 * Orchestrates voice-to-structured-data extraction using LangGraph.js
 * Processes physician dictation transcripts into dashboard-ready clinical data
 */

const { StateGraph } = require("@langchain/langgraph");
const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");
const ProvenanceBuilderTool = require("../tools/clinical/provenance_builder.tool.cjs");

// Voice Extraction Skills
const VoiceMedicationsExtractorSkill = require("../skills/extraction/voice_medications_extractor.skill.cjs");
const VoiceDiagnosisExtractorSkill = require("../skills/extraction/voice_diagnosis_extractor.skill.cjs");
const VoiceClinicalExtractorSkill = require("../skills/extraction/voice_clinical_extractor.skill.cjs");
const DemographicsExtractorSkill = require("../skills/extraction/demographics_extractor.skill.cjs");

// Dashboard mapper for final output
const DashboardMapperSkill = require("../skills/clinical/dashboard_mapper.skill.cjs");

class VoiceExtractorAgent {
  constructor(config = {}) {
    this.name = "Voice Extractor Agent";
    this.version = "1.0.0";
    this.type = "langgraph_agent";

    // Initialize tools
    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);
    this.provenanceBuilder = new ProvenanceBuilderTool(config);

    // Initialize voice extraction skills
    this.medicationsSkill = new VoiceMedicationsExtractorSkill(config);
    this.diagnosisSkill = new VoiceDiagnosisExtractorSkill(config);
    this.clinicalSkill = new VoiceClinicalExtractorSkill(config);
    this.demographicsSkill = new DemographicsExtractorSkill(config);
    this.dashboardMapper = new DashboardMapperSkill(config);

    this.config = {
      maxRetries: 2,
      timeoutPerStep: 180000,
      totalTimeout: 600000,
      logSteps: true,
      saveIntermediates: true,
      ...config
    };

    // Build the LangGraph
    this.graph = this.buildGraph();
  }

  /**
   * Define the VoiceIntakeState structure
   * This is the state that flows through the LangGraph nodes
   */
  createInitialState(sessionId, transcript) {
    return {
      sessionId,
      status: "queued",

      // Input: transcript from Gemini
      transcript: {
        segments: transcript.segments || [],
        rawText: transcript.rawText || "",
        language: transcript.language || null,
        overallConfidence: transcript.overallConfidence || null
      },

      // Extraction outputs
      medications: null,
      demographics: null,
      diagnosis: null,
      clinical: null,

      // Merged structured data
      extractedData: null,

      // Dashboard-ready output
      dashboardPayload: null,

      // Review items requiring human attention
      reviewItems: [],

      // Audit trail
      steps: [],
      errors: [],

      // Timestamps
      startedAt: new Date().toISOString(),
      completedAt: null
    };
  }

  /**
   * Node: Extract Medications
   */
  async extractMedications(state) {
    const stepName = "extract_medications";
    this.logStep(stepName, "Starting medication extraction");

    try {
      const result = await this.medicationsSkill.execute({
        transcript: state.transcript,
        gemmaClient: this.gemmaClient,
        promptBuilder: this.promptBuilder
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // Collect review items for medications needing review
      const reviewItems = (result.data.medications || [])
        .filter((med) => med.needs_review)
        .map((med) => ({
          id: `med_${Math.random().toString(36).substr(2, 9)}`,
          category: "medication",
          severity: med.confidence_score < 0.7 ? "high" : "medium",
          reasonCode: "low_confidence",
          title: `Medication review needed: ${med.name}`,
          extractedValue: med,
          suggestedValue: med,
          provenanceText: med.provenance?.quoted_text || "",
          provenanceTime: this.formatTimeRange(med.provenance?.time_range),
          resolution: "pending"
        }));

      this.logStep(stepName, "Completed", { count: result.data.medications?.length || 0, reviewItems: reviewItems.length });

      return {
        ...state,
        medications: result.data,
        reviewItems: [...state.reviewItems, ...reviewItems],
        steps: [...state.steps, { name: stepName, status: "completed", result: result.data }]
      };
    } catch (error) {
      this.logStep(stepName, "Failed", { error: error.message });
      return {
        ...state,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }]
      };
    }
  }

  /**
   * Node: Extract Demographics
   */
  async extractDemographics(state) {
    const stepName = "extract_demographics";
    this.logStep(stepName, "Starting demographics extraction");

    try {
      const result = await this.demographicsSkill.execute({
        transcript: state.transcript,
        gemmaClient: this.gemmaClient,
        promptBuilder: this.promptBuilder
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      this.logStep(stepName, "Completed", { patient: result.data });

      return {
        ...state,
        demographics: result.data,
        steps: [...state.steps, { name: stepName, status: "completed", result: result.data }]
      };
    } catch (error) {
      this.logStep(stepName, "Failed", { error: error.message });
      return {
        ...state,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }]
      };
    }
  }

  /**
   * Node: Extract Diagnosis
   */
  async extractDiagnosis(state) {
    const stepName = "extract_diagnosis";
    this.logStep(stepName, "Starting diagnosis extraction");

    try {
      const result = await this.diagnosisSkill.execute({
        transcript: state.transcript,
        gemmaClient: this.gemmaClient,
        promptBuilder: this.promptBuilder
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // Collect review items for diagnoses needing review
      const reviewItems = [];
      const principal = result.data.diagnosis?.principal;
      if (principal?.needs_review) {
        reviewItems.push({
          id: `dx_principal_${Math.random().toString(36).substr(2, 9)}`,
          category: "diagnosis",
          severity: "high",
          reasonCode: "low_confidence",
          title: `Principal diagnosis review: ${principal.name}`,
          extractedValue: principal,
          suggestedValue: principal,
          provenanceText: principal.provenance?.quoted_text || "",
          provenanceTime: this.formatTimeRange(principal.provenance?.time_range),
          resolution: "pending"
        });
      }

      (result.data.diagnosis?.secondary || [])
        .filter((dx) => dx.needs_review)
        .forEach((dx) => {
          reviewItems.push({
            id: `dx_secondary_${Math.random().toString(36).substr(2, 9)}`,
            category: "diagnosis",
            severity: "medium",
            reasonCode: "low_confidence",
            title: `Secondary diagnosis review: ${dx.name}`,
            extractedValue: dx,
            suggestedValue: dx,
            provenanceText: dx.provenance?.quoted_text || "",
            provenanceTime: this.formatTimeRange(dx.provenance?.time_range),
            resolution: "pending"
          });
        });

      this.logStep(stepName, "Completed", { principal: principal?.name, secondaryCount: result.data.diagnosis?.secondary?.length || 0, reviewItems: reviewItems.length });

      return {
        ...state,
        diagnosis: result.data,
        reviewItems: [...state.reviewItems, ...reviewItems],
        steps: [...state.steps, { name: stepName, status: "completed", result: result.data }]
      };
    } catch (error) {
      this.logStep(stepName, "Failed", { error: error.message });
      return {
        ...state,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }]
      };
    }
  }

  /**
   * Node: Extract Clinical Data
   */
  async extractClinical(state) {
    const stepName = "extract_clinical";
    this.logStep(stepName, "Starting clinical data extraction");

    try {
      const result = await this.clinicalSkill.execute({
        transcript: state.transcript,
        gemmaClient: this.gemmaClient,
        promptBuilder: this.promptBuilder
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      this.logStep(stepName, "Completed", {
        labs: result.data.lab_results?.length || 0,
        radiology: result.data.radiology?.length || 0,
        procedures: result.data.procedures?.length || 0,
        followUp: result.data.follow_up?.length || 0
      });

      return {
        ...state,
        clinical: result.data,
        steps: [...state.steps, { name: stepName, status: "completed", result: result.data }]
      };
    } catch (error) {
      this.logStep(stepName, "Failed", { error: error.message });
      return {
        ...state,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }]
      };
    }
  }

  /**
   * Node: Merge and Reconcile
   * Combines all extractions into a unified clinical document
   */
  async mergeAndReconcile(state) {
    const stepName = "merge_reconcile";
    this.logStep(stepName, "Merging extractions");

    try {
      const demographics = state.demographics || {};
      const diagnosisPayload = state.diagnosis?.diagnosis || {};
      const principalDiagnosis = diagnosisPayload.principal || null;
      const secondaryDiagnoses = Array.isArray(diagnosisPayload.secondary) ? diagnosisPayload.secondary : [];
      const symptomDetails = Array.isArray(state.diagnosis?.symptoms) ? state.diagnosis.symptoms : [];
      const rosItems = Array.isArray(state.clinical?.review_of_systems) ? state.clinical.review_of_systems : [];
      const physicalExamItems = Array.isArray(state.clinical?.physical_exam) ? state.clinical.physical_exam : [];
      const followUpItems = Array.isArray(state.clinical?.follow_up) ? state.clinical.follow_up : [];
      const sourceExcerpt = this.buildTranscriptSourceExcerpts(state.transcript.segments);
      const symptomSummary = this.buildSymptomSummary(symptomDetails);
      const rosSummary = this.buildReviewOfSystemsSummary(rosItems);
      const physicalExamSummary = this.buildPhysicalExamSummary(physicalExamItems);
      const medicationPlan = this.dedupeStrings(
        (state.medications?.medications || []).map((med) =>
          [med.name, med.dose, med.frequency, med.route].filter(Boolean).join(" ")
        )
      ).slice(0, 4).join("; ");
      const followUpSummary = this.dedupeStrings(
        followUpItems.map((item) => [item.specialty, item.timing, item.reason].filter(Boolean).join(": "))
      ).join("; ");
      const extractedData = {
        source_type: "voice_transcript",
        session_id: state.sessionId,

        // Patient demographics (from demographics extraction)
        patient: {
          name: this.getDemographicValue(demographics, "name", ""),
          mrn: this.getDemographicValue(demographics, "mrn", ""),
          age: this.getDemographicValue(demographics, "age", null),
          gender: this.getDemographicValue(demographics, "gender", ""),
          admission_date: this.getDemographicValue(demographics, "admission_date", null),
          discharge_date: this.getDemographicValue(demographics, "discharge_date", null)
        },

        // Diagnosis
        diagnosis: {
          principal: principalDiagnosis,
          secondary: secondaryDiagnoses,
          comorbidities: secondaryDiagnoses.map((d) => this.getDiagnosisText(d)).filter(Boolean),
          symptoms: this.dedupeStrings(symptomDetails.map((item) => this.formatSymptomEntry(item))),
          symptom_details: symptomDetails,
          rule_out: Array.isArray(diagnosisPayload.rule_out) ? diagnosisPayload.rule_out : []
        },

        // Allergies
        allergies: state.clinical?.allergies?.map((a) => a.allergen) || [],

        // Medications
        medications: state.medications?.medications?.map((med) => ({
          name: med.name,
          dose: med.dose,
          frequency: med.frequency,
          route: med.route,
          indication: med.indication,
          status: med.status || "continue",
          needs_review: med.needs_review || false,
          provenance: med.provenance
        })) || [],

        // Vitals - match the structure expected by dashboard mapper
        vitals: {
          latest: {
            bp: state.clinical?.vitals?.bp_systolic ? {
              systolic: state.clinical.vitals.bp_systolic,
              diastolic: state.clinical.vitals.bp_diastolic
            } : null,
            pulse: { value: state.clinical?.vitals?.pulse || null },
            temperature: { value: state.clinical?.vitals?.temperature || null },
            spo2: { value: state.clinical?.vitals?.spo2 || null },
            resp_rate: { value: state.clinical?.vitals?.resp_rate || null },
            weight: {
              value: state.clinical?.vitals?.weight?.value ?? null,
              unit: state.clinical?.vitals?.weight?.unit || ""
            },
            pain_score: { value: state.clinical?.vitals?.pain_score || null },
            blood_glucose: { value: state.clinical?.vitals?.blood_glucose || null }
          }
        },

        // Labs
        lab_results: state.clinical?.lab_results?.map((lab) => ({
          test_name: lab.test_name,
          value: lab.value,
          flag: lab.flag,
          provenance: lab.provenance
        })) || [],

        // Investigations
        investigations: state.clinical?.lab_results?.map((lab) => lab.test_name) || [],

        // Radiology
        radiology: {
          findings: [],
          pending: state.clinical?.radiology?.map((rad) => ({
            type: rad.type,
            body_part: rad.body_part,
            status: rad.status,
            provenance: rad.provenance
          })) || []
        },

        // Procedures
        procedures: state.clinical?.procedures?.map((proc) => ({
          name: proc.name,
          status: proc.status,
          urgency: proc.urgency,
          provenance: proc.provenance
        })) || [],

        // Treatment/Management
        treatment: {
          current_approach: "",
          management_items: [],
          procedures: state.clinical?.procedures?.map((p) => p.name) || [],
          response: "",
          complications: []
        },

        review_of_systems: {
          items: rosItems,
          positives: this.dedupeStrings(
            rosItems
              .filter((item) => !/denied|negative/i.test(String(item?.status || "")))
              .map((item) => this.formatSystemFinding(item))
          ),
          negatives: this.dedupeStrings(
            rosItems
              .filter((item) => /denied|negative/i.test(String(item?.status || "")))
              .map((item) => this.formatSystemFinding(item))
          )
        },

        physical_exam: {
          items: physicalExamItems,
          normal_findings: this.dedupeStrings(
            physicalExamItems
              .filter((item) => /normal/i.test(String(item?.status || "")))
              .map((item) => this.formatSystemFinding(item))
          ),
          abnormal_findings: this.dedupeStrings(
            physicalExamItems
              .filter((item) => /abnormal/i.test(String(item?.status || "")))
              .map((item) => this.formatSystemFinding(item))
          )
        },

        // Clinical Notes (from transcript segments)
        clinical_notes: [{
          type: "Voice Dictation",
          author: "Physician",
          date: new Date().toISOString().split("T")[0],
          summary: this.buildTranscriptSummary(state.transcript.segments),
          situation: symptomSummary,
          background: rosSummary,
          assessment: this.dedupeStrings([
            this.getDiagnosisText(principalDiagnosis),
            secondaryDiagnoses.length ? `Secondary diagnoses: ${secondaryDiagnoses.map((item) => this.getDiagnosisText(item)).filter(Boolean).join(", ")}` : "",
            physicalExamSummary,
          ]).join("; "),
          recommendations: this.dedupeStrings([medicationPlan, followUpSummary]).join("; "),
          pending_items: [],
          risk_flags: [],
          handed_over_by: "",
          handed_over_to: "",
          source_excerpt: sourceExcerpt,
          source_type: "voice_transcript"
        }],

        // Follow-up
        follow_up: {
          items: state.clinical?.follow_up?.map((fu) => ({
            specialty: fu.specialty,
            timing: fu.timing,
            reason: fu.reason,
            provenance: fu.provenance
          })) || []
        },

        // Discharge
        discharge: {
          dietary: [],
          instructions: [],
          red_flags: []
        },

        // Meta
        meta: {
          source_type: "voice_transcript",
          transcript_date: new Date().toISOString().split("T")[0],
          stt_backend: "gemini",
          overall_confidence: state.transcript.overallConfidence,
          segment_count: state.transcript.segments?.length || 0
        }
      };

      this.logStep(stepName, "Completed", { medications: extractedData.medications.length, diagnoses: extractedData.diagnosis.secondary.length + 1 });

      return {
        ...state,
        extractedData,
        steps: [...state.steps, { name: stepName, status: "completed", result: extractedData }]
      };
    } catch (error) {
      this.logStep(stepName, "Failed", { error: error.message });
      return {
        ...state,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }]
      };
    }
  }

  /**
   * Node: Map to Dashboard Schema
   * Converts extracted data to dashboard-ready format
   */
  async mapToDashboard(state) {
    const stepName = "map_dashboard";
    this.logStep(stepName, "Mapping to dashboard schema");

    try {
      // Use the dashboard mapper to convert to the expected schema
      const dashboardPayload = this.dashboardMapper.mapVoiceData?.(state.extractedData) || state.extractedData;

      this.logStep(stepName, "Completed");

      return {
        ...state,
        dashboardPayload,
        steps: [...state.steps, { name: stepName, status: "completed", result: dashboardPayload }]
      };
    } catch (error) {
      this.logStep(stepName, "Failed", { error: error.message });
      return {
        ...state,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }]
      };
    }
  }

  /**
   * Node: Decide Review
   * Determines if human review is required
   */
  async decideReview(state) {
    const stepName = "decide_review";
    const needsReview = state.reviewItems.length > 0;
    const hasErrors = state.errors.length > 0;
    const nextStatus = hasErrors
      ? (needsReview ? "review_required" : "failed")
      : (needsReview ? "review_required" : "processed");

    this.logStep(stepName, "Completed", { needsReview, reviewItemCount: state.reviewItems.length, hasErrors, nextStatus });

    return {
      ...state,
      status: nextStatus,
      completedAt: new Date().toISOString(),
      steps: [...state.steps, { name: stepName, status: "completed", result: { needsReview, count: state.reviewItems.length, nextStatus } }]
    };
  }

  /**
   * Build the LangGraph
   */
  buildGraph() {
    // Define the nodes
    const nodes = {
      extractMedications: this.extractMedications.bind(this),
      extractDemographics: this.extractDemographics.bind(this),
      extractDiagnosis: this.extractDiagnosis.bind(this),
      extractClinical: this.extractClinical.bind(this),
      mergeAndReconcile: this.mergeAndReconcile.bind(this),
      mapToDashboard: this.mapToDashboard.bind(this),
      decideReview: this.decideReview.bind(this)
    };

    // For now, we'll run sequentially without the StateGraph compile
    // This is a simplified version - full LangGraph implementation would use:
    // const graph = new StateGraph({ /* state schema */ })
    //   .addNode("extractMedications", nodes.extractMedications)
    //   .addNode("extractDiagnosis", nodes.extractDiagnosis)
    //   ...
    //   .addEdge("extractMedications", "extractDiagnosis")
    //   ...
    //   .compile();

    return nodes;
  }

  /**
   * Execute the voice extraction pipeline
   */
  async execute(sessionId, transcript) {
    this.logStep("voice_extractor", "Starting voice extraction", { sessionId });

    // Initialize state
    let state = this.createInitialState(sessionId, transcript);

    // Execute nodes sequentially (simplified LangGraph execution)
    // In full implementation, this would use graph.invoke(state)
    const nodes = this.graph;

    state = await nodes.extractMedications(state);
    state = await nodes.extractDemographics(state);
    state = await nodes.extractDiagnosis(state);
    state = await nodes.extractClinical(state);
    state = await nodes.mergeAndReconcile(state);
    state = await nodes.mapToDashboard(state);
    state = await nodes.decideReview(state);

    this.logStep("voice_extractor", "Completed", {
      status: state.status,
      reviewItems: state.reviewItems.length,
      errors: state.errors.length
    });

    return {
      success: state.errors.length === 0 || state.status === "review_required",
      sessionId: state.sessionId,
      status: state.status,
      extractedData: state.extractedData,
      dashboardPayload: state.dashboardPayload,
      reviewItems: state.reviewItems,
      steps: state.steps,
      errors: state.errors
    };
  }

  /**
   * Utility: Format time range for display
   */
  formatTimeRange(timeRange) {
    if (!timeRange || (timeRange.start_ms === null && timeRange.end_ms === null)) {
      return "";
    }
    const start = timeRange.start_ms !== null ? `${Math.round(timeRange.start_ms / 1000)}s` : "?";
    const end = timeRange.end_ms !== null ? `${Math.round(timeRange.end_ms / 1000)}s` : "?";
    return `${start} - ${end}`;
  }

  /**
   * Utility: Build transcript summary from segments
   */
  buildTranscriptSummary(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return "";
    }

    const selectedTexts = this.selectTranscriptSegments(segments, 6)
      .map((segment) => String(segment?.text || "").trim())
      .filter(Boolean);

    const combined = selectedTexts.join(" ");
    if (combined.length <= 500) {
      return combined;
    }

    const start = combined.slice(0, 260).trim();
    const end = combined.slice(-220).trim();
    return `${start} ... ${end}`.substring(0, 500).trim();
  }

  buildTranscriptSourceExcerpts(segments) {
    return this.selectTranscriptSegments(segments, 6)
      .map((segment) => String(segment?.text || "").trim())
      .filter(Boolean);
  }

  selectTranscriptSegments(segments, maxSegments = 6) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return [];
    }

    if (segments.length <= maxSegments) {
      return segments;
    }

    const keywordPattern = /(assessment|impression|diagnosis|plan|follow[\s-]?up|return|exam|physical|review of systems|ros)/i;
    const selectedIndices = new Set();

    [0, 1, segments.length - 2, segments.length - 1]
      .filter((index) => index >= 0 && index < segments.length)
      .forEach((index) => selectedIndices.add(index));

    segments.forEach((segment, index) => {
      if (keywordPattern.test(String(segment?.text || "")) && selectedIndices.size < maxSegments) {
        selectedIndices.add(index);
      }
    });

    const midpoint = Math.floor(segments.length / 2);
    if (selectedIndices.size < maxSegments) {
      selectedIndices.add(midpoint);
    }

    for (let index = 0; index < segments.length && selectedIndices.size < maxSegments; index += 1) {
      selectedIndices.add(index);
    }

    return [...selectedIndices]
      .sort((a, b) => a - b)
      .slice(0, maxSegments)
      .map((index) => segments[index]);
  }

  getDemographicValue(demographics, field, fallback) {
    const directValue = demographics?.[field];
    if (directValue !== undefined && directValue !== null && directValue !== "") {
      return directValue;
    }

    const nestedValue = demographics?.patient?.[field];
    if (nestedValue !== undefined && nestedValue !== null && nestedValue !== "") {
      return nestedValue;
    }

    return fallback;
  }

  getDiagnosisText(diagnosis) {
    if (!diagnosis) return "";
    if (typeof diagnosis === "string") return diagnosis.trim();
    return String(diagnosis.name || diagnosis.description || "").trim();
  }

  dedupeStrings(items = []) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
      const normalized = String(item || "").trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }

    return output;
  }

  formatSymptomEntry(symptom) {
    if (!symptom) return "";
    if (typeof symptom === "string") return symptom.trim();

    const name = String(symptom.name || "").trim();
    if (!name) return "";

    const status = String(symptom.status || "").toLowerCase();
    const duration = String(symptom.duration || "").trim();
    let label = name;

    if (status === "denied") {
      label = `Denies ${name}`;
    } else if (status === "uncertain") {
      label = `Possible ${name}`;
    }

    return duration ? `${label} (${duration})` : label;
  }

  formatSystemFinding(item) {
    if (!item) return "";
    if (typeof item === "string") return item.trim();

    const system = String(item.system || "").trim();
    const finding = String(item.finding || item.name || "").trim();
    if (!finding) return "";

    const status = String(item.status || "").toLowerCase();
    const prefix = system ? `${system}: ` : "";

    if (status === "denied" || status === "negative") {
      return `${prefix}Denies ${finding}`;
    }

    return `${prefix}${finding}`;
  }

  buildSymptomSummary(symptoms) {
    return this.dedupeStrings((symptoms || []).map((item) => this.formatSymptomEntry(item))).join("; ");
  }

  buildReviewOfSystemsSummary(items) {
    return this.dedupeStrings((items || []).map((item) => this.formatSystemFinding(item))).join("; ");
  }

  buildPhysicalExamSummary(items) {
    return this.dedupeStrings((items || []).map((item) => this.formatSystemFinding(item))).join("; ");
  }

  /**
   * Utility: Log step execution
   */
  logStep(step, status, details = {}) {
    if (!this.config.logSteps) return;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [VoiceExtractor] [${step}] ${status}`, details);
  }
}

module.exports = VoiceExtractorAgent;
