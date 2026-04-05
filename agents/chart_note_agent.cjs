/**
 * Chart Note Agent (ReAct-Style with Thinking)
 * Multi-step chart note generation with explicit reasoning for each SOAP section
 */

const GemmaClientTool = require("../tools/llm/gemma_client.tool.cjs");
const PromptBuilderTool = require("../tools/llm/prompt_builder.tool.cjs");

class ChartNoteAgent {
  constructor(config = {}) {
    this.name = "Chart Note Agent (ReAct)";
    this.version = "1.0.0";
    this.type = "reasoning_agent";

    this.gemmaClient = new GemmaClientTool(config.gemma || {});
    this.promptBuilder = new PromptBuilderTool(config);

    this.config = {
      temperature: 0.3,
      maxTokensPerStep: 1500,
      timeoutPerStep: 60000,
      logSteps: true,
      ...config
    };
  }

  /**
   * Generate chart note with ReAct-style reasoning
   * @param {object} context - { extractedData, pdfText, citationData, validationSummary }
   * @param {function} onProgress - Progress callback
   * @returns {Promise<object>}
   */
  async execute(context, onProgress = null) {
    const { extractedData, pdfText, citationData, validationSummary } = context;

    console.log("\n🤖 Chart Note Agent (ReAct-Style) starting...");

    // Data quality validation
    const dataQuality = this.validateExtractedData(extractedData);
    console.log("📊 Data Quality Assessment:", dataQuality);

    const startTime = Date.now();
    const reasoningSteps = [];
    let totalTokens = 0;

    try {
      // STEP 1: Analyze the clinical picture (THINK)
      console.log("\n📝 Step 1: Analyzing clinical picture...");
      const analysisStep = await this.thinkAboutClinicalPicture(extractedData, pdfText);
      reasoningSteps.push({ step: "clinical_analysis", ...analysisStep });
      totalTokens += analysisStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "analysis", status: "complete", data: analysisStep });

