/**
 * EXPERIMENT RUNNER
 * Compares Option A (Single-Shot) vs Option B (Thinking/ReAct)
 * Runs both methods on 5 PDF samples and generates comparison report
 */

const fs = require("fs");
const path = require("path");
const { processOptionA } = require("./optionA_extraction.cjs");
const { processOptionB } = require("./optionB_extraction.cjs");

// 5 Sample PDFs - different complexities and departments
const PDF_SAMPLES = [
  {
    name: "Summary1 - Simple (Ear Pain)",
    path: "/Users/yavar/Documents/CoE/Manipal/data/Custom.MEXX.Report.ZEN.DischargeSummary1.cls.pdf",
    expected: {
      patient: "Hema VAISHANAV",
      diagnosis: "B/L EAR PAIN",
      complexity: "Simple"
    }
  },
  {
    name: "Summary2 - Complex (Breathing Difficulty, Multiple Risks)",
    path: "/Users/yavar/Documents/CoE/Manipal/data/Custom.MEXX.Report.ZEN.DischargeSummary2.cls.pdf",
    expected: {
      patient: "DR SHIVARAJ K S",
      diagnosis: "Breathing Difficulty",
      risk_scores: { fall: 10, dvt: 5, pressure: 13 },
      complexity: "Complex"
    }
  },
  {
    name: "Summary3 - Cardiology (Chest Pain)",
    path: "/Users/yavar/Documents/CoE/Manipal/data/Custom.MEXX.Report.ZEN.DischargeSummary3.cls.pdf",
    expected: {
      patient: "Priyadarshini PUNJA",
      diagnosis: "Chest Pain",
      complexity: "Medium"
    }
  },
  {
    name: "Summary4 - Pediatrics (Adenotonsillitis)",
    path: "/Users/yavar/Documents/CoE/Manipal/data/Custom.MEXX.Report.ZEN.DischargeSummary4.cls.pdf",
    expected: {
      patient: "Zohra Rumani",
      diagnosis: "ADENOTONSILLITIS",
      complexity: "Medium"
    }
  },
  {
    name: "Summary5 - Complex Case",
    path: "/Users/yavar/Documents/CoE/Manipal/data/Custom.MEXX.Report.ZEN.DischargeSummary5.cls.pdf",
    expected: {
      complexity: "Unknown"
    }
  }
];

// Scoring rubric
const SCORING = {
  patient_name: 10,
  mrn: 5,
  vitals_complete: 15,
  risk_scores_complete: 20,
  risk_scores_accurate: 15,
  functional_status: 10,
  diagnosis_complete: 10,
  allergies: 5,
  medications: 5,
  clinical_reasoning: 5,
  max_score: 100
};

