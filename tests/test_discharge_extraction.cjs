/**
 * Test Script for Discharge Summary Extraction
 * Tests the DischargeExtractorAgent against manually verified ground truth
 */

const path = require('path');
const fs = require('fs');

const DischargeExtractorAgent = require('../agents/discharge_extractor_agent.cjs');

// Ground Truth for Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf
// Manually verified from the PDF document
const GROUND_TRUTH = {
  pdf_file: 'Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf',
  patient: {
    name: 'Amit kumar DUTTA',
    mrn: 'MH018146883',
    age: 51,
    gender: 'Male',
    admission_date: '25-03-2026',
    discharge_date: '01-04-2026',
    los_days: 7,
    uhid: '1000300406',
    bed_no: 'ICU-03'
  },
  diagnosis: {
    principal: '(R) thalamo capsular bleed',
    secondary: ['HTN', 'Type 2 Diabetes Mellitus']
  },
  vitals: {
    bp: { systolic: 160, diastolic: 80 },
    pulse: { value: 78, status: 'normal' },
    spo2: { value: 100, status: 'normal' },
    temperature: { value: 98.4, unit: 'F' },
    resp_rate: 19,
    pain_score: { value: 0, scale: 10 },
    grbs: { value: 112, interpretation: 'prediabetic' }
  },
  risk_scores: {
    fall_risk: { score: 16, level: 'High', scale: 'Morse' },
    dvt_risk: { level: 'High', score: null }, // Document mentions "YES" but no specific score
    pressure_ulcer_risk: { score: 10, level: 'High', scale: 'Braden' },
    aspiration_risk: { score: 6, level: 'High' },
    ews_score: null, // Not present in document
    gcs: { eyes: 4, motor: 6, verbal: 5, total: 15, shorthand: 'E4V5M6' }
  },
  functional_status: {
    bathing: 'Dependent',
    dressing: 'Dependent',
    eating: 'Dependent',
    walking: 'Dependent',
    toilet_use: 'Dependent',
    overall_assistance_needs: 'Complete assistance required',
    mobility_notes: 'Patient is bed bound; (L) side weak with UL 0/5 and LL 2/5'
  },
  allergies: {
    known_allergies: [],
    nkda: true,
    note: 'Document shows "NKF&DA" which means No Known Food & Drug Allergies'
  },
  medications_count: 9,
  key_medications: [
    { name: 'INJ MANNITOL (20%)', dose: '100 ML', frequency: 'IV TDS' },
    { name: 'INJ LASIX', dose: '20MG', frequency: 'IV TDS' },
    { name: 'INJ LEVERA', dose: '500MG', frequency: 'IV BD' },
    { name: 'TAB STAMLO', dose: '5MG', frequency: 'OD & SOS' }
  ]
};

/**
 * Compare extracted data with ground truth
 */
