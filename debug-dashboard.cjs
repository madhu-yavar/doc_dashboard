const PrescriptionTwoStageAgent = require('./agents/prescription_two_stage_agent.cjs');

async function debugDashboard() {
  console.log('\n========================================');
  console.log('DEBUG: Prescription Dashboard Output');
  console.log('========================================\n');

  const agent = new PrescriptionTwoStageAgent({
    stage3Policy: 'never' // Skip stage 3 for this debug
  });

  const result = await agent.process('./data/Prescription_03.pdf', {
    pdfName: 'Prescription_03.pdf'
  });

  if (result.success) {
    console.log('\n========== RESULT STRUCTURE ==========');
    console.log('result.data keys:', Object.keys(result.data));
    console.log('\n--- dashboard_cards keys ---');
    console.log(Object.keys(result.data.dashboard_cards));
    
    console.log('\n--- medications_card ---');
    const medCard = result.data.dashboard_cards.medications_card;
    console.log(JSON.stringify(medCard, null, 2));

    console.log('\n--- medications list ---');
    console.log('medication_list length:', medCard.medication_list?.length || 0);
    if (medCard.medication_list?.length > 0) {
      console.log('First med:', JSON.stringify(medCard.medication_list[0], null, 2));
    }

    console.log('\n--- sample_patient_data ---');
    console.log(JSON.stringify(result.data.sample_patient_data, null, 2));

    console.log('\n--- presentation.summary_cards keys ---');
    console.log(Object.keys(result.data.presentation?.summary_cards || {}));

    console.log('\n--- presentation.notes_rail ---');
    console.log(JSON.stringify(result.data.presentation?.notes_rail, null, 2));
  }

  console.log('\n========================================\n');
}

debugDashboard().catch(console.error);
