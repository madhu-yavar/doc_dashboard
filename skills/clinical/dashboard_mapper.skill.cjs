/**
 * Dashboard Mapper Skill
 * Transforms extracted clinical data into dashboard card format
 */
const DashboardPresentationAgent = require("../../agents/dashboard_presentation_agent.cjs");
const SectionStatusResolverTool = require("../../tools/presentation/section_status_resolver.tool.cjs");
const {
  applyActivationMetadata,
  getCardActivation,
  DOCUMENT_TYPES
} = require("./dashboard_card_activation_config.cjs");

// Add voice document type
const DOCUMENT_TYPES_WITH_VOICE = {
  ...DOCUMENT_TYPES,
  VOICE: 'voice'
};

class DashboardMapperSkill {
  constructor(config = {}) {
    this.name = "Dashboard Mapper";
    this.version = "1.0.0";
    this.config = config;
    this.presentationAgent = new DashboardPresentationAgent(config);
    this.sectionStatusResolver = new SectionStatusResolverTool(config);
  }

  /**
   * Execute the skill - transforms agent data to dashboard format
   * @param {object} context - { agentResult }
   * @returns {Promise<object>}
   */
  async execute(context) {
    const { agentResult } = context;

    if (!agentResult || !agentResult.data) {
      return {
        success: false,
        error: "No agent data provided"
      };
    }

    const data = agentResult.data;
    const validation = agentResult.validation || {};

    // Build dashboard cards from extracted data
    const dashboardCards = this.buildDashboardCards(data, validation);

    // Get document type for activation
    let documentType = data.meta?.document_type ||
                      data.meta?.router?.detected_type ||
                      data.document_type;

    // Check for voice documents
    if (data.meta?.source_type === 'voice_transcript' ||
        data.meta?.source_type === 'voice' ||
        data.document_type === 'voice') {
      documentType = DOCUMENT_TYPES_WITH_VOICE.VOICE;
    }

    // Fallback to default
    if (!documentType) {
      documentType = DOCUMENT_TYPES.PRESCRIPTION;
    }

    // Apply activation metadata based on document type
    const activatedCards = applyActivationMetadata(dashboardCards, documentType);

    // Build sample patient data
    const samplePatientData = this.buildSamplePatientData(data);

    const presentationInput = this.buildPresentationInput(data, activatedCards, samplePatientData);
    const presentationResult = await this.presentationAgent.execute({ dashboardData: presentationInput });

    return {
      success: true,
      step: "dashboard_mapper",
      data: {
        dashboard_cards: activatedCards,
        sample_patient_data: samplePatientData,
        presentation: presentationResult.success ? presentationResult.data : { summary_cards: {}, notes_rail: [] }
      }
    };
  }