function compareResults(extracted, groundTruth) {
  const results = {
    passed: 0,
    failed: 0,
    partial: 0,
    notTested: 0,
    details: []
  };

  // Test helper functions
  const test = {
    exact: (category, field, extractedValue, expectedValue, description) => {
      const passed = extractedValue === expectedValue;
      results.passed += passed ? 1 : 0;
      results.failed += passed ? 0 : 1;

      results.details.push({
        category,
        field,
        status: passed ? 'PASS' : 'FAIL',
        expected: expectedValue,
        actual: extractedValue,
        description
      });
    },

    fuzzy: (category, field, extractedValue, expectedValue, description) => {
      // For strings - case-insensitive partial match
      // For numbers - within tolerance
      let passed = false;

      if (typeof expectedValue === 'number') {
        passed = Math.abs(extractedValue - expectedValue) < 2;
      } else if (typeof expectedValue === 'string') {
        const e = expectedValue.toLowerCase();
        const a = String(extractedValue || '').toLowerCase();
        passed = a.includes(e) || e.includes(a);
      } else {
        passed = extractedValue === expectedValue;
      }

      results.passed += passed ? 1 : 0;
      results.failed += passed ? 0 : 1;

      results.details.push({
        category,
        field,
        status: passed ? 'PASS' : 'FAIL',
        expected: expectedValue,
        actual: extractedValue,
        description: `${description} (fuzzy match)`
      });
    },

    arrayContains: (category, field, extractedArray, expectedItem, description) => {
      const extracted = Array.isArray(extractedArray) ? extractedArray : [];
      const passed = extracted.some(item => {
        const itemStr = typeof item === 'object' ? JSON.stringify(item).toLowerCase() : String(item).toLowerCase();
        return itemStr.includes(String(expectedItem).toLowerCase());
      });

      results.passed += passed ? 1 : 0;
      results.failed += passed ? 0 : 1;

      results.details.push({
        category,
        field,
        status: passed ? 'PASS' : 'FAIL',
        expected: `Array containing: ${expectedItem}`,
        actual: extracted,
        description
      });
    },

    riskScoreMatch: (category, extracted, expected) => {
      let scoreMatch = expected.score === null || (extracted?.score !== undefined && Math.abs(extracted.score - expected.score) <= 2);
      let levelMatch = false;

      if (expected.level === null) {
        levelMatch = extracted?.level === null || extracted?.level === undefined;
      } else if (typeof extracted === 'object' && extracted !== null) {
        const eLevel = expected.level.toLowerCase();
        const aLevel = String(extracted.level || extracted.risk_level || '').toLowerCase();
        levelMatch = aLevel.includes(eLevel) || eLevel.includes(aLevel);
      } else if (typeof extracted === 'string') {
        const eLevel = expected.level.toLowerCase();
        levelMatch = extracted.toLowerCase().includes(eLevel);
      }

      const passed = scoreMatch && levelMatch;
      results.passed += passed ? 1 : 0;
      results.failed += passed ? 0 : 1;

      results.details.push({
        category,
        field: expected.scale || 'Risk Score',
        status: passed ? 'PASS' : 'FAIL',
        expected,
        actual: extracted,
        description: `Risk score validation`
      });
    },

    objectMatch: (category, field, extracted, expected, description) => {
      let matches = 0;
      let total = 0;

      for (const key in expected) {
        total++;
        if (extracted && extracted[key] === expected[key]) {
          matches++;
        }
      }

      const passed = matches === total || (total > 0 && matches / total >= 0.8);
      results.passed += passed ? 1 : 0;
      results.failed += passed ? 0 : 1;

      results.details.push({
        category,
        field,
        status: passed ? 'PASS' : 'FAIL',
        expected,
        actual: extracted,
        description: `${description} (${matches}/${total} fields matched)`
      });
    },

    notAvailable: (category, field, description) => {
      results.notTested += 1;
      results.details.push({
        category,
        field,
        status: 'NOT_TESTED',
        expected: 'N/A',
        actual: 'N/A',
        description
      });
    }
  };

  // Run comparisons
  console.log('\n📊 Running Comparison Tests...\n');

  // Patient Demographics
  console.log('👤 Testing Patient Demographics...');
  test.exact('Patient', 'MRN', extracted?.patient?.mrn, groundTruth.patient.mrn, 'Patient MRN');
  test.exact('Patient', 'Name', extracted?.patient?.name, groundTruth.patient.name, 'Patient Name');
  test.exact('Patient', 'Age', extracted?.patient?.age, groundTruth.patient.age, 'Patient Age');
  test.fuzzy('Patient', 'Gender', extracted?.patient?.gender, groundTruth.patient.gender, 'Patient Gender');
  test.fuzzy('Patient', 'Admission Date', extracted?.patient?.admission_date, groundTruth.patient.admission_date, 'Admission Date');

  // Diagnosis
  console.log('\n🩺 Testing Diagnosis...');
  test.fuzzy('Diagnosis', 'Principal Diagnosis', extracted?.diagnosis?.principal, groundTruth.diagnosis.principal, 'Principal Diagnosis');

  // Vital Signs
  console.log('\n💓 Testing Vital Signs...');
  const vitals = extracted?.vitals || {};
  test.objectMatch('Vitals', 'BP', vitals.bp, groundTruth.vitals.bp, 'Blood Pressure');
  test.objectMatch('Vitals', 'Pulse', vitals.pulse, groundTruth.vitals.pulse, 'Pulse');
  test.objectMatch('Vitals', 'SpO2', vitals.spo2, groundTruth.vitals.spo2, 'Oxygen Saturation');
  test.objectMatch('Vitals', 'Temperature', vitals.temperature, groundTruth.vitals.temperature, 'Temperature');
  test.fuzzy('Vitals', 'Resp Rate', vitals.resp_rate, groundTruth.vitals.resp_rate, 'Respiratory Rate');

  // Risk Scores
  console.log('\n⚠️  Testing Risk Scores...');
  const risks = extracted?.risk_scores || {};

  test.riskScoreMatch('Risk Scores', risks.fall_risk, groundTruth.risk_scores.fall_risk);
  test.riskScoreMatch('Risk Scores', risks.dvt_risk, groundTruth.risk_scores.dvt_risk);
  test.riskScoreMatch('Risk Scores', risks.pressure_ulcer_risk, groundTruth.risk_scores.pressure_ulcer_risk);
  test.riskScoreMatch('Risk Scores', risks.aspiration_risk, groundTruth.risk_scores.aspiration_risk);

  // EWS Score (should be null)
  const ewsMatch = (risks.ews_score === null || risks.ews_score === undefined);
  results.passed += ewsMatch ? 1 : 0;
  results.failed += ewsMatch ? 0 : 1;
  results.details.push({
    category: 'Risk Scores',
    field: 'EWS Score',
    status: ewsMatch ? 'PASS' : 'FAIL',
    expected: null,
    actual: risks.ews_score,
    description: 'EWS should be null (not in document)'
  });

  // GCS
  const gcs = risks.gcs;
  const gcsMatch = gcs && gcs.total === groundTruth.risk_scores.gcs.total;
  results.passed += gcsMatch ? 1 : 0;
  results.failed += gcsMatch ? 0 : 1;
  results.details.push({
    category: 'Risk Scores',
    field: 'GCS',
    status: gcsMatch ? 'PASS' : 'FAIL',
    expected: groundTruth.risk_scores.gcs.total,
    actual: gcs?.total || gcs,
    description: 'Glasgow Coma Scale Total'
  });

  // Functional Status
  console.log('\n🚶 Testing Functional Status...');
  const func = extracted?.functional_status || {};
  test.fuzzy('Functional', 'Overall Assistance', func.overall_assistance_needs, groundTruth.functional_status.overall_assistance_needs, 'Overall Assistance Needs');

  // Check ADL dependencies
  const adls = func.functional_status || {};
  const adlMatch = adls.bathing === 'Dependent' && adls.dressing === 'Dependent' && adls.eating === 'Dependent';
  results.passed += adlMatch ? 1 : 0;
  results.failed += adlMatch ? 0 : 1;
  results.details.push({
    category: 'Functional',
    field: 'ADL Dependencies',
    status: adlMatch ? 'PASS' : 'FAIL',
    expected: { bathing: 'Dependent', dressing: 'Dependent', eating: 'Dependent' },
    actual: adls,
    description: 'Activities of Daily Living dependencies'
  });

  // Allergies
  console.log('\n⚕️ Testing Allergies...');
  const allergies = extracted?.allergies || [];
  // Check if allergies indicate NKDA (No Known Food & Drug Allergies)
  const hasNKDA = allergies.some(a => String(a).toLowerCase().includes('nkf&da') ||
                                   String(a).toLowerCase().includes('not known') ||
                                   String(a).toLowerCase().includes('no known'));
  const allergyMatch = hasNKDA || allergies.length === 0;
  results.passed += allergyMatch ? 1 : 0;
  results.failed += allergyMatch ? 0 : 1;
  results.details.push({
    category: 'Allergies',
    field: 'NKDA',
    status: allergyMatch ? 'PASS' : 'FAIL',
    expected: 'No known allergies (NKDA/NKF&DA)',
    actual: allergies,
    description: 'No Known Food & Drug Allergies'
  });

  // Medications
  console.log('\n💊 Testing Medications...');
  const meds = extracted?.medications || [];
  const medsMatch = meds.length >= groundTruth.medications_count - 2; // Allow small variance
  results.passed += medsMatch ? 1 : 0;
  results.failed += medsMatch ? 0 : 1;
  results.details.push({
    category: 'Medications',
    field: 'Count',
    status: medsMatch ? 'PASS' : 'FAIL',
    expected: `~${groundTruth.medications_count}`,
    actual: meds.length,
    description: 'Number of medications extracted'
  });

  // Check for key medications
  test.arrayContains('Medications', 'Mannitol', meds, 'MANNITOL', 'Mannitol (critical medication)');

  return results;
}

