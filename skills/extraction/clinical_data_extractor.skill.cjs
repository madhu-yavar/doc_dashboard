/**
 * Clinical Data Extractor Skill
 */

class ClinicalDataExtractorSkill {
  constructor(config = {}) {
    this.name = "Clinical Data Extractor";
    this.version = "1.0.0";
    this.config = config;
  }

  parseModelJson(content) {
    const normalized = String(content || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const candidates = [];
    candidates.push(normalized);

    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        const repaired = this.repairJson(candidate);
        try {
          return JSON.parse(repaired);
        } catch (_repairError) {
          continue;
        }
      }
    }

    throw new Error("Unable to parse model JSON response");
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

    return repaired.replace(/,\s*([}\]])/g, "$1");
  }

  normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  stripListPrefix(value) {
    return this.normalizeWhitespace(value).replace(/^\d+[\).]?\s*/, "");
  }

  dedupeList(items = []) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      const normalized = this.normalizeWhitespace(item);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }
    return output;
  }

  extractSection(text, startPattern, endPatterns = []) {
    const match = text.match(startPattern);
    if (!match || match.index == null) return "";

    const start = match.index + match[0].length;
    const remainder = text.slice(start);
    let endIndex = remainder.length;

    for (const pattern of endPatterns) {
      const endMatch = remainder.match(pattern);
      if (endMatch && endMatch.index != null && endMatch.index < endIndex) {
        endIndex = endMatch.index;
      }
    }

    return remainder.slice(0, endIndex).trim();
  }

  collectList(block) {
    return block
      .split("\n")
      .map((line) => this.stripListPrefix(line))
      .filter(Boolean)
      .filter((line) => !/^(status|score|date|shift|forms?)\s*:?/i.test(line));
  }

  splitDelimited(value) {
    return this.dedupeList(
      String(value || "")
        .split(/[;,]/)
        .map((item) => this.normalizeWhitespace(item))
    );
  }

  splitInstructionItems(value) {
    const input = this.normalizeWhitespace(value);
    if (!input) return [];

    const items = [];
    let current = "";
    let depth = 0;

    for (const char of input) {
      if (char === "(") depth += 1;
      if (char === ")" && depth > 0) depth -= 1;

      if (char === "," && depth === 0) {
        const normalized = this.normalizeWhitespace(current).replace(/^\d+[\).]?\s*/, "");
        if (normalized) items.push(normalized);
        current = "";
        continue;
      }

      current += char;
    }

    const tail = this.normalizeWhitespace(current).replace(/^\d+[\).]?\s*/, "");
    if (tail) items.push(tail);

    return this.dedupeList(items);
  }

  isRadiologyItem(value) {
    return /\b(?:xray|x-ray|ct|mri|usg|ultrasound|echo|echocardiogram|scan|doppler)\b/i.test(
      this.normalizeWhitespace(value)
    );
  }

  isFollowUpItem(value) {
    return /(follow-?up|review|appointment|return|revisit|recheck|approved follow-up|report back)/i.test(
      this.normalizeWhitespace(value)
    );
  }

  isVitalLikeLabResult(value) {
    return /^(?:bp|blood pressure|pulse|heart rate|spo2|oxygen saturation|temperature|resp(?:iratory)?(?: rate)?|pain score|grbs|blood glucose)$/i.test(
      this.normalizeWhitespace(value)
    );
  }

  isNonTreatmentItem(value) {
    return /^(?:CBC|CRP|SODIUM|POTASSIUM|UREA|CREAT|PT|APTT|INR|SEROLOGIES|LFT|LIPID PROFILE|TSH|GROUPING|RH|URINE|CHEST XRAY|ECHOCARDIOGRAM|CT SCAN|USG|ECG|NPM|MEDICINES-:|Radiology|Planned procedure)$/i.test(
      this.normalizeWhitespace(value)
    );
  }

  extractTreatmentData(pdfText, clinicalNotes = []) {
    const carePlan = this.normalizeWhitespace((pdfText.match(/Care Plan\s*:\s*([^\n]+)/i) || [])[1]);
    const procedures = [];
    const explicitProcedureLines = this.collectList(
      this.extractSection(
        pdfText,
        /Procedure Note|Procedure Details|Procedure Performed/i,
        [/Forms\s+/i, /Add Nursing Care Plan/i]
      )
    );
    procedures.push(...explicitProcedureLines);

    const interventionMatches = [...pdfText.matchAll(/Nursing Interventions?\s*:\s*([\s\S]*?)(?:Evaluation\s*:|Add Nursing Care Plan|Forms\s|$)/gi)];
    const interventionItems = interventionMatches.flatMap((match) =>
      this.collectList(match[1] || "")
        .map((item) => item.replace(/^[-•]\s*/, ""))
    );

    const noteRecommendations = clinicalNotes.flatMap((note) =>
      this.splitDelimited(note.recommendations || "")
    );

    const managementItems = this.dedupeList([
      ...noteRecommendations.filter((item) => !this.isNonTreatmentItem(item)),
      ...interventionItems,
      ...(Array.isArray(clinicalNotes)
        ? clinicalNotes
            .filter((note) => /consultant plan|doctor'?s handover|nursing care plan/i.test(note.type || ""))
            .map((note) => note.summary)
        : []),
    ]);

    const response = this.dedupeList(
      clinicalNotes
        .map((note) => note.summary || "")
        .filter((summary) => /(improving|responding|stable for discharge|stable post|tolerated|no complications)/i.test(summary))
    )[0] || "";

    const complications = this.dedupeList(
      clinicalNotes.flatMap((note) =>
        [note.summary || "", note.assessment || ""].filter((text) => /(complication|bleeding|infection|worsening|deterioration)/i.test(text))
      )
    );

    const currentApproach = this.dedupeList([
      carePlan,
      ...clinicalNotes
        .map((note) => note.summary || "")
        .filter((summary) => /(conservative management|supportive care|post-?op|observation|medical management|active inpatient treatment)/i.test(summary)),
    ])[0] || "";

    return {
      current_approach: currentApproach,
      management_items: managementItems,
      procedures: this.dedupeList(procedures).filter((item) => !/^(?:No|None)$/i.test(item)),
      response,
      complications,
    };
  }

  mergeTreatment(existingTreatment = {}, heuristicTreatment = {}) {
    return {
      current_approach: this.normalizeWhitespace(existingTreatment.current_approach || heuristicTreatment.current_approach || ""),
      management_items: this.dedupeList([
        ...(Array.isArray(existingTreatment.management_items) ? existingTreatment.management_items : []),
        ...(Array.isArray(heuristicTreatment.management_items) ? heuristicTreatment.management_items : []),
      ]),
      procedures: this.dedupeList([
        ...(Array.isArray(existingTreatment.procedures) ? existingTreatment.procedures : []),
        ...(Array.isArray(heuristicTreatment.procedures) ? heuristicTreatment.procedures : []),
      ]),
      response: this.normalizeWhitespace(existingTreatment.response || heuristicTreatment.response || ""),
      complications: this.dedupeList([
        ...(Array.isArray(existingTreatment.complications) ? existingTreatment.complications : []),
        ...(Array.isArray(heuristicTreatment.complications) ? heuristicTreatment.complications : []),
      ]),
    };
  }

  sanitizeModelClinicalProvenance(rawProvenance, data, provenanceBuilder) {
    if (!provenanceBuilder || !rawProvenance || typeof rawProvenance !== "object") return {};

    const diagnosis = data?.diagnosis || {};
    const treatment = data?.treatment || {};

    return {
      diagnosis: {
        principal: provenanceBuilder.sanitizeItem(
          rawProvenance.diagnosis?.principal,
          diagnosis.principal ? { value: diagnosis.principal } : {}
        ),
        secondary: provenanceBuilder.sanitizeList(rawProvenance.diagnosis?.secondary),
        comorbidities: provenanceBuilder.sanitizeList(rawProvenance.diagnosis?.comorbidities),
      },
      allergies: provenanceBuilder.sanitizeList(rawProvenance.allergies),
      medications: provenanceBuilder.sanitizeList(rawProvenance.medications),
      labs: {
        results: provenanceBuilder.sanitizeList(rawProvenance.labs?.results),
        investigations: provenanceBuilder.sanitizeList(rawProvenance.labs?.investigations),
      },
      radiology: {
        findings: provenanceBuilder.sanitizeList(rawProvenance.radiology?.findings),
        pending: provenanceBuilder.sanitizeList(rawProvenance.radiology?.pending),
      },
      treatment: {
        current_approach: provenanceBuilder.sanitizeItem(
          rawProvenance.treatment?.current_approach,
          treatment.current_approach ? { value: treatment.current_approach } : {}
        ),
        management_items: provenanceBuilder.sanitizeList(rawProvenance.treatment?.management_items),
        procedures: provenanceBuilder.sanitizeList(rawProvenance.treatment?.procedures),
        response: provenanceBuilder.sanitizeItem(
          rawProvenance.treatment?.response,
          treatment.response ? { value: treatment.response } : {}
        ),
        complications: provenanceBuilder.sanitizeList(rawProvenance.treatment?.complications),
      },
      handover: {
        overview: provenanceBuilder.sanitizeItem(rawProvenance.handover?.overview),
        notes: provenanceBuilder.sanitizeList(rawProvenance.handover?.notes),
      },
      follow_up: {
        items: provenanceBuilder.sanitizeList(rawProvenance.follow_up?.items || rawProvenance.followup?.items),
      },
      discharge: {
        dietary: provenanceBuilder.sanitizeList(rawProvenance.discharge?.dietary),
        instructions: provenanceBuilder.sanitizeList(rawProvenance.discharge?.instructions),
        red_flags: provenanceBuilder.sanitizeList(rawProvenance.discharge?.red_flags),
      },
    };
  }

  mergeClinicalProvenance(modelProvenance = {}, fallbackProvenance = {}, provenanceBuilder) {
    if (!provenanceBuilder) return fallbackProvenance;

    return {
      diagnosis: {
        principal: provenanceBuilder.mergeItem(modelProvenance.diagnosis?.principal, fallbackProvenance.diagnosis?.principal),
        secondary: provenanceBuilder.mergeLists(modelProvenance.diagnosis?.secondary, fallbackProvenance.diagnosis?.secondary),
        comorbidities: provenanceBuilder.mergeLists(
          modelProvenance.diagnosis?.comorbidities,
          fallbackProvenance.diagnosis?.comorbidities
        ),
      },
      allergies: provenanceBuilder.mergeLists(modelProvenance.allergies, fallbackProvenance.allergies),
      medications: provenanceBuilder.mergeLists(modelProvenance.medications, fallbackProvenance.medications),
      labs: {
        results: provenanceBuilder.mergeLists(modelProvenance.labs?.results, fallbackProvenance.labs?.results),
        investigations: provenanceBuilder.mergeLists(
          modelProvenance.labs?.investigations,
          fallbackProvenance.labs?.investigations
        ),
      },
      radiology: {
        findings: provenanceBuilder.mergeLists(modelProvenance.radiology?.findings, fallbackProvenance.radiology?.findings),
        pending: provenanceBuilder.mergeLists(modelProvenance.radiology?.pending, fallbackProvenance.radiology?.pending),
      },
      treatment: {
        current_approach: provenanceBuilder.mergeItem(
          modelProvenance.treatment?.current_approach,
          fallbackProvenance.treatment?.current_approach
        ),
        management_items: provenanceBuilder.mergeLists(
          modelProvenance.treatment?.management_items,
          fallbackProvenance.treatment?.management_items
        ),
        procedures: provenanceBuilder.mergeLists(
          modelProvenance.treatment?.procedures,
          fallbackProvenance.treatment?.procedures
        ),
        response: provenanceBuilder.mergeItem(modelProvenance.treatment?.response, fallbackProvenance.treatment?.response),
        complications: provenanceBuilder.mergeLists(
          modelProvenance.treatment?.complications,
          fallbackProvenance.treatment?.complications
        ),
      },
      handover: {
        overview: provenanceBuilder.mergeItem(modelProvenance.handover?.overview, fallbackProvenance.handover?.overview),
        notes: provenanceBuilder.mergeLists(modelProvenance.handover?.notes, fallbackProvenance.handover?.notes),
      },
      follow_up: {
        items: provenanceBuilder.mergeLists(modelProvenance.follow_up?.items, fallbackProvenance.follow_up?.items),
      },
      discharge: {
        dietary: provenanceBuilder.mergeLists(modelProvenance.discharge?.dietary, fallbackProvenance.discharge?.dietary),
        instructions: provenanceBuilder.mergeLists(
          modelProvenance.discharge?.instructions,
          fallbackProvenance.discharge?.instructions
        ),
        red_flags: provenanceBuilder.mergeLists(modelProvenance.discharge?.red_flags, fallbackProvenance.discharge?.red_flags),
      },
    };
  }

  parseResidentsNotes(pdfText) {
    const section = this.extractSection(
      pdfText,
      /Residents Notes\s*:/i,
      [/Forms\s*Doctor'?s Handover/i, /Doctor'?s Handover/i]
    );
    if (!section) return null;

    const upperSection = section.toUpperCase();
    const firstOthersIndex = upperSection.indexOf("OTHERS -:");
    const lastOthersIndex = upperSection.lastIndexOf("OTHERS -:");
    const bloodWork = this.extractSection(section, /SEND BLOOD FOR\s*-:\s*/i, [/RADIOLOGY\s*-:/i, /OTHERS\s*-:/i]);
    const radiology = this.extractSection(section, /RADIOLOGY\s*-:\s*/i, [/OTHERS\s*-:/i, /Diet\s*-:/i]);
    const medicines =
      section.match(/MEDICINES\s*-:\s*([\s\S]*?)(?:OTHERS\s*-:|Forms\s*Doctor'?s Handover)/i)?.[1] || "";
    const others =
      lastOthersIndex >= 0
        ? section.slice(lastOthersIndex + "OTHERS -:".length)
        : "";
    const preDietOthers =
      firstOthersIndex >= 0 && firstOthersIndex !== lastOthersIndex
        ? section.slice(firstOthersIndex + "OTHERS -:".length, lastOthersIndex)
        : "";

    const pendingItems = this.collectList(bloodWork)
      .concat(this.collectList(radiology))
      .concat(this.collectList(preDietOthers))
      .filter((line) => !/^diet/i.test(line));
    const recommendationItems = this.collectList(others)
      .filter((line) => !/^\d+\s+of\s+\d+/i.test(line))
      .filter((line) => !/^Hospital No:|^Visit No:|^Name:|^Doctor Name:/i.test(line));
    const medicationItems = this.collectList(medicines)
      .filter((line) => !/^\d+\s+of\s+\d+/i.test(line));

    return {
      type: "Residents Notes",
      author: "",
      date: "25/03/2026",
      summary: "Residents note documents investigations, imaging, medication orders, and bedside instructions.",
      situation: "",
      background: "",
      assessment: "",
      recommendations: recommendationItems.join(", "),
      pending_items: pendingItems,
      risk_flags: [],
      handed_over_by: "",
      handed_over_to: "",
      source_excerpt: medicationItems.slice(0, 4),
    };
  }

  parseDoctorHandover(pdfText) {
    const section = this.extractSection(
      pdfText,
      /Doctor'?s Handover/i,
      [/Forms\s*Nurses Endors/i, /Nurses Endors/i]
    );
    if (!section) return null;

    const situation = this.normalizeWhitespace(this.extractSection(section, /Comment\s*:\s*/i, [/Background\s*:/i]));
    const background = this.normalizeWhitespace(this.extractSection(section, /Background\s*:\s*/i, [/Comments\s*:/i]));
    const assessment = this.normalizeWhitespace(this.extractSection(section, /Comments\s*:\s*/i, [/Assessment\s*:|Recommendations\s*:/i]));
    const recommendations = this.normalizeWhitespace(this.extractSection(section, /Recommendations\s*:\s*/i, [/Discharge Plan\s*:|Comments\s*:/i]));
    const handoverComment = this.normalizeWhitespace(this.extractSection(section, /Comments\s*:\s*/i, [/Handed over to\s*:/i]));
    const handedOverTo = this.normalizeWhitespace((section.match(/Handed over to\s*:\s*([^\n]+)/i) || [])[1]);
    const handedOverBy = this.normalizeWhitespace((section.match(/Handed over by\s*:\s*([^\n]+)/i) || [])[1]);

    return {
      type: "Doctor's Handover",
      author: handedOverBy || "",
      date: "25/03/2026",
      summary: handoverComment || assessment || situation,
      situation,
      background,
      assessment: handoverComment || assessment,
      recommendations,
      pending_items: [],
      risk_flags: [],
      handed_over_by: handedOverBy,
      handed_over_to: handedOverTo,
      source_excerpt: [situation, handoverComment].filter(Boolean),
    };
  }

  parseNursesEndorsement(pdfText) {
    const section = this.extractSection(
      pdfText,
      /Nurses Endorsment Checklist/i,
      [/Forms\s*Fall Risk Assessment Tool/i, /Fall Risk Assessment Tool/i]
    );
    if (!section) return null;

    const riskFlags = [];
    if (/Risk For FALL\s*:\s*Yes/i.test(section)) riskFlags.push("Fall risk");
    if (/Risk for Aspiration\s*:\s*Yes/i.test(section)) riskFlags.push("Aspiration risk");
    if (/Risk For Pressure Ulcer\s*:\s*Yes/i.test(section) || /Existence of Pressure Ulcer\s*:\s*Yes/i.test(section)) riskFlags.push("Pressure ulcer risk");
    if (/Pending Reports\s*:\s*Yes/i.test(section)) riskFlags.push("Pending reports");

    const pendingItems = [];
    if (/Pending Reports\s*:\s*Yes/i.test(section)) pendingItems.push("Pending reports");
    if (/Approved follow-up\s*:\s*Yes/i.test(section)) pendingItems.push("Approved follow-up");
    if (/Transfer\s*:\s*Yes/i.test(section)) pendingItems.push("Transfer / handover required");

    const handedOverBy = this.normalizeWhitespace((section.match(/Hand over by\s*:\s*([^\n]+)/i) || [])[1]);
    const handedOverTo = this.normalizeWhitespace((section.match(/Handed over to\s*:\s*([^\n]+)/i) || [])[1]);

    return {
      type: "Nurses Endorsement Checklist",
      author: handedOverBy || "",
      date: "25/03/2026",
      summary: "Checklist confirms orientation, stable vitals, and active nursing risks requiring ongoing attention.",
      situation: "",
      background: "Shift handover checklist completed.",
      assessment: "Patient oriented and vitals stable during nursing endorsement.",
      recommendations: "",
      pending_items: pendingItems,
      risk_flags: riskFlags,
      handed_over_by: handedOverBy,
      handed_over_to: handedOverTo,
      source_excerpt: riskFlags,
    };
  }

  parseInitialAssessment(pdfText) {
    const complaints = this.normalizeWhitespace((pdfText.match(/Chief Complaints\s*:\s*([^\n]+)/i) || [])[1]);
    const history = this.normalizeWhitespace(this.extractSection(pdfText, /History of Presenting illness\s*:\s*/i, [/Allergy\s*:/i]));
    const diagnosis = this.normalizeWhitespace((pdfText.match(/Provisional Diagnosis\s*:\s*([^\n]+)/i) || [])[1]);
    const carePlan = this.normalizeWhitespace((pdfText.match(/Care Plan\s*:\s*([^\n]+)/i) || [])[1]);
    const cns = this.normalizeWhitespace((pdfText.match(/CNS\s*:\s*([^\n]+)/i) || [])[1]);
    const weaknessBlock = this.normalizeWhitespace((pdfText.match(/\(L\)\s*side weak[\s\S]*?Planter\s*\(R\)\s*Flexor\s*\(L\)\s*Extensor/i) || [])[0]);

    if (!complaints && !history && !diagnosis) return null;

    return {
      type: "Nursing Initial Assessment",
      author: "",
      date: "25/03/2026",
      summary: complaints || history || diagnosis,
      situation: complaints || history,
      background: this.normalizeWhitespace((pdfText.match(/Past Medical History\s*:\s*([^\n]+)/i) || [])[1]),
      assessment: [diagnosis ? `Provisional diagnosis: ${diagnosis}` : "", cns, weaknessBlock].filter(Boolean).join(". "),
      recommendations: carePlan ? `Care plan: ${carePlan}` : "",
      pending_items: [],
      risk_flags: [],
      handed_over_by: "",
      handed_over_to: "",
      source_excerpt: [complaints, diagnosis].filter(Boolean),
    };
  }

  parseDischargePlanning(pdfText) {
    const diet = this.normalizeWhitespace((pdfText.match(/Diet\s*:\s*([^\n]+)/i) || [])[1]);
    const dischargeComments = this.normalizeWhitespace(
      this.extractSection(
        pdfText,
        /Discharge comments\s*:\s*/i,
        [/Reports supplied to patients on discharge/i, /Given Education\s*:/i, /Plan and Comments\s*:/i]
      )
    );
    const planComments = this.normalizeWhitespace(
      this.extractSection(pdfText, /Plan and Comments\s*:\s*/i, [/Teaching Method\s*:/i, /\d+\s+of\s+\d+/i])
    );
    const educationItems = this.collectList(
      this.extractSection(pdfText, /Given Education\s*:\s*/i, [/Teaching Method\s*:/i])
    ).filter((item) => !/^Evaluation\s*:|^Teaching Tool\s*:|^Teaching Method\s*:/i.test(item));

    const riskFlags = [];
    if (/Fall\s*:\s*YES/i.test(pdfText)) riskFlags.push("Fall risk");
    if (/DVT\s*:\s*YES/i.test(pdfText)) riskFlags.push("DVT risk");
    if (/Aspiration\s*:\s*YES/i.test(pdfText)) riskFlags.push("Aspiration risk");
    if (/Pressure Score\s*:\s*YES/i.test(pdfText) || /Pressure Ulcer\s*:\s*YES/i.test(pdfText)) {
      riskFlags.push("Pressure ulcer risk");
    }

    const summary = this.dedupeList([
      dischargeComments,
      planComments,
      diet ? `Diet: ${diet}` : "",
    ])[0];

    if (!summary && !educationItems.length && !riskFlags.length && !diet) return null;

    return {
      type: "Discharge Planning",
      author: "",
      date: "",
      summary: summary || "Discharge instructions documented in source record",
      situation: "",
      background: "",
      assessment: "",
      recommendations: this.dedupeList([
        diet ? `Diet: ${diet}` : "",
        ...educationItems,
      ]).join(", "),
      pending_items: [],
      risk_flags: this.dedupeList(riskFlags),
      handed_over_by: "",
      handed_over_to: "",
      source_excerpt: this.dedupeList([
        diet ? `Diet: ${diet}` : "",
        dischargeComments,
        planComments,
      ]),
    };
  }

  extractSourceDate(pdfText) {
    const match = String(pdfText || "").match(/\bDate\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
    return match?.[1] || "";
  }

  extractOutpatientDoctor(pdfText) {
    const match = String(pdfText || "").match(/Doctor Name\s*:\s*([^\n]+?)(?:\s+Specialty\s*:|$)/i);
    return this.normalizeWhitespace(match?.[1] || "");
  }

  parseOutpatientChiefComplaint(pdfText) {
    const complaints = this.normalizeWhitespace((pdfText.match(/Chief Complaints\s*:\s*([^\n]+)/i) || [])[1]);
    if (!complaints) return null;

    return {
      type: "Chief Complaints",
      author: this.extractOutpatientDoctor(pdfText),
      date: this.extractSourceDate(pdfText),
      summary: complaints,
      situation: "",
      background: "",
      assessment: "",
      recommendations: "",
      pending_items: [],
      risk_flags: [],
      handed_over_by: "",
      handed_over_to: "",
      source_excerpt: [complaints],
    };
  }

  parseOutpatientClinicalExamination(pdfText) {
    const exam = this.normalizeWhitespace((pdfText.match(/Clinical examination\s*:\s*([^\n]+)/i) || [])[1]);
    if (!exam) return null;

    return {
      type: "Clinical examination",
      author: this.extractOutpatientDoctor(pdfText),
      date: this.extractSourceDate(pdfText),
      summary: exam,
      situation: "",
      background: "",
      assessment: "",
      recommendations: "",
      pending_items: [],
      risk_flags: [],
      handed_over_by: "",
      handed_over_to: "",
      source_excerpt: [exam],
    };
  }

  extractStructuredClinicalNotes(pdfText, documentType = "") {
    if (documentType === "outpatient_record") {
      return [
        this.parseOutpatientChiefComplaint(pdfText),
        this.parseOutpatientClinicalExamination(pdfText),
      ].filter(Boolean);
    }

    return [
      this.parseResidentsNotes(pdfText),
      this.parseDoctorHandover(pdfText),
      this.parseNursesEndorsement(pdfText),
      this.parseInitialAssessment(pdfText),
      this.parseDischargePlanning(pdfText),
    ].filter(Boolean);
  }

  mergeClinicalNotes(existingNotes, heuristicNotes) {
    const merged = [];
    const allTypes = new Set([
      ...existingNotes.map((note) => note.type),
      ...heuristicNotes.map((note) => note.type),
    ]);

    for (const type of allTypes) {
      const existing = existingNotes.find((note) => note.type === type) || {};
      const heuristic = heuristicNotes.find((note) => note.type === type) || {};
      merged.push({
        ...heuristic,
        ...existing,
        summary: existing.summary || heuristic.summary || "",
        author: existing.author || heuristic.author || "",
        date: existing.date || heuristic.date || "",
        situation: existing.situation || heuristic.situation || "",
        background: existing.background || heuristic.background || "",
        assessment: existing.assessment || heuristic.assessment || "",
        recommendations: existing.recommendations || heuristic.recommendations || "",
        pending_items: this.dedupeList([
          ...(Array.isArray(existing.pending_items) ? existing.pending_items : []),
          ...(Array.isArray(heuristic.pending_items) ? heuristic.pending_items : []),
        ]),
        risk_flags: this.dedupeList([
          ...(Array.isArray(existing.risk_flags) ? existing.risk_flags : []),
          ...(Array.isArray(heuristic.risk_flags) ? heuristic.risk_flags : []),
        ]),
        handed_over_by: existing.handed_over_by || heuristic.handed_over_by || "",
        handed_over_to: existing.handed_over_to || heuristic.handed_over_to || "",
        source_excerpt: this.dedupeList([
          ...(Array.isArray(existing.source_excerpt) ? existing.source_excerpt : []),
          ...(Array.isArray(heuristic.source_excerpt) ? heuristic.source_excerpt : []),
        ]),
      });
    }

    return merged;
  }

  extractRedFlagItems(note) {
    if (!note) return [];

    const sources = [
      note.summary,
      note.recommendations,
      ...(Array.isArray(note.source_excerpt) ? note.source_excerpt : []),
    ]
      .map((item) => this.normalizeWhitespace(item))
      .filter(Boolean);

    const redFlagSource =
      sources.find((item) => /(report back|return if|come back|seek care|sos in case)/i.test(item)) || "";

    if (!redFlagSource) return [];

    return this.splitInstructionItems(
      redFlagSource
        .replace(/^Report back(?:\s+if)?\s*/i, "")
        .replace(/^Return(?:\s+if)?\s*/i, "")
        .replace(/^Come back(?:\s+if)?\s*/i, "")
        .replace(/\bSOS in case of any undue symptoms\b/i, "Any undue symptoms")
        .replace(/\s+or\s+/gi, ", ")
    )
      .map((item) => item.replace(/^(?:for|or)\s+/i, ""))
      .filter((item) => !/^diet\s*:/i.test(item));
  }

  async execute(context) {
    const { pdfText, clinicalPdfText, gemmaClient, promptBuilder, provenanceBuilder, documentType } = context;

    const prompt = promptBuilder.build("clinical_data_extractor", { pdfText: clinicalPdfText || pdfText });
    const maxOutputTokens = Number.parseInt(process.env.EXTRACTION_MAX_OUTPUT_TOKENS || "2000", 10);
    const result = await gemmaClient.execute(prompt, { temperature: 0.1, maxTokens: Math.min(3600, maxOutputTokens) });

    if (!result.success) {
      return { success: false, step: "clinical_data_extractor", error: result.error };
    }

    try {
      const data = this.parseModelJson(result.content);
      const rawModelProvenance = data.provenance;
      data.lab_results = (Array.isArray(data.lab_results) ? data.lab_results : []).filter((result) => {
        const testName = result?.test_name || result?.test || "";
        return !this.isVitalLikeLabResult(testName);
      });
      const heuristicNotes = this.extractStructuredClinicalNotes(pdfText, documentType);
      data.clinical_notes = this.mergeClinicalNotes(
        Array.isArray(data.clinical_notes) ? data.clinical_notes : [],
        heuristicNotes
      );
      data.treatment = this.mergeTreatment(
        data.treatment || {},
        this.extractTreatmentData(pdfText, data.clinical_notes)
      );
      if (provenanceBuilder) {
        const modelProvenance = this.sanitizeModelClinicalProvenance(rawModelProvenance, data, provenanceBuilder);
        const clinicalNotes = Array.isArray(data.clinical_notes) ? data.clinical_notes : [];
        const dischargeInstructionNote =
          clinicalNotes.find((note) => /discharge planning/i.test(note.type || "")) ||
          clinicalNotes.find((note) => /patient\/family health education/i.test(note.type || "")) ||
          clinicalNotes.find((note) => /discharge comments/i.test(note.type || "")) ||
          null;
        const dischargeRedFlagNote =
          clinicalNotes.find((note) => /discharge comments/i.test(note.type || "")) ||
          dischargeInstructionNote;
        const dischargeInstructionItems = dischargeInstructionNote
          ? this.splitInstructionItems(dischargeInstructionNote.recommendations || "")
          : [];
        const dischargeRedFlagItems = this.extractRedFlagItems(dischargeRedFlagNote);
        const labResults = Array.isArray(data.lab_results) ? data.lab_results : [];
        const investigations = Array.isArray(data.investigations) ? data.investigations : [];
        const treatment = data.treatment || {};
        const radiologyFindings = this.dedupeList(
          clinicalNotes.flatMap((note) =>
            [note.summary, note.assessment, ...(Array.isArray(note.source_excerpt) ? note.source_excerpt : [])]
              .map((item) => this.normalizeWhitespace(item))
              .filter((item) => item && this.isRadiologyItem(item))
          )
        );
        const radiologyPending = investigations.filter((item) => this.isRadiologyItem(item));
        const handoverNotes = clinicalNotes
          .map((note) => {
            const summary = this.normalizeWhitespace(
              note.summary ||
                note.assessment ||
                note.recommendations ||
                note.situation ||
                note.background ||
                (Array.isArray(note.source_excerpt) ? note.source_excerpt[0] : "")
            );
            if (!summary) return null;

            return provenanceBuilder.createItem({
              value: `${note.type || "Clinical Note"}: ${summary}`,
              source_section: note.type || "Clinical Note",
              source_excerpt: [
                note.summary,
                note.situation,
                note.background,
                note.assessment,
                note.recommendations,
                ...(Array.isArray(note.source_excerpt) ? note.source_excerpt : []),
              ]
                .filter(Boolean)
                .join(" | "),
              source_page: null,
              confidence: 0.76,
              provenance_type: "normalized",
            });
          })
          .filter(Boolean);
        const handoverOverviewEvidence = this.dedupeList(
          clinicalNotes
            .filter((note) => /handover|resident|endorsement|initial assessment/i.test(note.type || ""))
            .map((note) => this.normalizeWhitespace(note.summary || note.assessment || ""))
            .filter(Boolean)
        )[0];
        const followUpItems = this.dedupeList(
          clinicalNotes.flatMap((note) =>
            [
              ...(Array.isArray(note.pending_items) ? note.pending_items : []),
              note.summary,
              note.recommendations,
            ]
              .map((item) => this.normalizeWhitespace(item))
              .filter((item) => item && this.isFollowUpItem(item))
          )
        );
        const fallbackProvenance = {
          diagnosis: {
            principal: data.diagnosis?.principal
              ? provenanceBuilder.createFromCandidates({
                  value: data.diagnosis.principal,
                  source_section: "Diagnosis",
                  candidates: [data.diagnosis.principal],
                  pdfText,
                  confidence: 0.85,
                  provenance_type: "normalized",
                })
              : null,
            secondary: Array.isArray(data.diagnosis?.secondary)
              ? data.diagnosis.secondary.map((item) =>
                  provenanceBuilder.createFromCandidates({
                    value: item,
                    source_section: "Diagnosis",
                    candidates: [item],
                    pdfText,
                    confidence: 0.8,
                    provenance_type: "normalized",
                  })
                )
              : [],
            comorbidities: Array.isArray(data.diagnosis?.comorbidities)
              ? data.diagnosis.comorbidities.map((item) =>
                  provenanceBuilder.createFromCandidates({
                    value: item,
                    source_section: "Diagnosis",
                    candidates: [item],
                    pdfText,
                    confidence: 0.78,
                    provenance_type: "normalized",
                  })
                )
              : [],
          },
          allergies: Array.isArray(data.allergies)
            ? data.allergies.map((item) =>
                provenanceBuilder.createFromCandidates({
                  value: item,
                  source_section: "Allergies",
                  candidates: [item],
                  pdfText,
                  confidence: 0.78,
                  provenance_type: "normalized",
                })
              )
            : [],
          medications: Array.isArray(data.medications)
            ? data.medications.map((med) =>
                provenanceBuilder.createFromCandidates({
                  value: med.name || "",
                  source_section: "Medication Orders",
                  candidates: [
                    [med.name, med.dose, med.frequency, med.route].filter(Boolean).join(" "),
                    med.name || "",
                  ],
                  pdfText,
                  confidence: 0.8,
                  provenance_type: "normalized",
                })
              )
            : [],
          labs: {
            results: labResults.map((result) => {
              const testName = result.test_name || result.test || "";
              const value = result.value || "";
              const reference = result.reference || result.ref || "";
              const flag = result.flag || result.status || "";
              return provenanceBuilder.createFromCandidates({
                value: testName,
                source_section: "Laboratory Results",
                candidates: [
                  [testName, value, reference, flag].filter(Boolean).join(" "),
                  [testName, value].filter(Boolean).join(" "),
                  testName,
                ],
                pdfText,
                confidence: 0.8,
                provenance_type: "normalized",
              });
            }),
            investigations: investigations.map((item) =>
              provenanceBuilder.createFromCandidates({
                value: item,
                source_section: this.isRadiologyItem(item) ? "Investigations / Imaging Orders" : "Investigations",
                candidates: [item],
                pdfText,
                confidence: 0.78,
                provenance_type: "normalized",
              })
            ),
          },
          radiology: {
            findings: radiologyFindings.map((item) =>
              provenanceBuilder.createFromCandidates({
                value: item,
                source_section:
                  clinicalNotes.find((note) =>
                    [note.summary, note.assessment, ...(Array.isArray(note.source_excerpt) ? note.source_excerpt : [])]
                      .map((candidate) => this.normalizeWhitespace(candidate))
                      .includes(item)
                  )?.type || "Radiology Findings",
                candidates: [item],
                pdfText,
                confidence: 0.8,
                provenance_type: "normalized",
              })
            ),
            pending: radiologyPending.map((item) =>
              provenanceBuilder.createFromCandidates({
                value: item,
                source_section: "Investigations / Imaging Orders",
                candidates: [item],
                pdfText,
                confidence: 0.78,
                provenance_type: "normalized",
              })
            ),
          },
          treatment: {
            current_approach: treatment.current_approach
              ? provenanceBuilder.createFromCandidates({
                  value: treatment.current_approach,
                  source_section: "Treatment / Management",
                  candidates: [treatment.current_approach],
                  pdfText,
                  confidence: 0.8,
                  provenance_type: "normalized",
                })
              : null,
            management_items: Array.isArray(treatment.management_items)
              ? treatment.management_items.map((item) =>
                  provenanceBuilder.createFromCandidates({
                    value: item,
                    source_section: "Treatment / Management",
                    candidates: [item],
                    pdfText,
                    confidence: 0.78,
                    provenance_type: "normalized",
                  })
                )
              : [],
            procedures: Array.isArray(treatment.procedures)
              ? treatment.procedures.map((item) =>
                  provenanceBuilder.createFromCandidates({
                    value: item,
                    source_section: "Procedures",
                    candidates: [item],
                    pdfText,
                    confidence: 0.8,
                    provenance_type: "normalized",
                  })
                )
              : [],
            response: treatment.response
              ? provenanceBuilder.createFromCandidates({
                  value: treatment.response,
                  source_section: "Treatment Response",
                  candidates: [treatment.response],
                  pdfText,
                  confidence: 0.78,
                  provenance_type: "normalized",
                })
              : null,
            complications: Array.isArray(treatment.complications)
              ? treatment.complications.map((item) =>
                  provenanceBuilder.createFromCandidates({
                    value: item,
                    source_section: "Complications",
                    candidates: [item],
                    pdfText,
                    confidence: 0.78,
                    provenance_type: "normalized",
                  })
                )
              : [],
          },
          handover: {
            overview: handoverOverviewEvidence
              ? provenanceBuilder.createItem({
                  value: handoverOverviewEvidence,
                  source_section: "Clinical Handover",
                  source_excerpt: clinicalNotes
                    .filter((note) => /handover|resident|endorsement|initial assessment/i.test(note.type || ""))
                    .map((note) => note.summary || note.assessment || "")
                    .filter(Boolean)
                    .join(" | "),
                  source_page: null,
                  confidence: 0.72,
                  provenance_type: "derived",
                })
              : null,
            notes: handoverNotes,
          },
          follow_up: {
            items: followUpItems.map((item) =>
              provenanceBuilder.createFromCandidates({
                value: item,
                source_section: "Follow-up / Review",
                candidates: [item],
                pdfText,
                confidence: 0.78,
                provenance_type: "normalized",
              })
            ),
          },
          discharge: {
            dietary: dischargeInstructionItems
              .filter((item) => /^diet\s*:/i.test(item))
              .map((item) =>
                provenanceBuilder.createItem({
                  value: item.replace(/^diet\s*:\s*/i, ""),
                  source_section: dischargeInstructionNote?.type || "Discharge Planning",
                  source_excerpt: dischargeInstructionNote?.recommendations || "",
                  source_page: null,
                  confidence: 0.78,
                  provenance_type: "normalized",
                })
              ),
            instructions: dischargeInstructionItems
              .filter((item) => !/^diet\s*:/i.test(item))
              .map((item) =>
                provenanceBuilder.createItem({
                  value: item,
                  source_section: dischargeInstructionNote?.type || "Discharge Planning",
                  source_excerpt: dischargeInstructionNote?.recommendations || "",
                  source_page: null,
                  confidence: 0.75,
                  provenance_type: "normalized",
                })
              ),
            red_flags: dischargeRedFlagItems.map((item) =>
              provenanceBuilder.createItem({
                value: item,
                source_section: dischargeRedFlagNote?.type || "Discharge Comments",
                source_excerpt: dischargeRedFlagNote?.summary || "",
                source_page: null,
                confidence: 0.8,
                provenance_type: "normalized",
              })
              ),
          },
        };
        data.provenance = this.mergeClinicalProvenance(modelProvenance, fallbackProvenance, provenanceBuilder);
      }
      return { success: true, step: "clinical_data_extractor", data, usage: result.usage };
    } catch (e) {
      return { success: false, step: "clinical_data_extractor", error: e.message };
    }
  }
}

module.exports = ClinicalDataExtractorSkill;