  buildPresentationInput(data, dashboardCards, samplePatientData) {
    const provenance = data.provenance || {};
    const labResults = Array.isArray(data.lab_results) ? data.lab_results : [];
    const investigations = Array.isArray(data.investigations) ? data.investigations : [];
    const nuclearStudies = Array.isArray(data.nuclear_medicine) ? data.nuclear_medicine : [];
    const clinicalNotes = Array.isArray(data.clinical_notes) ? data.clinical_notes : [];
    const treatment = data.treatment || {};
    const procedures = Array.isArray(data.procedures) ? data.procedures : [];
    const radiologyStudies = Array.isArray(data.radiology) ? data.radiology : [];
    const followUpAppointments = this.normalizeFollowUpAppointments(data.follow_up);

    const buildStatus = (items, allowedTypes) => this.sectionStatusResolver.build(items, allowedTypes);

    return {
      vitals: {
        latest: {
          bloodPressure: {
            systolic: this.getVitalNumericValue(data.vitals?.latest?.bp?.systolic ?? data.vitals?.bp?.systolic),
            diastolic: this.getVitalNumericValue(data.vitals?.latest?.bp?.diastolic ?? data.vitals?.bp?.diastolic),
          },
          heartRate: { value: this.getVitalNumericValue(data.vitals?.latest?.pulse?.value ?? data.vitals?.pulse?.value) },
          spo2: { value: this.getVitalNumericValue(data.vitals?.latest?.spo2?.value ?? data.vitals?.spo2?.value) },
          temperature: { value: this.getVitalNumericValue(data.vitals?.latest?.temperature?.value ?? data.vitals?.temperature?.value) },
          weight: {
            value: this.getVitalNumericValue(data.vitals?.latest?.weight?.value ?? data.vitals?.weight?.value),
            unit: data.vitals?.latest?.weight?.unit || data.vitals?.weight?.unit || "",
          },
          respiratoryRate: {
            value: this.getVitalNumericValue(
              data.vitals?.latest?.resp_rate?.value ??
              data.vitals?.latest?.resp_rate ??
              data.vitals?.resp_rate?.value ??
              data.vitals?.resp_rate
            )
          },
        },
        status: dashboardCards.vitals_card?.status || "stable",
      },
      diagnosis: {
        principal: {
          description: this.getDiagnosisLabel(data.diagnosis?.principal),
          code: data.diagnosis?.icd_code || data.diagnosis?.principal?.icd_code || "",
        },
        secondary: this.normalizeDiagnosisList(data.diagnosis?.secondary).map((description) => ({ description })),
      },
      medications: {
        active: Array.isArray(dashboardCards.medications_card?.medication_list)
          ? dashboardCards.medications_card.medication_list
          : [],
        allergies: Array.isArray(data.allergies) ? data.allergies.map((allergen) => ({ allergen })) : [],
      },
      labs: {
        totalTests: dashboardCards.labs_card?.total_tests || 0,
        hasResults: labResults.length > 0,
        abnormalCount: dashboardCards.labs_card?.abnormal_count || 0,
        criticalCount: dashboardCards.labs_card?.critical_count || 0,
        pendingCount: labResults.length > 0 ? 0 : investigations.length,
        investigations: investigations,
        nuclearStudies: nuclearStudies,
      },
      radiology: {
        completedStudies: dashboardCards.radiology_card?.studies_completed || 0,
        pendingStudies: Array.isArray(provenance.radiology?.pending) ? provenance.radiology.pending.length : 0,
        criticalFindings: dashboardCards.radiology_card?.critical_findings || 0,
        studies: radiologyStudies,
      },
      treatment: {
        activeManagement: [
          ...(Array.isArray(treatment.management_items)
            ? treatment.management_items.map((item) => ({ title: item, details: item, source: "Source record" }))
            : []),
          ...procedures
            .map((procedure) => {
              const name = typeof procedure === "string" ? procedure : procedure?.name;
              if (!name) return null;
              return {
                title: "Procedure / order",
                details: name,
                source: "Prescription extraction",
              };
            })
            .filter(Boolean),
        ],
        procedures: procedures,
        currentApproach:
          treatment.current_approach ||
          dashboardCards.treatment_card?.current_approach ||
          (procedures.length > 0 ? `Ordered procedures: ${procedures.map((procedure) => typeof procedure === "string" ? procedure : procedure?.name).filter(Boolean).slice(0, 3).join(", ")}` : ""),
        complications: Array.isArray(treatment.complications) ? treatment.complications.length : 0,
        complicationsLabel: Array.isArray(treatment.complications) && treatment.complications.length
          ? treatment.complications.join(", ")
          : "Not documented",
      },
      clinicalNotes: {
        notes: clinicalNotes.map((note) => ({
          type: note.type || "Clinical Note",
          author: note.author || "",
          date: note.date || "",
          summary: note.summary || "",
          assessment: note.assessment || "",
          recommendations: note.recommendations || "",
          situation: note.situation || "",
          background: note.background || "",
          risk_flags: Array.isArray(note.risk_flags) ? note.risk_flags : [],
          pending_items: Array.isArray(note.pending_items) ? note.pending_items : [],
          handed_over_by: note.handed_over_by || "",
          handed_over_to: note.handed_over_to || "",
          source_excerpt: Array.isArray(note.source_excerpt) ? note.source_excerpt : [],
          source_type: note.source_type || "unknown",
          is_synthetic: Boolean(note.is_synthetic),
          page_number: note.page_number ?? null,
          confidence: note.confidence || "medium",
          confidence_reason: note.confidence_reason || "",
          is_inferred: Boolean(note.is_inferred),
        })),
      },
      followUp: followUpAppointments,
      provenance: {
        sections: {
          vitals: buildStatus(
            [
              provenance.vitals?.systolic,
              provenance.vitals?.diastolic,
              provenance.vitals?.pulse,
              provenance.vitals?.spo2,
              provenance.vitals?.temperature,
              provenance.vitals?.respiratory_rate,
            ],
            ["quoted", "normalized"]
          ),
          diagnosis: buildStatus(
            [provenance.diagnosis?.principal, ...(provenance.diagnosis?.secondary || [])],
            ["quoted", "normalized"]
          ),
          medications: buildStatus(provenance.medications || [], ["quoted", "normalized"]),
          labs: buildStatus(
            [...(provenance.labs?.results || []), ...(provenance.labs?.investigations || [])],
            ["quoted", "normalized"]
          ),
          radiology: buildStatus(
            [...(provenance.radiology?.findings || []), ...(provenance.radiology?.pending || [])],
            ["quoted", "normalized"]
          ),
          treatment: buildStatus(
            [
              provenance.treatment?.current_approach,
              ...(provenance.treatment?.management_items || []),
              ...(provenance.treatment?.procedures || []),
              provenance.treatment?.response,
              ...(provenance.treatment?.complications || []),
            ],
            ["quoted", "normalized", "derived"]
          ),
          handover: buildStatus(
            [provenance.handover?.overview, ...(provenance.handover?.notes || [])],
            ["quoted", "normalized", "derived"]
          ),
          followup: buildStatus(provenance.follow_up?.items || [], ["quoted", "normalized"]),
          discharge: buildStatus(
            [
              ...(provenance.discharge?.dietary || []),
              ...(provenance.discharge?.instructions || []),
              ...(provenance.discharge?.red_flags || []),
            ],
            ["quoted", "normalized"]
          ),
        },
      },
    };
  }