      // STEP 2: Determine SOAP structure (THINK)
      console.log("📝 Step 2: Determining SOAP structure...");
      const structureStep = await this.thinkAboutSOAPStructure(extractedData, analysisStep.insights);
      reasoningSteps.push({ step: "soap_structure", ...structureStep });
      totalTokens += structureStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "structure", status: "complete", data: structureStep });

      // STEP 3: Generate Subjective section (THINK + WRITE)
      console.log("📝 Step 3: Generating Subjective (S) section...");
      const subjectiveStep = await this.generateSubjective(extractedData, structureStep.subjective);
      reasoningSteps.push({ step: "subjective", ...subjectiveStep });
      totalTokens += subjectiveStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "subjective", status: "complete" });

      // STEP 4: Generate Objective section (THINK + WRITE)
      console.log("📝 Step 4: Generating Objective (O) section...");
      const objectiveStep = await this.generateObjective(extractedData, structureStep.objective);
      reasoningSteps.push({ step: "objective", ...objectiveStep });
      totalTokens += objectiveStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "objective", status: "complete" });

      // STEP 5: Generate Assessment section (THINK + WRITE)
      console.log("📝 Step 5: Generating Assessment (A) section...");
      const assessmentStep = await this.generateAssessment(extractedData, structureStep.assessment);
      reasoningSteps.push({ step: "assessment", ...assessmentStep });
      totalTokens += assessmentStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "assessment", status: "complete" });

      // STEP 6: Generate Plan section (THINK + WRITE)
      console.log("📝 Step 6: Generating Plan (P) section...");
      const planStep = await this.generatePlan(extractedData, structureStep.plan);
      reasoningSteps.push({ step: "plan", ...planStep });
      totalTokens += planStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "plan", status: "complete" });

      // STEP 7: Review and refine (THINK)
      console.log("📝 Step 7: Reviewing and refining chart note...");
      const reviewStep = await this.reviewAndRefine({
        subjective: subjectiveStep.content,
        objective: objectiveStep.content,
        assessment: assessmentStep.content,
        plan: planStep.content,
        validationSummary
      });
      reasoningSteps.push({ step: "review", ...reviewStep });
      totalTokens += reviewStep.usage?.totalTokens || 0;

      if (onProgress) onProgress({ step: "review", status: "complete" });

      // Compile final chart note
      const finalChartNote = this.compileChartNote({
        subjective: reviewStep.refined?.subjective || subjectiveStep.content,
        objective: reviewStep.refined?.objective || objectiveStep.content,
        assessment: reviewStep.refined?.assessment || assessmentStep.content,
        plan: reviewStep.refined?.plan || planStep.content,
        extractedData,
        validationSummary
      });

      const elapsed = Date.now() - startTime;
      console.log(`\n✅ Chart note generated in ${elapsed}ms | Tokens: ${totalTokens}`);

      return {
        success: true,
        step: "chart_note_agent",
        data: {
          chart_note: finalChartNote,
          reasoning_steps: reasoningSteps,
          metadata: {
            generated_at: new Date().toISOString(),
            total_tokens: totalTokens,
            generation_time_ms: elapsed,
            agent_type: "react",
            steps_completed: reasoningSteps.length
          }
        },
        usage: { totalTokens }
      };

    } catch (error) {
      console.error("❌ Chart Note Agent error:", error.message);
      return {
        success: false,
        step: "chart_note_agent",
        error: error.message,
        reasoning_steps
      };
    }
  }

  /**
   * STEP 1: Think about the clinical picture
   */
  async thinkAboutClinicalPicture(extractedData, pdfText) {
    const prompt = `You are an expert clinician analyzing a patient's hospital stay.

EXTRACTED DATA:
${JSON.stringify(extractedData, null, 2)}

${pdfText ? `SOURCE DOCUMENT (first 3000 chars):\n${pdfText.substring(0, 3000)}` : ''}

Think through this step-by-step:

1. What is the primary reason for admission?
2. What are the key clinical events during the stay?
3. What is the patient's current condition at discharge?
4. What are the most important data points to document?

Provide your analysis in the following format:

THOUGHT: [Your clinical reasoning]
KEY_FINDINGS: [Bullet list of 5-7 key findings]
PATIENT_STATUS: [Stable/Guarded/Critical and why]
COMPLEXITY: [Low/Medium/High and why]`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.3,
      maxTokens: 1000
    });

    if (!result.success) {
      return { insights: "Analysis failed", usage: {} };
    }

    // Parse the response
    const content = result.content;
    return {
      insights: content,
      thought: this.extractSection(content, "THOUGHT"),
      keyFindings: this.extractSection(content, "KEY_FINDINGS"),
      patientStatus: this.extractSection(content, "PATIENT_STATUS"),
      complexity: this.extractSection(content, "COMPLEXITY"),
      usage: result.usage
    };
  }

  /**
   * STEP 2: Think about SOAP structure
   */
  async thinkAboutSOAPStructure(extractedData, analysis) {
    const prompt = `Based on the clinical analysis, determine what goes into each SOAP section.

CLINICAL ANALYSIS:
${analysis}

EXTRACTED DATA SUMMARY:
- Diagnosis: ${JSON.stringify(extractedData.diagnosis || {})}
- Vitals: ${JSON.stringify(extractedData.vitals || {})}
- Medications: ${extractedData.medications?.length || 0} medications
- Labs: ${extractedData.lab_results?.length || 0} results
- Risk Scores: ${JSON.stringify(extractedData.risk_scores || {})}

For each SOAP section, list what MUST be included:

SUBJECTIVE - Must include:
- [List key subjective elements]

OBJECTIVE - Must include:
- [List key objective elements]

ASSESSMENT - Must include:
- [List key assessment elements]

PLAN - Must include:
- [List key plan elements]

Focus on what's clinically most important for this specific patient.`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.3,
      maxTokens: 800
    });

    const content = result.success ? result.content : "";

    console.log("  📋 SOAP structure determined:", {
      subjective: this.extractSection(content, "SUBJECTIVE")?.substring(0, 50) || "N/A",
      objective: this.extractSection(content, "OBJECTIVE")?.substring(0, 50) || "N/A",
      assessment: this.extractSection(content, "ASSESSMENT")?.substring(0, 50) || "N/A",
      plan: this.extractSection(content, "PLAN")?.substring(0, 50) || "N/A"
    });

    return {
      subjective: this.extractSection(content, "SUBJECTIVE") || "History and symptoms",
      objective: this.extractSection(content, "OBJECTIVE") || "Clinical findings",
      assessment: this.extractSection(content, "ASSESSMENT") || "Clinical impression",
      plan: this.extractSection(content, "PLAN") || "Discharge planning",
      structure: content,
      usage: result.usage
    };
  }

  /**
   * STEP 3: Generate Subjective section
   */
  async generateSubjective(extractedData, requirements) {
    const prompt = `Generate the SUBJECTIVE section of a discharge chart note.

Patient Data:
${JSON.stringify(extractedData, null, 2)}

REQUIREMENTS: ${requirements}

Write a detailed SUBJECTIVE section that includes:
- Chief complaint and reason for admission
- Present illness narrative in chronological order
- Patient's reported symptoms and progression
- Relevant past medical history
- Patient's perspective and concerns

The section should be 3-5 sentences, clinically detailed, and written as the attending physician would document it.

Format:
THOUGHT: [Your reasoning for what to include in subjective]
SUBJECTIVE SECTION:
[The actual content]`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.4,
      maxTokens: 1000
    });

    const content = result.success ? result.content : "";
    const sectionContent = this.extractAfter(content, "SUBJECTIVE SECTION");

    console.log("  📝 Subjective section generated:", {
      length: sectionContent?.length || 0,
      preview: sectionContent?.substring(0, 100) || "N/A"
    });

    return {
      thought: this.extractSection(content, "THOUGHT"),
      content: sectionContent,
      usage: result.usage
    };
  }

  /**
   * STEP 4: Generate Objective section
   */
  async generateObjective(extractedData, requirements) {
    const vitals = extractedData.vitals || {};
    const labs = extractedData.lab_results?.slice(0, 5) || [];
    const risks = extractedData.risk_scores || {};
    const functional = extractedData.functional_status || {};

    const prompt = `Generate the OBJECTIVE section of a discharge chart note.

VITALS AT DISCHARGE:
${JSON.stringify(vitals, null, 2)}

KEY LAB RESULTS:
${JSON.stringify(labs, null, 2)}

RISK ASSESSMENT:
${JSON.stringify(risks, null, 2)}

FUNCTIONAL STATUS:
${JSON.stringify(functional, null, 2)}

REQUIREMENTS: ${requirements}

Write a detailed OBJECTIVE section that includes:
- Vital signs with actual values
- Pertinent physical exam findings
- Abnormal lab values with reference ranges
- Risk assessment scores with interpretation
- Functional status and ADL assessment

Format:
THOUGHT: [Your reasoning for objective data selection]
OBJECTIVE SECTION:
[The actual content with specific values and interpretations]`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.3,
      maxTokens: 1200
    });

    const content = result.success ? result.content : "";
    const sectionContent = this.extractAfter(content, "OBJECTIVE SECTION");

    console.log("  📝 Objective section generated:", {
      length: sectionContent?.length || 0,
      preview: sectionContent?.substring(0, 100) || "N/A"
    });

    return {
      thought: this.extractSection(content, "THOUGHT"),
      content: sectionContent,
      usage: result.usage
    };
  }

  /**
   * STEP 5: Generate Assessment section
   */
  async generateAssessment(extractedData, requirements) {
    const diagnosis = extractedData.diagnosis || {};
    const treatment = extractedData.treatment || {};
    const response = extractedData.response_to_treatment || "";

    const prompt = `Generate the ASSESSMENT section of a discharge chart note.

DIAGNOSIS:
${JSON.stringify(diagnosis, null, 2)}

TREATMENT GIVEN:
${JSON.stringify(treatment, null, 2)}

RESPONSE: ${response}

REQUIREMENTS: ${requirements}

Write a comprehensive ASSESSMENT section that includes:
- Principal diagnosis with clinical reasoning
- Secondary diagnoses/comorbidities
- Clinical judgment on patient's condition
- Response to treatment during stay
- Prognosis and severity classification
- Discharge disposition rationale

Format:
THOUGHT: [Your clinical reasoning and synthesis]
ASSESSMENT SECTION:
[The actual content with clinical judgment]`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.4,
      maxTokens: 1000
    });

    const content = result.success ? result.content : "";
    const sectionContent = this.extractAfter(content, "ASSESSMENT SECTION");

    console.log("  📝 Assessment section generated:", {
      length: sectionContent?.length || 0,
      preview: sectionContent?.substring(0, 100) || "N/A"
    });

    return {
      thought: this.extractSection(content, "THOUGHT"),
      content: sectionContent,
      usage: result.usage
    };
  }

  /**
   * STEP 6: Generate Plan section
   */
  async generatePlan(extractedData, requirements) {
    const medications = extractedData.medications || [];
    const dischargeMeds = extractedData.discharge_medications || medications;
    const education = extractedData.patient_education || [];
    const followUp = extractedData.follow_up || {};

    const prompt = `Generate the PLAN (Discharge Planning) section of a chart note.

DISCHARGE MEDICATIONS (${dischargeMeds.length}):
${JSON.stringify(dischargeMeds.slice(0, 10), null, 2)}

PATIENT EDUCATION:
${JSON.stringify(education, null, 2)}

FOLLOW-UP:
${JSON.stringify(followUp, null, 2)}

REQUIREMENTS: ${requirements}

Write a comprehensive PLAN section that includes:
- Organized medication list with doses, frequency, route
- Activity restrictions and mobility requirements
- Dietary instructions
- Patient education topics covered
- Red flags and warning signs
- Follow-up arrangements (specialty, timing)
- Home health/services arranged

Format:
THOUGHT: [Your reasoning for discharge planning]
PLAN SECTION:
[The actual content with specific arrangements]`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.3,
      maxTokens: 1200
    });

    const content = result.success ? result.content : "";
    const sectionContent = this.extractAfter(content, "PLAN SECTION");

    console.log("  📝 Plan section generated:", {
      length: sectionContent?.length || 0,
      preview: sectionContent?.substring(0, 100) || "N/A"
    });

    return {
      thought: this.extractSection(content, "THOUGHT"),
      content: sectionContent,
      usage: result.usage
    };
  }

  /**
   * STEP 7: Review and refine
   */
  async reviewAndRefine(sections) {
    const prompt = `Review the following chart note for quality, completeness, and clinical accuracy.

SUBJECTIVE:
${sections.subjective}

OBJECTIVE:
${sections.objective}

ASSESSMENT:
${sections.assessment}

PLAN:
${sections.plan}

Validation: ${sections.validationSummary}

Review each section and provide:
1. Quality assessment (Excellent/Good/Fair/Poor)
2. Missing elements (if any)
3. Suggestions for improvement (if needed)

IMPORTANT: Return the review ONLY. Do NOT include refined versions in your response.
Format your response as:

REVIEW:
SUBJECTIVE: [Quality rating and brief feedback]
OBJECTIVE: [Quality rating and brief feedback]
ASSESSMENT: [Quality rating and brief feedback]
PLAN: [Quality rating and brief feedback]`;

    const result = await this.gemmaClient.execute(prompt, {
      temperature: 0.3,
      maxTokens: 1000
    });

    const content = result.success ? result.content : "";

    // Don't do refinements - just return the review
    // The original sections are already well-formatted
    const refined = {
      subjective: null,
      objective: null,
      assessment: null,
      plan: null
    };

    console.log("  📝 Review completed:", {
      reviewLength: content.length,
      preview: content.substring(0, 200)
    });

    return {
      review: content,
      refined: refined,
      usage: result.usage
    };
  }

  /**
   * Compile final chart note
   */
  compileChartNote(sections) {
    const patient = sections.extractedData.patient || {};
    const admission = sections.extractedData.admission || {};

    // Ensure sections have content, provide fallback if empty
    const subjective = sections.subjective?.trim() || this.generateFallbackSubjective(sections.extractedData);
    const objective = sections.objective?.trim() || this.generateFallbackObjective(sections.extractedData);
    const assessment = sections.assessment?.trim() || this.generateFallbackAssessment(sections.extractedData);
    const plan = sections.plan?.trim() || this.generateFallbackPlan(sections.extractedData);

    console.log("  📋 Final chart note compiled:", {
      totalLength: subjective.length + objective.length + assessment.length + plan.length,
      sections: {
        subjective: subjective.length || 0,
        objective: objective.length || 0,
        assessment: assessment.length || 0,
        plan: plan.length || 0
      }
    });

    const finalNote = `DISCHARGE SUMMARY CHART NOTE

Patient: ${patient.name || 'Not documented'} | MRN: ${patient.mrn || 'N/A'} | Age: ${patient.age || 'N/A'} ${patient.gender || ''}
Admission: ${admission.admission_date || 'Not documented'} | Discharge: ${admission.discharge_date || 'Not documented'}

SUBJECTIVE - HISTORY & PRESENTATION
${subjective}

OBJECTIVE - CLINICAL FINDINGS
${objective}

ASSESSMENT - DIAGNOSIS & CLINICAL JUDGMENT
${assessment}

PLAN - DISCHARGE PLAN & RECOMMENDATIONS
${plan}

_________________________
Generated: ${new Date().toLocaleString()}
Note: This chart note was automatically generated from the discharge summary document. Clinician review and signature required.
Validation Summary: ${sections.validationSummary}`;

    return finalNote;
  }

  /**
   * Fallback generators for when LLM doesn't return content
   */
  generateFallbackSubjective(data) {
    const diagnosis = data.diagnosis?.principal || "Not documented";
    const patient = data.patient || {};
    return `Patient is a ${patient.age || 'XX'}-year-old ${patient.gender || 'individual'} admitted with ${diagnosis}.`;
  }

  generateFallbackObjective(data) {
    const vitals = data.vitals || data.latest || {};
    const risks = data.risk_scores || {};
    let content = "Vital Signs: ";
    if (vitals.bp) content += `BP ${vitals.bp.systolic || 'N/A'}/${vitals.bp.diastolic || 'N/A'} mmHg `;
    if (vitals.pulse) content += `Pulse ${vitals.pulse.value || vitals.pulse || 'N/A'} bpm `;
    if (vitals.spo2) content += `SpO2 ${vitals.spo2.value || vitals.spo2 || 'N/A'}%`;
    if (risks.fall_risk) content += `\nFall Risk: ${risks.fall_risk.score || 'N/A'} (${risks.fall_risk.level || 'N/A'})`;
    return content || "Clinical findings not available.";
  }

  generateFallbackAssessment(data) {
    const diagnosis = data.diagnosis?.principal || "Not documented";
    const secondary = data.diagnosis?.secondary?.length > 0
      ? data.diagnosis.secondary.slice(0, 3).join(", ")
      : "None documented";
    return `Principal Diagnosis: ${diagnosis}\nSecondary Diagnoses: ${secondary}`;
  }

  generateFallbackPlan(data) {
    const meds = data.medications || [];
    let content = "Discharge Medications:\n";
    if (meds.length > 0) {
      meds.slice(0, 5).forEach(med => {
        content += `- ${med.name || med} ${med.dose || ''} ${med.frequency || ''} ${med.route || ''}\n`;
      });
    } else {
      content += "No medications documented.\n";
    }
    return content;
  }

  /**
   * Helper: Extract a section from formatted response
   */
  extractSection(content, sectionName) {
    const regex = new RegExp(sectionName + ":?\\s*([\\s\\S]*?)(?=\\n[A-Z]|$)", "i");
    const match = content.match(regex);
    return match ? match[1].trim() : "";
  }

  /**
   * Helper: Extract content after a marker
   */
  extractAfter(content, marker) {
    const index = content.indexOf(marker);
    if (index === -1) {
      // Marker not found - try to extract meaningful content
      console.log(`    ⚠️ Marker "${marker}" not found, attempting fallback extraction`);
      // Return content after THOUGHT section if it exists
      const thoughtIndex = content.indexOf("THOUGHT:");
      if (thoughtIndex !== -1) {
        const afterThought = content.substring(thoughtIndex + 8).trim();
        // Find the next line after THOUGHT content
        const lines = afterThought.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() && !lines[i].startsWith('THOUGHT')) {
            // Found actual content
            return lines.slice(i).join('\n').trim();
          }
        }
      }
      return content;
    }
    const extracted = content.substring(index + marker.length).trim();
    if (!extracted) {
      console.log(`    ⚠️ Empty content after marker "${marker}"`);
      return content; // Fallback to full content
    }
    // Remove any remaining section markers that might appear after
    const lines = extracted.split('\n');
    const cleaned = [];
    for (const line of lines) {
      // Stop if we hit another major section marker
      if (line.match(/^(OBJECTIVE|ASSESSMENT|PLAN|REVIEW):/i)) break;
      cleaned.push(line);
    }
    return cleaned.join('\n').trim();
  }

  /**
   * Helper: Extract refinement content
   */
  extractRefinement(content, prefix) {
    const regex = new RegExp(prefix + "\\s*([\\s\\S]*?)(?=\\n[A-Z]:|$)", "i");
    const match = content.match(regex);
    const extracted = match ? match[1].trim() : "";
    return extracted === "OK" ? null : extracted;
  }

  /**
   * Validate extracted data quality before chartnote generation
   */
  validateExtractedData(extractedData) {
    const issues = [];
    const warnings = [];
    const score = { total: 0, max: 0 };

    // Check critical fields
    const checks = [
      {
        path: ["patient", "name"],
        name: "Patient Name",
        critical: true,
        found: !!this.getNestedValue(extractedData, ["patient", "name"])
      },
      {
        path: ["patient", "age"],
        name: "Patient Age",
        critical: true,
        found: !!this.getNestedValue(extractedData, ["patient", "age"])
      },
      {
        path: ["diagnosis", "principal"],
        name: "Principal Diagnosis",
        critical: true,
        found: !!this.getNestedValue(extractedData, ["diagnosis", "principal"])
      },
      {
        path: ["vitals"],
        name: "Vital Signs",
        critical: false,
        found: !!(extractedData?.vitals && Object.keys(extractedData.vitals).length > 0)
      },
      {
        path: ["medications"],
        name: "Medications",
        critical: false,
        found: !!(extractedData?.medications && extractedData.medications.length > 0)
      },
      {
        path: ["risk_scores"],
        name: "Risk Scores",
        critical: false,
        found: !!(extractedData?.risk_scores && Object.keys(extractedData.risk_scores).length > 0)
      },
      {
        path: ["lab_results"],
        name: "Lab Results",
        critical: false,
        found: !!(extractedData?.lab_results && extractedData.lab_results.length > 0)
      },
      {
        path: ["functional_status"],
        name: "Functional Status",
        critical: false,
        found: !!extractedData?.functional_status
      },
      {
        path: ["clinical_notes"],
        name: "Clinical Notes",
        critical: false,
        found: !!(extractedData?.clinical_notes && extractedData.clinical_notes.length > 0)
      }
    ];

    checks.forEach(check => {
      score.max += check.critical ? 20 : 10;
      if (check.found) {
        score.total += check.critical ? 20 : 10;
      } else if (check.critical) {
        issues.push(`Missing: ${check.name}`);
      } else {
        warnings.push(`Not found: ${check.name}`);
      }
    });

    const qualityPercentage = Math.round((score.total / score.max) * 100);
    let qualityLevel = "Poor";
    if (qualityPercentage >= 80) qualityLevel = "Good";
    else if (qualityPercentage >= 60) qualityLevel = "Fair";

    return {
      quality: qualityLevel,
      percentage: qualityPercentage,
      score: score.total,
      maxScore: score.max,
      issues,
      warnings,
      hasCriticalIssues: issues.length > 0
    };
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    let current = obj;
    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    return current;
  }
}

module.exports = ChartNoteAgent;
