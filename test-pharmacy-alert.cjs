/**
 * Test Pharmacy Alert System
 *
 * Run this script to test the pharmacy alert system with sample data
 * Usage: node test-pharmacy-alert.cjs
 */

// Load environment variables
require('dotenv').config();

const PharmacyAlertAgent = require('./agents/pharmacy/pharmacy_alert_agent.cjs');

// Sample prescription data (mimicking dashboard format)
const samplePrescriptionData = {
  patient: {
    name: 'John Doe',
    age: 45,
    gender: 'Male',
    mrn: 'MRN-123456',
    contact: '+91-9876543210'
  },
  doctor: {
    name: 'Dr. Sarah Smith',
    department: 'Cardiology'
  },
  meta: {
    rx_date: '2025-05-03',
    document_type: 'prescription'
  },
  medications: [
    {
      name: 'Amlodipine 5mg',
      dose: '5mg',
      frequency: 'Twice daily',
      duration: '30 days',
      instructions: 'Take after meals'
    },
    {
      name: 'Metformin 500mg',
      dose: '500mg',
      frequency: 'Three times daily',
      duration: '30 days',
      instructions: 'Take after meals'
    },
    {
      name: 'Atorvastatin 10mg',
      dose: '10mg',
      frequency: 'Once daily at bedtime',
      duration: '30 days',
      instructions: null
    }
  ],
  diagnosis: {
    principal: 'Hypertension with Type 2 Diabetes Mellitus',
    secondary: ['Dyslipidemia'],
    symptoms: ['Headache', 'Fatigue']
  },
  clinical_notes: [
    {
      type: 'Advice',
      summary: 'Follow up after 4 weeks with BP chart and fasting blood sugar',
      author: 'Dr. Sarah Smith',
      date: '2025-05-03'
    }
  ]
};

async function testPharmacyAlert() {
  console.log('\n' + '='.repeat(70));
  console.log('PHARMACY ALERT SYSTEM TEST');
  console.log('='.repeat(70) + '\n');

  console.log('Sample Prescription Data:');
  console.log('  Patient:', samplePrescriptionData.patient.name);
  console.log('  Age/Gender:', samplePrescriptionData.patient.age, '/', samplePrescriptionData.patient.gender);
  console.log('  MRN:', samplePrescriptionData.patient.mrn);
  console.log('  Doctor:', samplePrescriptionData.doctor.name);
  console.log('  Medications:', samplePrescriptionData.medications.length);
  samplePrescriptionData.medications.forEach((med, idx) => {
    console.log(`    ${idx + 1}. ${med.name} - ${med.dose} - ${med.frequency}`);
  });
  console.log('  Diagnosis:', samplePrescriptionData.diagnosis.principal);
  console.log('');

  // Initialize agent
  const agent = new PharmacyAlertAgent();

  // Check status
  console.log('Agent Status:');
  const status = agent.getStatus();
  console.log('  Enabled:', status.enabled);
  console.log('  Channels:');
  console.log('    Email:', status.channels.email.enabled ? '✓' : '✗',
              '(configured:', status.channels.email.configured ? 'Yes' : 'No', ')');
  console.log('    WhatsApp:', status.channels.whatsapp.enabled ? '✓' : '✗',
              '(configured:', status.channels.whatsapp.configured ? 'Yes' : 'No', ')');
  console.log('');

  // Send alert
  console.log('Sending Pharmacy Alert...\n');
  const result = await agent.sendAlert(samplePrescriptionData, {
    documentId: 'TEST-' + Date.now()
  });

  console.log('\n' + '='.repeat(70));
  console.log('RESULT SUMMARY');
  console.log('='.repeat(70));
  console.log('Success:', result.success ? '✓' : '✗');
  console.log('Sent:', result.sent ? 'Yes' : 'No');
  console.log('Email Sent:', result.emailSent ? 'Yes' : 'No');
  console.log('WhatsApp Sent:', result.whatsappSent ? 'Yes' : 'No');
  console.log('Processing Time:', result.processingTime, 'ms');

  if (result.error) {
    console.log('Error:', result.error);
  }

  // Check alert history
  console.log('\n' + '='.repeat(70));
  console.log('ALERT HISTORY (last 5)');
  console.log('='.repeat(70));
  const history = await agent.getAlertHistory(5);
  history.forEach((alert, idx) => {
    console.log(`\n${idx + 1}. ${alert.timestamp}`);
    console.log('   Patient:', alert.patientName, '(MRN:', alert.patientMrn + ')');
    console.log('   Doctor:', alert.doctorName);
    console.log('   Medications:', alert.medicationCount, '-', alert.medications);
    console.log('   Trigger:', alert.trigger);
  });

  console.log('\n' + '='.repeat(70) + '\n');
}

// Run test
testPharmacyAlert().catch(console.error);
