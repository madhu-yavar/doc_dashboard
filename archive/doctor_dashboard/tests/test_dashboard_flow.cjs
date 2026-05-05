/**
 * Test the full flow from PDF to Dashboard transformation
 */

const DischargeExtractorAgent = require('../agents/discharge_extractor_agent.cjs');
const DashboardMapperSkill = require('../skills/clinical/dashboard_mapper.skill.cjs');
const path = require('path');

// Test PDF
const PDF_PATH = path.join(__dirname, '../../data/Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf');

async function testFullFlow() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING FULL FLOW: PDF → AGENT → DASHBOARD MAPPER');
  console.log('='.repeat(80));

  // Step 1: Initialize Agent and Dashboard Mapper
  console.log('\n📦 Step 1: Initializing Agent and Dashboard Mapper...');
  const agent = new DischargeExtractorAgent({
    gemma: {
      baseUrl: process.env.GEMMA_URL || 'http://206.1.62.28:8000/v1/chat/completions',
      model: process.env.GEMMA_MODEL || 'google/gemma-4-26B-A4B-it'
    }
  });
  const dashboardMapper = new DashboardMapperSkill();
  console.log('   ✅ Initialized');

  // Step 2: Process PDF with Agent
  console.log('\n📄 Step 2: Processing PDF with Discharge Extractor Agent...');
  const agentResult = await agent.process(PDF_PATH, {
    pdfName: 'Custom.MEXX.Report.ZEN.DischargeSummary12.cls.pdf'
  });

  if (!agentResult.success) {
    console.error('   ❌ Agent processing failed:', agentResult.error);
    process.exit(1);
  }

  console.log(`   ✅ Agent processing complete`);
  console.log(`   📊 Tokens used: ${agentResult.tokensUsed}`);
  console.log(`   ⏱️  Latency: ${agentResult.latency}ms`);

  // Step 3: Extract key data from agent result
  console.log('\n📋 Step 3: Key Extracted Data from Agent:');
  const agentData = agentResult.data;
  console.log(`   👤 Patient: ${agentData.patient?.name} (MRN: ${agentData.patient?.mrn})`);
  console.log(`   🩺 Diagnosis: ${agentData.diagnosis?.principal}`);
  console.log(`   💓 BP: ${JSON.stringify(agentData.vitals?.bp)}`);
  console.log(`   ⚠️  Fall Risk: ${JSON.stringify(agentData.risk_scores?.fall_risk)}`);

  // Step 4: Transform to Dashboard Format
  console.log('\n🎨 Step 4: Transforming to Dashboard Format...');
  const mapperResult = await dashboardMapper.execute({ agentResult });

  if (!mapperResult.success) {
    console.error('   ❌ Dashboard mapper failed');
    process.exit(1);
  }

  console.log('   ✅ Dashboard transformation complete');

  // Step 5: Display Dashboard Cards
  console.log('\n📊 Step 5: Dashboard Cards:');
  const dashboardCards = mapperResult.data.dashboard_cards;
  const samplePatientData = mapperResult.data.sample_patient_data;

  console.log('\n   👤 Sample Patient Data:');
  console.log(`      Name: ${samplePatientData.name}`);
  console.log(`      Age: ${samplePatientData.age}`);
  console.log(`      MRN: ${samplePatientData.mrn}`);
  console.log(`      Admission: ${samplePatientData.admission_date}`);
  console.log(`      Discharge: ${samplePatientData.discharge_date}`);
  console.log(`      LOS: ${samplePatientData.los_days} days`);

  console.log('\n   📊 Vitals Card:');
  console.log(`      Status: ${dashboardCards.vitals_card.status}`);
  console.log(`      BP: ${dashboardCards.vitals_card.summary.latest_bp}`);
  console.log(`      Pulse: ${dashboardCards.vitals_card.summary.pulse}`);
  console.log(`      SpO2: ${dashboardCards.vitals_card.summary.spo2}`);
  console.log(`      Alerts: ${dashboardCards.vitals_card.has_alerts}`);

  console.log('\n   🩺 Diagnosis Card:');
  console.log(`      Principal: ${dashboardCards.diagnosis_card.principal_diagnosis}`);
  console.log(`      ICD Code: ${dashboardCards.diagnosis_card.icd_code}`);
  console.log(`      Secondary: ${dashboardCards.diagnosis_card.secondary_diagnoses.length} diagnoses`);

  console.log('\n   💊 Medications Card:');
  console.log(`      Active: ${dashboardCards.medications_card.active_count}`);
  console.log(`      Allergies: ${dashboardCards.medications_card.allergy_count}`);
  console.log(`      Categories: ${JSON.stringify(dashboardCards.medications_card.categories)}`);

  console.log('\n   ⚠️  Risk Card:');
  console.log(`      Fall Risk: ${JSON.stringify(dashboardCards.risk_card.fall_risk)}`);
  console.log(`      DVT Risk: ${JSON.stringify(dashboardCards.risk_card.dvt_risk)}`);
  console.log(`      Pressure Ulcer: ${JSON.stringify(dashboardCards.risk_card.pressure_ulcer_risk)}`);
  console.log(`      Overall: ${dashboardCards.risk_card.overall_status}`);

  // Step 6: Simulate Frontend Transformation
  console.log('\n🖥️  Step 6: Simulating Frontend Transformation...');
  const result = {
    meta: agentData.meta,
    dashboard_cards: dashboardCards,
    sample_patient_data: samplePatientData
  };

  // Simulate the parseBp function from frontend
  const parseBp = (bp) => {
    if (typeof bp === 'string' || bp instanceof String) {
      const match = bp.match(/(\d+)\s*\/\s*(\d+)/);
      return {
        systolic: match ? Number(match[1]) : 120,
        diastolic: match ? Number(match[2]) : 80,
      };
    }
    return { systolic: 120, diastolic: 80 };
  };

  const bp = parseBp(dashboardCards.vitals_card.summary.latest_bp);
  const pulse = dashboardCards.vitals_card.summary.pulse || 72;
  const spo2 = dashboardCards.vitals_card.summary.spo2 || 98;

  console.log('\n   📊 Transformed Vitals (as frontend would see):');
  console.log(`      BP: ${bp.systolic}/${bp.diastolic} mmHg`);
  console.log(`      Pulse: ${pulse} bpm`);
  console.log(`      SpO2: ${spo2}%`);

  console.log('\n' + '='.repeat(80));
  console.log('✅ FULL FLOW TEST COMPLETE');
  console.log('='.repeat(80) + '\n');

  return {
    agentData,
    dashboardCards,
    samplePatientData,
    result
  };
}

// Run the test
testFullFlow()
  .then(({ agentData, dashboardCards, samplePatientData, result }) => {
    console.log('✅ All steps completed successfully!');
    console.log('\nYou can now verify this data matches what appears in the dashboard.\n');
  })
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