/**
 * Print test results
 */
function printResults(results, extractionResult) {
  console.log('\n' + '='.repeat(80));
  console.log('🎯 DISCHARGE SUMMARY EXTRACTION TEST RESULTS');
  console.log('='.repeat(80));

  console.log(`\n📄 PDF: ${GROUND_TRUTH.pdf_file}`);
  console.log(`⏱️  Extraction Time: ${extractionResult.latency}ms`);
  console.log(`🔢 Tokens Used: ${extractionResult.tokensUsed || 'N/A'}`);

  console.log('\n' + '-'.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('-'.repeat(80));

  const total = results.passed + results.failed + results.partial;
  const passRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;

  console.log(`\n  ✅ Passed:     ${results.passed}`);
  console.log(`  ❌ Failed:     ${results.failed}`);
  console.log(`  ⚠️  Partial:    ${results.partial}`);
  console.log(`  ➖ Not Tested: ${results.notTested}`);
  console.log(`\n  📈 Pass Rate: ${passRate}%`);

  // Category breakdown
  console.log('\n' + '-'.repeat(80));
  console.log('📋 RESULTS BY CATEGORY');
  console.log('-'.repeat(80));

  const categories = [...new Set(results.details.map(d => d.category))];
  categories.forEach(cat => {
    const catResults = results.details.filter(d => d.category === cat);
    const passed = catResults.filter(d => d.status === 'PASS').length;
    const failed = catResults.filter(d => d.status === 'FAIL').length;
    const total = passed + failed;
    const rate = total > 0 ? ((passed / total) * 100).toFixed(0) : 0;

    console.log(`\n  ${cat}:`);
    console.log(`    ${passed}/${total} passed (${rate}%)`);
  });

  // Show only failures for detailed results
  const failures = results.details.filter(d => d.status === 'FAIL');
  const passedCount = results.details.filter(d => d.status === 'PASS').length;

  console.log('\n' + '-'.repeat(80));
  console.log(`🔍 TEST RESULTS (${passedCount} passed, ${failures.length} failed)`);
  console.log('-'.repeat(80));

  // Show only failures
  if (failures.length > 0) {
    console.log('\n❌ Failed Tests:');
    failures.forEach(detail => {
      console.log(`\n  ❌ ${detail.category} - ${detail.field}`);
      console.log(`     ${detail.description}`);
      console.log(`     Expected: ${JSON.stringify(detail.expected)}`);
      console.log(`     Actual:   ${JSON.stringify(detail.actual)}`);
    });
  } else {
    console.log('\n✅ All tests passed!');
  }

  // Extracted data preview
  console.log('\n' + '-'.repeat(80));
  console.log('📦 EXTRACTED DATA PREVIEW');
  console.log('-'.repeat(80));

  const data = extractionResult.data;
  console.log('\n  👤 Patient:');
  console.log(`     Name: ${data.patient?.name || 'Not extracted'}`);
  console.log(`     MRN: ${data.patient?.mrn || 'Not extracted'}`);
  console.log(`     Age: ${data.patient?.age || 'Not extracted'}`);
  console.log(`     Gender: ${data.patient?.gender || 'Not extracted'}`);

  console.log('\n  🩺 Diagnosis:');
  console.log(`     Principal: ${data.diagnosis?.principal || 'Not extracted'}`);

  console.log('\n  💓 Vitals:');
  console.log(`     BP: ${JSON.stringify(data.vitals?.bp || 'Not extracted')}`);
  console.log(`     Pulse: ${JSON.stringify(data.vitals?.pulse || 'Not extracted')}`);
  console.log(`     SpO2: ${JSON.stringify(data.vitals?.spo2 || 'Not extracted')}`);

  console.log('\n  ⚠️  Risk Scores:');
  console.log(`     Fall Risk: ${JSON.stringify(data.risk_scores?.fall_risk || 'Not extracted')}`);
  console.log(`     DVT Risk: ${JSON.stringify(data.risk_scores?.dvt_risk || 'Not extracted')}`);
  console.log(`     Pressure Ulcer Risk: ${JSON.stringify(data.risk_scores?.pressure_ulcer_risk || 'Not extracted')}`);
  console.log(`     GCS: ${JSON.stringify(data.risk_scores?.gcs || 'Not extracted')}`);

  console.log('\n  💊 Medications:');
  const meds = data.medications || [];
  console.log(`     Count: ${meds.length}`);
  meds.slice(0, 3).forEach(med => {
    console.log(`     - ${med.name} ${med.dose} ${med.frequency}`);
  });
  if (meds.length > 3) console.log(`     ... and ${meds.length - 3} more`);

  console.log('\n' + '='.repeat(80));
  console.log('🏁 TEST COMPLETE');
  console.log('='.repeat(80) + '\n');

  return {
    passed: results.passed,
    failed: results.failed,
    total,
    passRate
  };
}

/**
 * Main test execution
 */
async function runTest() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 DISCHARGE SUMMARY EXTRACTION TEST SUITE');
  console.log('='.repeat(80));
  console.log('\n📋 Test Configuration:');
  console.log(`   Agent: Discharge Extractor Agent (Option B - Thinking/ReAct)`);
  console.log(`   PDF: ${GROUND_TRUTH.pdf_file}`);
  console.log(`   Ground Truth: Manually verified data`);

  try {
    const pdfPath = path.join(__dirname, '../../data', GROUND_TRUTH.pdf_file);

    // Check if PDF exists
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    // Initialize agent
    console.log('\n🔧 Initializing Agent...');
    const agent = new DischargeExtractorAgent({
      gemma: {
        baseUrl: process.env.GEMMA_URL || 'http://206.1.62.28:8000/v1/chat/completions',
        model: process.env.GEMMA_MODEL || 'google/gemma-4-31B-it'
      }
    });

    // Process PDF
    console.log('\n🚀 Starting Extraction...\n');
    const extractionResult = await agent.process(pdfPath, {
      pdfName: GROUND_TRUTH.pdf_file,
      onProgress: (progress) => {
        if (progress.type === 'step') {
          const icon = progress.status === 'complete' ? '✅' : progress.status === 'running' ? '🔄' : '❌';
          console.log(`   ${icon} ${progress.step} (${progress.stepNumber}/${progress.totalSteps})`);
        }
      }
    });

    if (!extractionResult.success) {
      console.error('\n❌ Extraction Failed:', extractionResult.error);
      process.exit(1);
    }

    // Compare results
    console.log('\n🔬 Comparing with Ground Truth...');
    const comparison = compareResults(extractionResult.data, GROUND_TRUTH);

    // Print results
    const summary = printResults(comparison, extractionResult);

    // Save results to file
    const resultsPath = path.join(__dirname, 'results', `test_${Date.now()}.json`);
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      groundTruth: GROUND_TRUTH,
      extracted: extractionResult.data,
      comparison,
      summary
    }, null, 2));
    console.log(`\n💾 Results saved to: ${resultsPath}`);

    return summary;

  } catch (error) {
    console.error('\n❌ Test Execution Failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  runTest()
    .then(summary => {
      const exitCode = summary.passed === summary.total ? 0 : 1;
      process.exit(exitCode);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runTest, compareResults, GROUND_TRUTH };