  /**
   * Build dashboard cards from extracted clinical data
   */
  buildDashboardCards(data, validation) {
    const patient = data.patient || {};
    const vitals = data.vitals || {};
    const riskScores = data.risk_scores || {};
    const clinical = data.diagnosis || {};
    const medications = data.medications || [];
    const allergies = data.allergies || [];
    const clinicalNotes = Array.isArray(data.clinical_notes) ? data.clinical_notes : [];
    const treatment = data.treatment || {};

    // Vitals Card - Include readings and reference ranges for trend graphs
    const vitalsCard = {
      icon: "📊",
      title: "Vital Signs",
      status: this.determineVitalsStatus(vitals, riskScores),
      summary: {
        latest_bp: this.formatBP(vitals.latest?.bp || vitals.latest?.bloodPressure || vitals.bp),
        pulse: this.getVitalNumericValue(vitals.latest?.pulse?.value ?? vitals.latest?.heartRate?.value),
        temp: this.getVitalNumericValue(vitals.latest?.temperature?.value),
        spo2: this.getVitalNumericValue(vitals.latest?.spo2?.value),
        weight: this.getVitalNumericValue(vitals.latest?.weight?.value ?? vitals.weight?.value)
      },
      trend: this.determineTrend(vitals),
      data_points: vitals.readings?.length || this.countVitalsDataPoints(vitals),
      has_alerts: this.hasVitalsAlerts(vitals),
      // NEW: Include all readings with timestamps for trend graph
      readings: vitals.readings || [],
      // NEW: Reference ranges for comparison
      reference_ranges: vitals.reference_ranges || {
        bp_systolic_normal: "<120",
        bp_diastolic_normal: "<80",
        pulse_normal: "60-100",
        spo2_normal: "≥95%",
        temperature_normal: "97-99°F"
      }
    };

    // Diagnosis Card
    const principalDiagnosis = this.getDiagnosisLabel(clinical.principal);
    const icdCode = clinical.icd_code || clinical.principal?.icd_code || clinical.principal?.code || "";
    const secondaryDiagnoses = this.normalizeDiagnosisList(clinical.secondary);

    const diagnosisCard = {
      icon: "🩺",
      title: "Diagnosis",
      principal_diagnosis: principalDiagnosis,
      icd_code: icdCode,
      secondary_count: secondaryDiagnoses.length,
      secondary_diagnoses: secondaryDiagnoses,
      procedures_count: data.procedures?.length || 0
    };

    // Medications Card - Include actual medication list with dose, frequency, and route
    // Handle prescription-specific metadata
    const medicationsMetadata = data.medications_metadata || {};
    const medicationsCard = {
      icon: "💊",
      title: "Medications",
      active_count: Array.isArray(medications) ? medications.length : 0,
      allergy_count: allergies.length,
      allergies: allergies,
      categories: this.categorizeMedications(medications),
      // Prescription-specific metadata
      unreadable_count: medicationsMetadata.unreadable_count || 0,
      has_unreadable: medicationsMetadata.has_unreadable || false,
      extraction_confidence: medicationsMetadata.confidence || "medium",
      // Include full medication list for display with all fields
      medication_list: Array.isArray(medications) ? medications.map(med => {
        const name = med.name || "";
        const upperName = name.toUpperCase();
        // Determine route from name if not provided
        let route = med.route || "Oral";
        if (upperName.includes("INJ") || upperName.includes("INJECTION")) route = "IV/IM";
        else if (upperName.includes("TAB") || upperName.includes("TABLET") || upperName.includes("CAPSULE")) route = "Oral";
        else if (upperName.includes("SYRUP") || upperName.includes("SUSPENSION")) route = "Oral";
        else if (upperName.includes("OINTMENT") || upperName.includes("CREAM") || upperName.includes("GEL")) route = "Topical";

        // Determine category
        let category = med.category || "Other";
        if (upperName.includes("INSULIN") || upperName.includes("ACTRAPID") || upperName.includes("METFORMIN")) category = "Diabetes";
        else if (upperName.includes("MANNITOL") || upperName.includes("LASIX") || upperName.includes("FUROSEMIDE")) category = "Diuretic";
        else if (upperName.includes("LEVETIRACETAM") || upperName.includes("LEVERA") || upperName.includes("PHENYTOIN")) category = "Antiepileptic";
        else if (upperName.includes("PANTOPRAZOLE") || upperName.includes("PAN") || upperName.includes("OMEPRazole")) category = "PPI/Gastric";
        else if (upperName.includes("ONDANSETRON") || upperName.includes("ZOFER") || upperName.includes("EMESET")) category = "Antiemetic";
        else if (upperName.includes("ASPIRIN") || upperName.includes("CLOPIDOGREL")) category = "Antiplatelet";
        else if (upperName.includes("METOPROLOL") || upperName.includes("ATENOLOL")) category = "Beta Blocker";
        else if (upperName.includes("AMLODIPINE") || upperName.includes("AMILONG")) category = "Calcium Channel Blocker";
        else if (upperName.includes("ATORVASTATIN") || upperName.includes("ROSUVASTATIN")) category = "Statin";
        else if (upperName.includes("RAMIPRIL") || upperName.includes("ENALAPRIL")) category = "ACE Inhibitor";

        // Support both dose (from chart notes) and dosage (from prescriptions)
        const doseValue = med.dose || med.dosage || "As prescribed";
        const instructions = med.instructions || "";

        return {
          name: name,
          dose: doseValue,
          dosage: doseValue, // Include both for compatibility
          frequency: med.frequency || "As prescribed",
          route: route,
          category: category,
          start: "Generated",
          instructions: instructions || "Validate against source document",
          // Track uncertainty for UI display
          is_uncertain: med.is_uncertain || false,
          verification_confidence: med.verification_confidence || med.confidence || "medium",
          verification_uncertain_reason: med.verification_uncertain_reason || med.uncertain_reason || ""
        };
      }) : []
    };

    // Labs Card - Show lab results if available, otherwise show investigations ordered
    const labResults = data.lab_results || [];
    const investigations = data.investigations || [];
    const nuclearMedicine = data.nuclear_medicine?.selected_studies || [];
    const hasLabResults = labResults.length > 0;
    const totalNuclear = nuclearMedicine.length;

    const labsCard = {
      icon: "🔬",
      title: "Laboratory Results",
      total_tests: hasLabResults ? labResults.length : investigations.length + totalNuclear,
      abnormal_count: this.countAbnormalLabResults(labResults),
      critical_count: this.countCriticalLabResults(labResults),
      pending_count: hasLabResults ? 0 : investigations.length + totalNuclear,
      top_abnormal: this.getTopAbnormalLabResult(labResults),
      // Include actual lab results
      lab_results: labResults.map(result => ({
        test: result.test_name || result.test || "Unknown",
        value: result.value || "",
        reference: result.reference || result.ref || "N/A",
        flag: result.flag || result.status || ""
      })),
      // Include investigation list
      investigations_list: investigations,
      // Include nuclear medicine studies
      nuclear_medicine_list: nuclearMedicine.map(study => ({
        test: study.study_name || study.type || "Unknown",
        status: study.status || "ordered",
        is_uncertain: Boolean(study.is_uncertain),
        confidence_reason: study.confidence_reason || ""
      })),
      has_results: hasLabResults,
      note: hasLabResults
        ? `${labResults.length} lab results documented${totalNuclear > 0 ? `, ${totalNuclear} nuclear study${totalNuclear > 1 ? 's' : ''} ordered` : ''}`
        : (investigations.length > 0 || totalNuclear > 0
          ? `${investigations.length} lab${investigations.length === 1 ? '' : 's'}${totalNuclear > 0 ? ` + ${totalNuclear} nuclear study${totalNuclear > 1 ? 's' : ''}` : ''} ordered (results not in document)`
          : "No laboratory data documented")
    };

    // Risk Assessment Card (combines all risk scores)
    const riskCard = {
      icon: "⚠️",
      title: "Risk Assessment",
      fall_risk: this.formatRisk(riskScores.fall_risk),
      dvt_risk: this.formatRisk(riskScores.dvt_risk),
      pressure_ulcer_risk: this.formatRisk(riskScores.pressure_ulcer_risk),
      aspiration_risk: this.formatRisk(riskScores.aspiration_risk),
      ews_score: riskScores.ews_score || 0,
      overall_status: this.determineOverallRiskStatus(riskScores)
    };

    // Radiology Card - use data.radiology for prescription radiology orders
    const radiologyData = data.radiology || [];
    const radiologyCard = {
      icon: "🫀",
      title: "Radiology & Imaging",
      studies_completed: Array.isArray(radiologyData) ? radiologyData.filter(r => r.status === "ordered" || r.status === "completed").length : this.countRadiologyStudies(data.investigations),
      pending_studies: Array.isArray(radiologyData) ? radiologyData.filter(r => r.status === "ordered" || r.status === "not_selected").length : 0,
      critical_findings: 0,
      key_finding: "",
      // Include actual radiology orders
      radiology_list: radiologyData
    };

    // Treatment Card
    const treatmentCard = {
      icon: "🏥",
      title: "Treatment & Procedures",
      procedures_performed: Array.isArray(treatment.procedures) ? treatment.procedures.length : (data.procedures?.length || 0),
      surgeries: 0,
      response: treatment.response || "",
      current_approach:
        treatment.current_approach ||
        ((Array.isArray(treatment.procedures) ? treatment.procedures : data.procedures || [])
          .map((item) => typeof item === "string" ? item : item?.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ")),
      management_items: Array.isArray(treatment.management_items) && treatment.management_items.length > 0
        ? treatment.management_items
        : (Array.isArray(data.procedures) ? data.procedures.map((item) => typeof item === "string" ? item : item?.name).filter(Boolean) : []),
      complications_count: Array.isArray(treatment.complications) ? treatment.complications.length : 0
    };

    // Clinical Notes Card
    const clinicalNotesCard = {
      icon: "📝",
      title: "Clinical Notes",
      total_notes: clinicalNotes.length,
      last_update: clinicalNotes[0]?.date || data.meta?.processed_at || new Date().toISOString(),
      notes: clinicalNotes.map((note) => ({
        type: note.type || "Clinical Note",
        author: note.author || "",
        date: note.date || "",
        summary: note.summary || "",
        situation: note.situation || "",
        background: note.background || "",
        assessment: note.assessment || "",
        recommendations: note.recommendations || "",
        pending_items: Array.isArray(note.pending_items) ? note.pending_items : [],
        risk_flags: Array.isArray(note.risk_flags) ? note.risk_flags : [],
        handed_over_by: note.handed_over_by || "",
        handed_over_to: note.handed_over_to || "",
        source_excerpt: Array.isArray(note.source_excerpt) ? note.source_excerpt : [],
        source_type: note.source_type || "unknown",
        is_synthetic: Boolean(note.is_synthetic),
        page_number: note.page_number ?? null,
        confidence: note.confidence || "medium",
        confidence_reason: note.confidence_reason || "",
        is_inferred: Boolean(note.is_inferred)
      }))
    };

    // Discharge Plan Card
    const dischargePlanCard = {
      icon: "📋",
      title: "Discharge Plan",
      condition: this.determineDischargeCondition(riskScores, vitals),
      instruction_count: data.discharge_instructions?.length || 0,
      red_flags: this.countRedFlags(validation)
    };

    // Follow Up Card
    const followUpAppointments = this.normalizeFollowUpAppointments(data.follow_up);
    const followUpCard = {
      icon: "📅",
      title: "Follow-Up",
      next_appointment: data.follow_up?.next_appointment || this.getFollowUpNextAppointment(followUpAppointments),
      appointment_count: followUpAppointments.length,
      appointments: followUpAppointments
    };

    return {
      vitals_card: vitalsCard,
      diagnosis_card: diagnosisCard,
      medications_card: medicationsCard,
      labs_card: labsCard,
      risk_card: riskCard,
      radiology_card: radiologyCard,
      treatment_card: treatmentCard,
      clinical_notes_card: clinicalNotesCard,
      discharge_plan_card: dischargePlanCard,
      follow_up_card: followUpCard
    };
  }

  /**
   * Build sample patient data
   */
  buildSamplePatientData(data) {
    const patient = data.patient || {};
    const vitals = data.vitals || {};
    const weightValue = this.getVitalNumericValue(vitals.latest?.weight?.value ?? vitals.weight?.value);
    const weightUnit = vitals.latest?.weight?.unit || vitals.weight?.unit || "";

    return {
      name: patient.name || "",
      age: patient.age ?? null,
      gender: patient.gender || "",
      mrn: patient.mrn || patient.hospital_no || "",
      admission_date: patient.admission_date || "",
      discharge_date: patient.discharge_date || "",
      los_days: this.calculateLOS(patient),
      summary: this.generatePatientSummary(data),
      weight: weightValue ? { value: weightValue, unit: weightUnit } : null,
      // Add vitals for UI display
      vitals: {
        latest: {
          bloodPressure: {
            systolic: this.getVitalNumericValue(vitals.latest?.bp?.systolic ?? vitals.bp?.systolic),
            diastolic: this.getVitalNumericValue(vitals.latest?.bp?.diastolic ?? vitals.bp?.diastolic),
          },
          heartRate: { value: this.getVitalNumericValue(vitals.latest?.pulse?.value ?? vitals.pulse?.value) },
          spo2: { value: this.getVitalNumericValue(vitals.latest?.spo2?.value ?? vitals.spo2?.value) },
          temperature: { value: this.getVitalNumericValue(vitals.latest?.temperature?.value ?? vitals.temperature?.value) },
          weight: { value: weightValue, unit: weightUnit },
          respiratoryRate: {
            value: this.getVitalNumericValue(
              vitals.latest?.resp_rate?.value ??
              vitals.latest?.resp_rate ??
              vitals.resp_rate?.value ??
              vitals.resp_rate
            )
          },
          painScore: { value: this.getVitalNumericValue(vitals.latest?.pain_score?.value ?? vitals.pain_score?.value) },
          grbs: { value: this.getVitalNumericValue(vitals.latest?.grbs?.value ?? vitals.grbs?.value) },
        },
        status: this.determineVitalsStatus(vitals, data.risk_scores || {}),
        trend: this.determineTrend(vitals),
        alerts: this.hasVitalsAlerts(vitals) ? ["abnormal"] : [],
      },
    };
  }

  // Helper methods for card data transformation

  getVitalNumericValue(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const match = value.match(/-?\d+(\.\d+)?/);
      if (match) {
        const parsed = Number(match[0]);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      }
    }
    return null;
  }

  getDiagnosisLabel(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.getDiagnosisLabel(item)).filter(Boolean)[0] || "";
    }
    return value.name || value.description || value.code || "";
  }

  normalizeDiagnosisList(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => this.getDiagnosisLabel(item))
      .filter(Boolean);
  }

  normalizeFollowUpAppointments(followUp) {
    const appointments = Array.isArray(followUp?.appointments) ? followUp.appointments : [];
    if (appointments.length > 0) {
      return appointments.map((item) => ({
        department: item.department || item.specialty || "",
        physician: item.physician || "",
        date: item.date || item.timing || "",
        time: item.time || "",
        purpose: item.purpose || item.reason || item.type || "",
      }));
    }

    const items = Array.isArray(followUp?.items)
      ? followUp.items
      : Array.isArray(followUp)
        ? followUp
        : [];

    return items.map((item) => {
      if (typeof item === "string") {
        return {
          department: "",
          physician: "",
          date: "",
          time: "",
          purpose: item,
        };
      }

      return {
        department: item.specialty || item.department || "",
        physician: item.physician || "",
        date: item.date || item.timing || "",
        time: item.time || "",
        purpose: item.reason || item.notes || "",
      };
    });
  }

  getFollowUpNextAppointment(appointments) {
    if (!Array.isArray(appointments) || appointments.length === 0) return "";
    const explicitDate = appointments.find((item) => item.date);
    if (explicitDate?.date) return explicitDate.date;
    return appointments.find((item) => item.purpose)?.purpose || "";
  }

  determineVitalsStatus(vitals, riskScores) {
    if (riskScores.ews_score >= 7) return "critical";
    if (riskScores.ews_score >= 5) return "warning";
    if (this.hasVitalsAlerts(vitals)) return "warning";
    return "stable";
  }

  formatBP(bp) {
    if (!bp) return "";
    if (typeof bp === "object") {
      const systolic = this.getVitalNumericValue(bp.systolic);
      const diastolic = this.getVitalNumericValue(bp.diastolic);
      return systolic && diastolic ? `${systolic}/${diastolic}` : "";
    }
    return bp;
  }

  determineTrend(vitals) {
    // Simple trend logic - could be enhanced with historical data
    if (vitals.bp?.status === "high" || vitals.pulse?.status === "tachycardia") {
      return "deteriorating";
    }
    return "stable";
  }

  countVitalsDataPoints(vitals) {
    let count = 0;
    if (this.getVitalNumericValue(vitals.latest?.bp?.systolic ?? vitals.bp?.systolic)) count++;
    if (this.getVitalNumericValue(vitals.latest?.pulse?.value ?? vitals.pulse?.value)) count++;
    if (this.getVitalNumericValue(vitals.latest?.temperature?.value ?? vitals.temperature?.value)) count++;
    if (this.getVitalNumericValue(vitals.latest?.spo2?.value ?? vitals.spo2?.value)) count++;
    if (this.getVitalNumericValue(vitals.latest?.resp_rate?.value ?? vitals.latest?.resp_rate ?? vitals.resp_rate?.value ?? vitals.resp_rate)) count++;
    return count;
  }

  hasVitalsAlerts(vitals) {
    if (!vitals || vitals.has_vitals === false) return false;
    if (vitals.bp?.status === "high") return true;
    if (vitals.pulse?.status && vitals.pulse.status !== "normal") return true;
    if (vitals.spo2?.status === "low") return true;
    if (vitals.grbs?.interpretation === "diabetic") return true;
    return false;
  }

  categorizeMedications(medications) {
    if (!Array.isArray(medications)) return [];
    const categories = {};
    medications.forEach(med => {
      // Categorize based on medication name
      const name = med.name?.toUpperCase() || "";
      let cat = "Other";

      if (name.includes("INJ") || name.includes("INJECTION")) {
        cat = "Injections";
      } else if (name.includes("TAB") || name.includes("TABLET")) {
        cat = "Tablets";
      } else if (name.includes("IV FLUID") || name.includes("NORMAL SALINE") || name.includes("NS")) {
        cat = "IV Fluids";
      } else if (name.includes("INSULIN") || name.includes("ACTRAPID")) {
        cat = "Diabetes";
      } else if (name.includes("MANNITOL") || name.includes("LASIX")) {
        cat = "Neurology";
      } else if (name.includes("ANTIBIOTIC") || name.includes("-MYCIN") || name.includes("-CILLIN")) {
        cat = "Antibiotics";
      }

      categories[cat] = (categories[cat] || 0) + 1;
    });
    return Object.entries(categories).map(([name, count]) => ({ name, count }));
  }

  countAbnormalLabs(vitals) {
    let count = 0;
    if (vitals.bp?.status !== "normal") count++;
    if (vitals.pulse?.status !== "normal") count++;
    if (vitals.spo2?.status === "low") count++;
    if (vitals.grbs?.interpretation !== "normal") count++;
    return count;
  }

  countAbnormalLabResults(labResults) {
    if (!Array.isArray(labResults)) return 0;
    return labResults.filter(result =>
      result.flag && ['high', 'low', 'abnormal', 'critical', 'h', 'l', 'a', 'c'].includes(result.flag.toLowerCase())
    ).length;
  }

  countCriticalLabResults(labResults) {
    if (!Array.isArray(labResults)) return 0;
    return labResults.filter(result =>
      result.flag && ['critical', 'c', 'panic'].includes(result.flag.toLowerCase())
    ).length;
  }

  getTopAbnormalLabResult(labResults) {
    if (!Array.isArray(labResults) || labResults.length === 0) return "";
    const critical = labResults.find(r =>
      r.flag && ['critical', 'c', 'panic'].includes(r.flag.toLowerCase())
    );
    if (critical) return `${critical.test_name || critical.test}: ${critical.value}`;
    const abnormal = labResults.find(r =>
      r.flag && ['high', 'low', 'abnormal', 'h', 'l', 'a'].includes(r.flag.toLowerCase())
    );
    return abnormal ? `${abnormal.test_name || abnormal.test}: ${abnormal.value}` : "";
  }

  countCriticalLabs(riskScores) {
    let count = 0;
    if (riskScores.ews_score >= 7) count++;
    if (riskScores.fall_risk?.level === "High") count++;
    if (riskScores.aspiration_risk?.level === "High") count++;
    return count;
  }

  getTopAbnormal(vitals) {
    const abnormalities = [];
    if (vitals.bp?.status === "high") abnormalities.push("High BP");
    if (vitals.pulse?.status === "tachycardia") abnormalities.push("Tachycardia");
    if (vitals.spo2?.status === "low") abnormalities.push("Low SpO2");
    return abnormalities[0] || "";
  }

  formatRisk(risk) {
    if (!risk) return { score: 0, level: "Not assessed" };
    return {
      score: risk.score || 0,
      level: risk.level || "Unknown"
    };
  }

  determineOverallRiskStatus(riskScores) {
    const highRisks = [];
    if (riskScores.fall_risk?.level === "High") highRisks.push("Fall");
    if (riskScores.dvt_risk?.level === "High") highRisks.push("DVT");
    if (riskScores.pressure_ulcer_risk?.level === "High") highRisks.push("Pressure Ulcer");
    if (riskScores.aspiration_risk?.level === "High") highRisks.push("Aspiration");

    if (highRisks.length >= 2) return "critical";
    if (highRisks.length === 1) return "warning";
    return "stable";
  }

  countRadiologyStudies(investigations) {
    if (!Array.isArray(investigations)) return 0;
    return investigations.filter(inv =>
      String(inv?.type || inv || "").toLowerCase().includes("xray") ||
      String(inv?.type || inv || "").toLowerCase().includes("ct") ||
      String(inv?.type || inv || "").toLowerCase().includes("mri") ||
      String(inv?.type || inv || "").toLowerCase().includes("ultrasound") ||
      String(inv?.type || inv || "").toLowerCase().includes("usg") ||
      String(inv?.type || inv || "").toLowerCase().includes("echo")
    ).length;
  }

  determineTreatmentResponse(data) {
    const riskScores = data.risk_scores || {};
    if (riskScores.ews_score >= 7) return "Poor";
    if (riskScores.ews_score >= 5) return "Fair";
    return "Good";
  }

  determineDischargeCondition(riskScores, vitals) {
    const overallRisk = this.determineOverallRiskStatus(riskScores);
    if (overallRisk === "critical") return "Unstable";
    if (overallRisk === "warning") return "Stable (with precautions)";
    return "Stable";
  }

  countRedFlags(validation) {
    return (validation.inconsistencies_found || []).length +
           (validation.missing_critical_fields || []).length;
  }

  calculateLOS(patient) {
    if (patient.los_days) return patient.los_days;
    if (patient.admission_date && patient.discharge_date) {
      const adm = new Date(patient.admission_date);
      const dis = new Date(patient.discharge_date);
      return Math.ceil((dis - adm) / (1000 * 60 * 60 * 24));
    }
    return null;
  }

  generatePatientSummary(data) {
    const patient = data.patient || {};
    const diagnosis = data.diagnosis || {};
    const riskScores = data.risk_scores || {};

    const ageRaw = patient.age ?? null;
    const ageNumeric = typeof ageRaw === 'string' ? parseInt(ageRaw, 10) || null : ageRaw;
    const gender = patient.gender || "";
    const principalDiagnosis = this.getDiagnosisLabel(diagnosis.principal);
    const riskLevel = this.determineOverallRiskStatus(riskScores);

    const parts = [];
    if (ageNumeric || gender) {
      const demographic = [ageNumeric ? `${ageNumeric}-year-old` : "", gender].filter(Boolean).join(" ");
      if (demographic) parts.push(demographic);
    }
    if (principalDiagnosis) {
      parts.push(`Diagnosis: ${principalDiagnosis}`);
    }
    if (riskLevel && riskLevel !== "stable") {
      parts.push(`Risk status: ${riskLevel}`);
    }
    parts.push(`Processed via Agent System v${data.meta?.agent_version || "2.0.0"}.`);

    return parts.join(". ");
  }

  /**
   * Map voice-extracted data to dashboard schema
   * Voice data has a different structure than PDF-extracted data
   */
  mapVoiceData(voiceData) {
    if (!voiceData) {
      return null;
    }

    // Voice extraction returns diagnosis.principal as an array, but dashboard expects a single object
    // Convert: diagnosis.principal[0] -> diagnosis.principal object
    const principalDiagnosis = Array.isArray(voiceData.diagnosis?.principal)
      ? voiceData.diagnosis.principal[0] || {}
      : voiceData.diagnosis?.principal || {};

    const principalObj = {
      name: principalDiagnosis.name || principalDiagnosis.description || "",
      code: principalDiagnosis.icd_code || principalDiagnosis.code || "",
      status: principalDiagnosis.status || "active",
      description: principalDiagnosis.name || principalDiagnosis.description || "",
      confirmedDate: principalDiagnosis.confirmedDate || null,
      treatingPhysician: principalDiagnosis.treatingPhysician || null
    };

    const normalizedVoiceData = {
      ...voiceData,
      diagnosis: {
        principal: principalObj.description || principalObj.name || "",
        secondary: voiceData.diagnosis?.secondary || [],
        comorbidities: voiceData.diagnosis?.comorbidities || [],
        icd_code: principalObj.code || ""
      },
      meta: {
        ...voiceData.meta,
        source_type: "voice",
        document_type: "voice_dictation",
        agent_version: this.version,
        processed_at: new Date().toISOString()
      },
      medications: (voiceData.medications || []).map((med) => ({
        name: med.name,
        dose: med.dose,
        frequency: med.frequency,
        route: med.route,
        indication: med.indication,
        status: med.status || "continue",
        provenance: med.provenance
      })),
      lab_results: (voiceData.lab_results || []).map((lab) => ({
        test_name: lab.test_name,
        value: lab.value,
        flag: lab.flag,
        provenance: lab.provenance
      }))
    };

    const dashboardCards = applyActivationMetadata(
      this.buildDashboardCards(normalizedVoiceData, {}),
      DOCUMENT_TYPES.CHART_NOTE
    );

    // Also build and return patient data for voice extraction
    const samplePatientData = this.buildSamplePatientData(normalizedVoiceData);

    return {
      dashboard_cards: dashboardCards,
      sample_patient_data: samplePatientData
    };
  }
}

module.exports = DashboardMapperSkill;
