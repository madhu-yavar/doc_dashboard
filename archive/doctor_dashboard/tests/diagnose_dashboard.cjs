/**
 * Dashboard Diagnostic Script
 * Helps identify why extracted data might not be showing in the dashboard
 */

const fs = require('fs');
const path = require('path');

const DOCUMENTS_PATH = path.join(__dirname, '../../server/storage/documents.json');

async function diagnoseDashboardIssue() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 DASHBOARD DATA DIAGNOSTIC');
  console.log('='.repeat(80));

  // Read stored documents
  let documents;
  try {
    const raw = await fs.readFile(DOCUMENTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    documents = parsed.documents || [];
  } catch (error) {
    console.error('❌ Could not read documents.json:', error.message);
    console.log('\n💡 Make sure the server has processed at least one document.');
    return;
  }

  if (documents.length === 0) {
    console.log('\n⚠️  No documents found in storage.');
    console.log('   Upload and process a PDF first.');
    return;
  }

  console.log(`\n📊 Found ${documents.length} document(s) in storage.\n`);

  // Analyze each document
  documents.forEach((doc, index) => {
    console.log('─'.repeat(80));
    console.log(`Document ${index + 1}: ${doc.name}`);
    console.log('─'.repeat(80));

    console.log(`\n  📁 Basic Info:`);
    console.log(`     ID: ${doc.id}`);
    console.log(`     Status: ${doc.status}`);
    console.log(`     Department: ${doc.department}`);
    console.log(`     Uploaded: ${doc.uploadedAt}`);

    if (doc.status === 'processed') {
      console.log(`\n  ✅ Processing Status: PROCESSED`);
      console.log(`     Processed At: ${doc.processedAt}`);

      if (doc.agentInfo) {
        console.log(`\n  🤖 Agent Info:`);
        console.log(`     Name: ${doc.agentInfo.name}`);
        console.log(`     Version: ${doc.agentInfo.version}`);
        console.log(`     Tokens Used: ${doc.agentInfo.tokensUsed?.toLocaleString() || 'N/A'}`);
        console.log(`     Confidence: ${doc.agentInfo.validation?.confidence_level || 'N/A'}`);
      }

      if (doc.result) {
        console.log(`\n  📦 Extracted Data:`);

        const samplePatient = doc.result.sample_patient_data || {};
        console.log(`     👤 Patient:`);
        console.log(`        Name: ${samplePatient.name || 'NOT EXTRACTED'}`);
        console.log(`        Age: ${samplePatient.age || 'NOT EXTRACTED'}`);
        console.log(`        MRN: ${samplePatient.mrn || 'NOT EXTRACTED'}`);
        console.log(`        Admission: ${samplePatient.admission_date || 'NOT EXTRACTED'}`);
        console.log(`        Discharge: ${samplePatient.discharge_date || 'NOT EXTRACTED'}`);

        const cards = doc.result.dashboard_cards || {};
        console.log(`\n     📊 Dashboard Cards:`);

        if (cards.vitals_card) {
          console.log(`        Vitals:`);
          console.log(`           BP: ${cards.vitals_card.summary?.latest_bp || 'NOT EXTRACTED'}`);
          console.log(`           Pulse: ${cards.vitals_card.summary?.pulse || 'NOT EXTRACTED'}`);
          console.log(`           SpO2: ${cards.vitals_card.summary?.spo2 || 'NOT EXTRACTED'}`);
        }

        if (cards.diagnosis_card) {
          console.log(`        Diagnosis: ${cards.diagnosis_card.principal_diagnosis || 'NOT EXTRACTED'}`);
        }

        if (cards.medications_card) {
          console.log(`        Medications: ${cards.medications_card.active_count || 0} active`);
        }

        console.log(`\n     📋 Dashboard URL to view this data:`);
        console.log(`        http://localhost:5173/dashboard?documentId=${doc.id}`);
      } else {
        console.log(`\n  ⚠️  No result data found!`);
        console.log(`     The document is marked as processed but has no extracted data.`);
      }
    } else if (doc.status === 'queued') {
      console.log(`\n  ⏳ Status: QUEUED (not yet processed)`);
      console.log(`     Action: Go to Upload Center and click "Process batch"`);
    } else if (doc.status === 'processing') {
      console.log(`\n  🔄 Status: PROCESSING (in progress)`);
      console.log(`     Action: Wait for processing to complete`);
    } else if (doc.status === 'failed') {
      console.log(`\n  ❌ Status: FAILED`);
      console.log(`     Error: ${doc.error || 'Unknown error'}`);
    }

    console.log();
  });

  console.log('─'.repeat(80));
  console.log('📝 SUMMARY AND RECOMMENDATIONS:');
  console.log('─'.repeat(80));

  const processed = documents.filter(d => d.status === 'processed').length;
  const queued = documents.filter(d => d.status === 'queued').length;
  const failed = documents.filter(d => d.status === 'failed').length;

  console.log(`\n  Processed: ${processed}`);
  console.log(`  Queued: ${queued}`);
  console.log(`  Failed: ${failed}`);

  if (processed > 0) {
    console.log(`\n  ✅ You have ${processed} processed document(s) ready to view.`);
    console.log(`  📖 Open the dashboard with the documentId parameter shown above.`);
    console.log(`     Example: http://localhost:5173/dashboard?documentId=${documents.find(d => d.status === 'processed')?.id}`);
  }

  if (queued > 0) {
    console.log(`\n  ⏳ You have ${queued} document(s) waiting to be processed.`);
    console.log(`     Go to Upload Center and click "Process batch"`);
  }

  if (failed > 0) {
    console.log(`\n  ❌ ${failed} document(s) failed to process.`);
    console.log(`     Check the error messages above for details.`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🔍 DIAGNOSTIC COMPLETE');
  console.log('='.repeat(80) + '\n');
}

diagnoseDashboardIssue().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