function scoreExtraction(result, expected) {
  let score = 0;
  let details = {};

  if (!result || !result.data) {
    return { score: 0, details: { error: "No valid data extracted" } };
  }

  const data = result.data;

  // Patient name (10 points)
  if (data.patient?.name?.toLowerCase().includes(expected?.patient?.toLowerCase().split(" ")[0] || "")) {
    score += SCORING.patient_name;
    details.patient_name = `${SCORING.patient_name}/10`;
  } else {
    details.patient_name = `0/${SCORING.patient_name} (got: ${data.patient?.name})`;
  }

  // MRN (5 points)
  if (data.patient?.mrn && data.patient.mrn !== "N/A" && data.patient.mrn !== "") {
    score += SCORING.mrn;
    details.mrn = `${SCORING.mrn}/${SCORING.mrn}`;
  } else {
    details.mrn = `0/${SCORING.mrn}`;
  }

  // Vitals complete (15 points)
  const vitals = data.vitals || {};
  const vitalsFields = [
    vitals.bp?.systolic,
    vitals.pulse,
    vitals.spo2,
    vitals.temperature
  ];
  const vitalsComplete = vitalsFields.filter(v => v !== undefined && v !== null && v !== 0).length;
  details.vitals_complete = `${vitalsComplete}/${vitalsFields.length} fields`;
  score += Math.round((vitalsComplete / vitalsFields.length) * SCORING.vitals_complete);

  // Risk scores complete (20 points)
  const risks = data.risk_scores || {};
  const riskFields = [
    risks.fall_risk?.score,
    risks.dvt_risk?.score,
    risks.pressure_ulcer_risk?.score,
    risks.aspiration_risk?.score,
    risks.ews_score
  ];
  const risksComplete = riskFields.filter(r => r !== undefined && r !== null && r !== 0).length;
  details.risk_scores_complete = `${risksComplete}/${riskFields.length} fields`;
  score += Math.round((risksComplete / riskFields.length) * SCORING.risk_scores_complete);

  // Risk scores accurate (15 points) - compare with expected if available
  if (expected?.risk_scores) {
    let accurateCount = 0;
    if (risks.fall_risk?.score === expected.risk_scores.fall) accurateCount++;
    if (risks.dvt_risk?.score === expected.risk_scores.dvt) accurateCount++;
    if (risks.pressure_ulcer_risk?.score === expected.risk_scores.pressure) accurateCount++;
    details.risk_scores_accurate = `${accurateCount}/3 expected values matched`;
    score += Math.round((accurateCount / 3) * SCORING.risk_scores_accurate);
  } else {
    details.risk_scores_accurate = "N/A (no ground truth)";
    score += Math.round(SCORING.risk_scores_accurate * 0.5); // Partial credit for extraction
  }

  // Functional status (10 points)
  const func = data.functional_status || {};
  const adlFields = [func.bathing, func.dressing, func.eating, func.walking, func.toilet_use];
  const adlComplete = adlFields.filter(f => f && f !== "").length;
  details.functional_status = `${adlComplete}/${adlFields.length} ADL fields`;
  score += Math.round((adlComplete / adlFields.length) * SCORING.functional_status);

  // Diagnosis complete (10 points)
  if (data.diagnosis?.principal && data.diagnosis.principal !== "") {
    score += SCORING.diagnosis_complete;
    details.diagnosis = `${SCORING.diagnosis_complete}/${SCORING.diagnosis_complete}`;
  } else {
    details.diagnosis = `0/${SCORING.diagnosis_complete}`;
  }

  // Allergies (5 points)
  if (data.allergies && data.allergies.length >= 0) {
    score += SCORING.allergies;
    details.allergies = `${SCORING.allergies}/${SCORING.allergies}`;
  } else {
    details.allergies = `0/${SCORING.allergies}`;
  }

  // Medications (5 points)
  if (data.medications && data.medications.length >= 0) {
    score += SCORING.medications;
    details.medications = `${SCORING.medications}/${SCORING.medications}`;
  } else {
    details.medications = `0/${SCORING.medications}`;
  }

  // Clinical reasoning (5 points) - for Option B only
  if (result.method === "Option B (Thinking/ReAct)" && result.data?.validation_summary) {
    score += SCORING.clinical_reasoning;
    details.clinical_reasoning = `${SCORING.clinical_reasoning}/${SCORING.clinical_reasoning}`;
  } else {
    details.clinical_reasoning = "0/5 (N/A for Option A)";
  }

  return { score: Math.min(score, SCORING.max_score), details };
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function runExperiment() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║     EXTRACTION EXPERIMENT: Option A vs Option B              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\n📊 Testing ${PDF_SAMPLES.length} PDF samples...\n`);

  const results = [];
  const outputDir = "/Users/yavar/Documents/CoE/Manipal/doctor_dashboard/scripts/experiment_results";

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < PDF_SAMPLES.length; i++) {
    const sample = PDF_SAMPLES[i];
    console.log(`\n${"=".repeat(70)}`);
    console.log(`SAMPLE ${i + 1}/${PDF_SAMPLES.length}: ${sample.name}`);
    console.log(`${"=".repeat(70)}\n`);

    const sampleResult = {
      sample: sample.name,
      expected: sample.expected,
      optionA: null,
      optionB: null,
      winner: null
    };

    // Run Option A
    try {
      console.log(`\n🔵 Running Option A (Single-Shot)...`);
      const resultA = await processOptionA(sample.path);
      sampleResult.optionA = resultA;
      console.log(`   ⏱️  Latency: ${formatDuration(resultA.latency_ms)}`);
      console.log(`   🪙 Tokens: ${resultA.tokens_used}`);
    } catch (error) {
      console.error(`   ❌ Option A failed: ${error.message}`);
      sampleResult.optionA = { error: error.message };
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Run Option B
    try {
      console.log(`\n🟢 Running Option B (Thinking/ReAct)...`);
      const resultB = await processOptionB(sample.path);
      sampleResult.optionB = resultB;
      console.log(`   ⏱️  Latency: ${formatDuration(resultB.latency_ms)}`);
      console.log(`   🪙 Tokens: ${resultB.tokens_used}`);
    } catch (error) {
      console.error(`   ❌ Option B failed: ${error.message}`);
      sampleResult.optionB = { error: error.message };
    }

    // Score both options
    const scoreA = scoreExtraction(sampleResult.optionA, sample.expected);
    const scoreB = scoreExtraction(sampleResult.optionB, sample.expected);

    sampleResult.optionA.score = scoreA.score;
    sampleResult.optionA.scoreDetails = scoreA.details;
    sampleResult.optionB.score = scoreB.score;
    sampleResult.optionB.scoreDetails = scoreB.details;

    sampleResult.winner = scoreA.score > scoreB.score ? "A" :
                         scoreB.score > scoreA.score ? "B" : "Tie";

    console.log(`\n📊 Score Summary:`);
    console.log(`   Option A: ${scoreA.score}/100`);
    console.log(`   Option B: ${scoreB.score}/100`);
    console.log(`   Winner: Option ${sampleResult.winner}`);

    results.push(sampleResult);

    // Save individual sample result
    fs.writeFileSync(
      path.join(outputDir, `sample_${i + 1}_result.json`),
      JSON.stringify(sampleResult, null, 2)
    );

    // Delay between samples
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Generate summary report
  generateSummaryReport(results, outputDir);

  return results;
}

function generateSummaryReport(results, outputDir) {
  const summary = {
    timestamp: new Date().toISOString(),
    total_samples: results.length,
    overall_winner: null,
    metrics: {
      optionA: {
        total_score: 0,
        total_latency: 0,
        total_tokens: 0,
        successes: 0,
        failures: 0
      },
      optionB: {
        total_score: 0,
        total_latency: 0,
        total_tokens: 0,
        successes: 0,
        failures: 0
      }
    },
    detailed_results: results
  };

  // Calculate aggregates
  results.forEach(r => {
    if (r.optionA && !r.optionA.error) {
      summary.metrics.optionA.total_score += r.optionA.score;
      summary.metrics.optionA.total_latency += r.optionA.latency_ms;
      summary.metrics.optionA.total_tokens += r.optionA.tokens_used;
      summary.metrics.optionA.successes++;
    } else {
      summary.metrics.optionA.failures++;
    }

    if (r.optionB && !r.optionB.error) {
      summary.metrics.optionB.total_score += r.optionB.score;
      summary.metrics.optionB.total_latency += r.optionB.latency_ms;
      summary.metrics.optionB.total_tokens += r.optionB.tokens_used;
      summary.metrics.optionB.successes++;
    } else {
      summary.metrics.optionB.failures++;
    }
  });

  // Determine winner
  if (summary.metrics.optionA.total_score > summary.metrics.optionB.total_score) {
    summary.overall_winner = "Option A (Single-Shot)";
  } else if (summary.metrics.optionB.total_score > summary.metrics.optionA.total_score) {
    summary.overall_winner = "Option B (Thinking/ReAct)";
  } else {
    summary.overall_winner = "Tie";
  }

  // Calculate averages
  summary.metrics.optionA.avg_score = summary.metrics.optionA.successes > 0 ?
    Math.round(summary.metrics.optionA.total_score / summary.metrics.optionA.successes) : 0;
  summary.metrics.optionB.avg_score = summary.metrics.optionB.successes > 0 ?
    Math.round(summary.metrics.optionB.total_score / summary.metrics.optionB.successes) : 0;

  summary.metrics.optionA.avg_latency = summary.metrics.optionA.successes > 0 ?
    Math.round(summary.metrics.optionA.total_latency / summary.metrics.optionA.successes) : 0;
  summary.metrics.optionB.avg_latency = summary.metrics.optionB.successes > 0 ?
    Math.round(summary.metrics.optionB.total_latency / summary.metrics.optionB.successes) : 0;

  summary.metrics.optionA.avg_tokens = summary.metrics.optionA.successes > 0 ?
    Math.round(summary.metrics.optionA.total_tokens / summary.metrics.optionA.successes) : 0;
  summary.metrics.optionB.avg_tokens = summary.metrics.optionB.successes > 0 ?
    Math.round(summary.metrics.optionB.total_tokens / summary.metrics.optionB.successes) : 0;

  // Print report
  console.log("\n\n");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    EXPERIMENT SUMMARY                         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  console.log(`\n🏆 Overall Winner: ${summary.overall_winner}\n`);

  console.log("┌─────────────────────┬──────────────────┬──────────────────┐");
  console.log("│ Metric              │ Option A         │ Option B         │");
  console.log("├─────────────────────┼──────────────────┼──────────────────┤");
  console.log(`│ Avg Score           │ ${summary.metrics.optionA.avg_score}/100           │ ${summary.metrics.optionB.avg_score}/100           │`);
  console.log(`│ Avg Latency         │ ${formatDuration(summary.metrics.optionA.avg_latency).padEnd(16)}│ ${formatDuration(summary.metrics.optionB.avg_latency).padEnd(16)}│`);
  console.log(`│ Avg Tokens          │ ${summary.metrics.optionA.avg_tokens.toString().padEnd(16)}│ ${summary.metrics.optionB.avg_tokens.toString().padEnd(16)}│`);
  console.log(`│ Success Rate        │ ${summary.metrics.optionA.successes}/${results.length}           │ ${summary.metrics.optionB.successes}/${results.length}           │`);
  console.log("└─────────────────────┴──────────────────┴──────────────────┘");

  // Detailed breakdown by sample
  console.log("\n📋 Detailed Results:");
  console.log("┌──────┬──────────────────────────────────┬─────────┬─────────┬────────┐");
  console.log("│ #   │ Sample Name                       │ Score A │ Score B │ Winner │");
  console.log("├──────┼──────────────────────────────────┼─────────┼─────────┼────────┤");
  results.forEach((r, i) => {
    const name = (r.sample.substring(0, 32)).padEnd(32);
    const scoreA = (r.optionA?.score ?? 0).toString().padEnd(8);
    const scoreB = (r.optionB?.score ?? 0).toString().padEnd(8);
    const winner = (r.winner || "?").toString().padEnd(6);
    console.log(`│ ${i + 1} │ ${name} │ ${scoreA} │ ${scoreB} │ ${winner}│`);
  });
  console.log("└──────┴──────────────────────────────────┴─────────┴─────────┴────────┘");

  // Save summary to file
  fs.writeFileSync(
    path.join(outputDir, "experiment_summary.json"),
    JSON.stringify(summary, null, 2)
  );

  console.log(`\n💾 Full results saved to: ${outputDir}`);
  console.log(`   - experiment_summary.json`);
  console.log(`   - sample_1_result.json through sample_${results.length}_result.json`);

  return summary;
}

// Run the experiment
runExperiment()
  .then(() => {
    console.log("\n✅ Experiment completed successfully!");
  })
  .catch(error => {
    console.error("\n❌ Experiment failed:", error);
  });
