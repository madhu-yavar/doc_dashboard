const DrugEntityResolverTool = require("../../tools/chat/drug_entity_resolver.tool.cjs");
const MedicationBrandVerifierTool = require("../../tools/validation/medication_brand_verifier_v2.tool.cjs");

class LiveConversationDraftExtractorSkill {
  constructor(config = {}) {
    this.name = "Live Conversation Draft Extractor";
    this.version = "1.0.0";
    this.config = config;
    this.drugEntityResolver = config.drugEntityResolver || null;
    this.medicationBrandVerifier = config.medicationBrandVerifier || null;
    this.enableMedicationEntityResolution = config.enableMedicationEntityResolution ?? true;
    this.enableGroundedMedicationVerification = config.enableGroundedMedicationVerification ?? false;
  }

  normalizeWhitespace(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  normalizeTextArray(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (typeof item === "string") return this.normalizeWhitespace(item);
        if (!item || typeof item !== "object") return "";
        return this.normalizeWhitespace(
          item.name
          || item.label
          || item.value
          || item.text
          || item.summary
          || item.description
          || item.reason
        );
      })
      .filter(Boolean);
  }

  normalizeMedicationStatus(value = "", source = "") {
    const normalized = this.normalizeWhitespace(value).toLowerCase();
    const normalizedSource = this.normalizeWhitespace(source).toLowerCase();

    if (["current", "prescribed", "planned", "needs_review", "draft"].includes(normalized)) {
      return normalized;
    }

    if (["continue", "continued", "maintain"].includes(normalized)) return "planned";
    if (["start", "started", "ordered", "new"].includes(normalized)) return "prescribed";
    if (["home", "existing", "ongoing"].includes(normalized)) return "current";
    if (["review", "uncertain", "unknown", "ambiguous"].includes(normalized)) return "needs_review";

    if (normalizedSource.includes("patient")) return "current";
    if (normalizedSource.includes("continu")) return "planned";
    if (normalizedSource.includes("prescrib") || normalizedSource.includes("clinician")) return "prescribed";

    return "needs_review";
  }

  normalizeMedicationSource(value = "", status = "") {
    const normalized = this.normalizeWhitespace(value).toLowerCase();
    const normalizedStatus = this.normalizeMedicationStatus(status, value);

    if (normalized.includes("patient")) return "patient_reported";
    if (normalized.includes("continu")) return "clinician_continuation";
    if (normalized.includes("prescrib") || normalized.includes("clinician")) return "clinician_prescribed";

    if (normalizedStatus === "current") return "patient_reported";
    if (normalizedStatus === "planned") return "clinician_continuation";
    if (normalizedStatus === "prescribed") return "clinician_prescribed";
    return "uncertain";
  }

  buildMedicationInstruction(item = {}) {
    const directInstruction = this.normalizeWhitespace(item.instruction || item.instructions || item.note);
    if (directInstruction) return directInstruction;

    const parts = [
      item.frequency,
      item.route,
      item.duration,
      item.reason,
      item.indication,
    ]
      .map((entry) => this.normalizeWhitespace(entry))
      .filter(Boolean);

    return parts.join("; ");
  }

  sanitizeMedication(item = {}) {
    const name = this.normalizeWhitespace(
      item.name
      || item.medication
      || item.drug
      || item.label
      || item.normalized_display
      || item.generic_name
    );

    if (!name) return null;

    const status = this.normalizeMedicationStatus(item.status, item.source);
    const source = this.normalizeMedicationSource(item.source, status);
    const frequency = this.normalizeWhitespace(item.frequency);
    const route = this.normalizeWhitespace(item.route);
    const duration = this.normalizeWhitespace(item.duration);
    const dosageForm = this.normalizeWhitespace(item.dosage_form || item.form);
    const strength = this.normalizeWhitespace(item.strength || item.dose || item.dosage);
    const instruction = this.buildMedicationInstruction(item);

    return {
      ...item,
      name,
      instruction,
      status,
      source,
      ...(frequency ? { frequency } : {}),
      ...(route ? { route } : {}),
      ...(duration ? { duration } : {}),
      ...(dosageForm ? { dosage_form: dosageForm } : {}),
      ...(strength ? { strength } : {}),
      ...(this.normalizeWhitespace(item.generic_name) ? { generic_name: this.normalizeWhitespace(item.generic_name) } : {}),
      ...(this.normalizeWhitespace(item.normalized_display) ? { normalized_display: this.normalizeWhitespace(item.normalized_display) } : {}),
      ...(Array.isArray(item.ingredient_list) ? {
        ingredient_list: item.ingredient_list.map((entry) => this.normalizeWhitespace(entry)).filter(Boolean).slice(0, 6),
      } : {}),
      ...(this.normalizeWhitespace(item.evidence) ? { evidence: this.normalizeWhitespace(item.evidence) } : {}),
      ...(this.normalizeWhitespace(item.review_reason) ? { review_reason: this.normalizeWhitespace(item.review_reason) } : {}),
      ...(this.normalizeWhitespace(item.confidence) ? { confidence: this.normalizeWhitespace(item.confidence) } : {}),
    };
  }

  sanitizePatient(patient = {}) {
    return {
      name: this.normalizeWhitespace(patient.name),
      age: Number.isFinite(Number(patient.age)) ? Number(patient.age) : null,
      gender: this.normalizeWhitespace(patient.gender),
    };
  }

  sanitizeVitals(vitals = {}) {
    const latest = vitals?.latest && typeof vitals.latest === "object" ? vitals.latest : {};
    const bp = latest.bp && typeof latest.bp === "object" ? latest.bp : {};
    const pulse = latest.pulse && typeof latest.pulse === "object" ? latest.pulse : {};
    const temperature = latest.temperature && typeof latest.temperature === "object" ? latest.temperature : {};
    const spo2 = latest.spo2 && typeof latest.spo2 === "object" ? latest.spo2 : {};
    const weight = latest.weight && typeof latest.weight === "object" ? latest.weight : {};

    return {
      latest: {
        bp: {
          systolic: Number.isFinite(Number(bp.systolic)) ? Number(bp.systolic) : null,
          diastolic: Number.isFinite(Number(bp.diastolic)) ? Number(bp.diastolic) : null,
        },
        pulse: {
          value: Number.isFinite(Number(pulse.value)) ? Number(pulse.value) : null,
          unit: this.normalizeWhitespace(pulse.unit) || "bpm",
        },
        temperature: {
          value: Number.isFinite(Number(temperature.value)) ? Number(temperature.value) : null,
          unit: this.normalizeWhitespace(temperature.unit) || "F",
        },
        spo2: {
          value: Number.isFinite(Number(spo2.value)) ? Number(spo2.value) : null,
          unit: this.normalizeWhitespace(spo2.unit) || "%",
        },
        weight: {
          value: Number.isFinite(Number(weight.value)) ? Number(weight.value) : null,
          unit: this.normalizeWhitespace(weight.unit) || "kg",
        },
      },
    };
  }

  sanitizeDraft(raw = {}) {
    return {
      chiefComplaint: this.normalizeWhitespace(raw.chiefComplaint || raw.chief_complaint),
      hpi: this.normalizeWhitespace(raw.hpi),
      ros: this.normalizeTextArray(raw.ros || raw.review_of_systems),
      pastHistory: this.normalizeTextArray(raw.pastHistory || raw.past_history),
      diagnosis: this.normalizeWhitespace(raw.diagnosis),
      assessment: this.normalizeWhitespace(raw.assessment),
      symptoms: this.normalizeTextArray(raw.symptoms),
      medications: Array.isArray(raw.medications)
        ? raw.medications.map((item) => this.sanitizeMedication(item)).filter(Boolean)
        : [],
      labs: this.normalizeTextArray(raw.labs),
      radiology: this.normalizeTextArray(raw.radiology),
      procedures: this.normalizeTextArray(raw.procedures),
      followUp: this.normalizeTextArray(raw.followUp || raw.follow_up),
      plan: this.normalizeTextArray(raw.plan),
      patient: this.sanitizePatient(raw.patient || {}),
      vitals: this.sanitizeVitals(raw.vitals || {}),
    };
  }

  repairJson(content) {
    let repaired = "";
    let inString = false;
    let escaped = false;

    for (const char of String(content || "")) {
      if (inString && (char === "\n" || char === "\r" || char === "\t")) {
        repaired += " ";
        escaped = false;
        continue;
      }

      repaired += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
      }
    }

    repaired = repaired.replace(/,\s*([}\]])/g, "$1");

    if (repaired.includes("```json")) {
      const match = repaired.match(/```json\s*([\s\S]*?)\s*```/);
      if (match?.[1]) return match[1].trim();
    }

    if (repaired.includes("```")) {
      const match = repaired.match(/```\s*([\s\S]*?)\s*```/);
      if (match?.[1]) return match[1].trim();
    }

    return repaired;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [normalized];
    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    let lastError = null;
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
        try {
          return JSON.parse(this.repairJson(candidate));
        } catch (repairError) {
          lastError = repairError;
        }
      }
    }

    throw new Error(`Unable to parse model JSON response. Last error: ${lastError?.message || "Unknown error"}`);
  }

  buildJsonRetryPrompt(originalPrompt, invalidContent) {
    return `${originalPrompt}

IMPORTANT:
- Your previous response was not valid JSON.
- Return ONLY one valid JSON object.
- Do not wrap the JSON in markdown fences.
- Do not add commentary.

PREVIOUS INVALID RESPONSE:
${String(invalidContent || "").slice(0, 6000)}`;
  }

  buildPrompt({ transcript = "" }) {
    return `You extract structured clinical data from live doctor-patient conversation transcripts.

Return ONLY one compact JSON object. Do not add markdown. Do not echo the transcript.

PR-4 medication and order rules:
- medications: capture every medication mention that is clinically relevant, but classify intent correctly
  * status="current": patient-reported home medication already being taken
  * status="prescribed": new clinician prescription or start order in this encounter
  * status="planned": explicit clinician continuation, adjustment, or keep-taking plan
  * status="needs_review": ambiguous medication mention that should not be auto-promoted
- source:
  * "patient_reported" for home meds/history from patient side
  * "clinician_prescribed" for new doctor orders
  * "clinician_continuation" for explicit continue/maintain instructions
  * "uncertain" when unclear
- never convert patient history medication into a new prescription unless the clinician gives a clear order
- labs, radiology, and procedures: include ONLY tests or procedures the clinician explicitly orders, arranges, performs, or clearly reviews in this encounter
- if a test is merely mentioned as a possibility, do not include it
- keep medication names, strengths, and orders specific when spoken explicitly
- keep assessment separate from symptoms and diagnosis
- do not invent demographics, vitals, or medications

JSON schema:
{
  "chiefComplaint": "",
  "hpi": "",
  "ros": [],
  "pastHistory": [],
  "diagnosis": "",
  "assessment": "",
  "symptoms": [],
  "patient": {
    "name": "",
    "age": null,
    "gender": ""
  },
  "vitals": {
    "latest": {
      "bp": { "systolic": null, "diastolic": null },
      "pulse": { "value": null, "unit": "bpm" },
      "temperature": { "value": null, "unit": "F" },
      "spo2": { "value": null, "unit": "%" },
      "weight": { "value": null, "unit": "kg" }
    }
  },
  "medications": [
    {
      "name": "",
      "instruction": "",
      "status": "current",
      "source": "patient_reported",
      "generic_name": "",
      "normalized_display": "",
      "dosage_form": "",
      "strength": "",
      "frequency": "",
      "route": "",
      "duration": "",
      "evidence": "",
      "review_reason": "",
      "confidence": "high"
    }
  ],
  "labs": [],
  "radiology": [],
  "procedures": [],
  "followUp": [],
  "plan": []
}

Transcript:
${transcript}`;
  }

  async executeJsonWithClient(client, prompt, options = {}) {
    const firstResult = await client.execute(prompt, options);
    if (!firstResult?.success) {
      return { success: false, error: firstResult?.error || "Model request failed" };
    }

    try {
      return {
        success: true,
        data: this.parseModelJson(firstResult.content),
        usage: firstResult.usage,
      };
    } catch (firstParseError) {
      const retryResult = await client.execute(
        this.buildJsonRetryPrompt(prompt, firstResult.content),
        { ...options, temperature: 0, responseMimeType: options.responseMimeType || "application/json" }
      );

      if (!retryResult?.success) {
        return {
          success: false,
          error: `${firstParseError.message}; retry failed: ${retryResult?.error || "Unknown error"}`,
        };
      }

      try {
        return {
          success: true,
          data: this.parseModelJson(retryResult.content),
          usage: retryResult.usage || firstResult.usage,
        };
      } catch (retryParseError) {
        return {
          success: false,
          error: `${retryParseError.message}. Retry content preview: ${String(retryResult.content || "").slice(0, 240)}`,
        };
      }
    }
  }

  shouldRunMedicationValidation(session = null) {
    if (!this.enableMedicationEntityResolution) return false;
    if (!session) return false;
    if (session.endedAt) return true;
    return ["review_required", "finalizing", "finalized"].includes(String(session.status || "").toLowerCase());
  }

  getDrugEntityResolver() {
    if (!this.enableMedicationEntityResolution) return null;
    if (!this.drugEntityResolver) {
      this.drugEntityResolver = new DrugEntityResolverTool({
        gemma: this.config.gemma || {},
      });
    }
    return this.drugEntityResolver;
  }

  getMedicationBrandVerifier() {
    if (!this.enableGroundedMedicationVerification) return null;
    if (!this.medicationBrandVerifier) {
      this.medicationBrandVerifier = new MedicationBrandVerifierTool({
        geminiBaseUrl: this.config.gemini?.baseUrl,
        geminiModel: this.config.gemini?.model,
        timeout: this.config.gemini?.timeout || this.config.timeout,
        apiKey: this.config.gemini?.apiKey || process.env.GEMINI_API_KEY || "",
      });
    }
    return this.medicationBrandVerifier;
  }

  async enrichMedications(medications = [], context = {}) {
    const normalized = Array.isArray(medications) ? medications.map((item) => this.sanitizeMedication(item)).filter(Boolean) : [];
    if (!normalized.length || !this.shouldRunMedicationValidation(context.session)) {
      return normalized;
    }

    const resolver = this.getDrugEntityResolver();
    const verifier = context.allowGroundedMedicationValidation ? this.getMedicationBrandVerifier() : null;
    const internalEvidence = normalized.map((item) => ({
      section: "medications",
      value: [item.name, item.instruction, item.strength].filter(Boolean).join(" ").trim(),
    }));

    const enriched = [];
    for (const medication of normalized.slice(0, 6)) {
      let nextMedication = { ...medication };

      if (resolver && nextMedication.name) {
        try {
          const resolution = await resolver.resolve(nextMedication.name, internalEvidence);
          if (resolution) {
            nextMedication = {
              ...nextMedication,
              ...(this.normalizeWhitespace(nextMedication.normalized_display) ? {} : this.normalizeWhitespace(resolution.normalized_display) ? { normalized_display: this.normalizeWhitespace(resolution.normalized_display) } : {}),
              ...(this.normalizeWhitespace(nextMedication.generic_name) ? {} : this.normalizeWhitespace(resolution.generic_name) ? { generic_name: this.normalizeWhitespace(resolution.generic_name) } : {}),
              ...(Array.isArray(nextMedication.ingredient_list) && nextMedication.ingredient_list.length > 0 ? {} : Array.isArray(resolution.ingredient_list) ? {
                ingredient_list: resolution.ingredient_list.map((item) => this.normalizeWhitespace(item)).filter(Boolean).slice(0, 6),
              } : {}),
              ...(this.normalizeWhitespace(nextMedication.dosage_form) ? {} : this.normalizeWhitespace(resolution.dosage_form) ? { dosage_form: this.normalizeWhitespace(resolution.dosage_form) } : {}),
              ...(this.normalizeWhitespace(nextMedication.strength) ? {} : this.normalizeWhitespace(resolution.strength) ? { strength: this.normalizeWhitespace(resolution.strength) } : {}),
              resolver_confidence: typeof resolution.confidence === "number" ? resolution.confidence : 0,
            };
          }
        } catch (_error) {}
      }

      if (verifier && nextMedication.name) {
        try {
          const verified = await verifier.verifyMedication(nextMedication, context.geminiApiKey);
          if (verified?.corrected) {
            nextMedication = {
              ...nextMedication,
              ...verified.corrected,
            };
          }
        } catch (_error) {}
      }

      enriched.push(nextMedication);
    }

    if (normalized.length > enriched.length) {
      enriched.push(...normalized.slice(enriched.length));
    }

    return enriched;
  }

  async finalizeDraft(rawDraft = {}, context = {}) {
    const sanitizedDraft = this.sanitizeDraft(rawDraft);
    return {
      ...sanitizedDraft,
      medications: await this.enrichMedications(sanitizedDraft.medications, context),
    };
  }

  async execute(context = {}) {
    const { transcript = "", gemmaClient, geminiClient } = context;
    const normalizedTranscript = this.normalizeWhitespace(transcript);
    if (!normalizedTranscript) {
      return {
        success: false,
        step: "live_conversation_draft_extractor",
        error: "Transcript is required",
      };
    }

    const prompt = this.buildPrompt({ transcript: normalizedTranscript });

    try {
      let lastError = null;

      if (gemmaClient?.execute) {
        const gemmaResult = await this.executeJsonWithClient(gemmaClient, prompt, {
          temperature: 0.2,
          maxTokens: 2048,
        });
        if (gemmaResult.success) {
          return {
            success: true,
            step: "live_conversation_draft_extractor",
            provider: "gemma",
            data: await this.finalizeDraft(gemmaResult.data, context),
            usage: gemmaResult.usage,
          };
        }
        lastError = gemmaResult.error || lastError;
      }

      if (geminiClient?.execute) {
        const geminiResult = await this.executeJsonWithClient(geminiClient, prompt, {
          temperature: 0.2,
          maxTokens: 1600,
          responseMimeType: "application/json",
          thinkingBudget: 128,
          systemInstruction: "You extract structured clinical data from medical transcripts. Return exactly one compact JSON object, do not add markdown, and keep unsupported fields empty.",
        });
        if (geminiResult.success) {
          return {
            success: true,
            step: "live_conversation_draft_extractor",
            provider: "gemini",
            data: await this.finalizeDraft(geminiResult.data, context),
            usage: geminiResult.usage,
          };
        }

        return {
          success: false,
          step: "live_conversation_draft_extractor",
          error: geminiResult.error || lastError || "Gemini extraction failed",
        };
      }

      return {
        success: false,
        step: "live_conversation_draft_extractor",
        error: lastError || "No LLM client available",
      };
    } catch (error) {
      return {
        success: false,
        step: "live_conversation_draft_extractor",
        error: error.message,
      };
    }
  }
}

module.exports = LiveConversationDraftExtractorSkill;
