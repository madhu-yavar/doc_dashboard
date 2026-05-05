/**
 * Test Department Alerts System
 *
 * Run this script to test the department alert system with sample data
 * Usage: node test-department-alerts.cjs
 */

// Load environment variables
require('dotenv').config();

const DepartmentAlertAgent = require('./agents/departments/department_alert_agent.cjs');

// Sample prescription data with lab, radiology, and procedure orders
const sampleDataWithOrders = {
  patient: {
    name: 'Jane Smith',
    age: 52,
    gender: 'Female',
    mrn: 'MRN-789012',
    contact: '+91-9876543210'
  },
  doctor: {
    name: 'Dr. Robert Johnson',
    department: 'Cardiology'
  },
  meta: {
    rx_date: '2025-05-03',
    document_type: 'prescription'
  },
  medications: [
    {
      name: 'Aspirin 75mg',
      dose: '75mg',
      frequency: 'Once daily',
      duration: '30 days'
    }
  ],
  diagnosis: {
    principal: 'Chest pain - rule out cardiac etiology',
    secondary: ['Hypertension'],
    symptoms: ['Chest pain', 'Shortness of breath']
  },
  // Lab orders
  investigations: [
    { type: 'CBC Complete Blood Count', status: 'ordered', priority: 'routine', source: 'visual_selection' },
    { type: 'Lipid Profile', status: 'ordered', priority: 'routine', source: 'visual_selection' },
    { type: 'Troponin I', status: 'ordered', priority: 'urgent', source: 'text_order' },
    { type: 'BNP', status: 'ordered', priority: 'urgent', source: 'text_order' },
    { type: 'CK-MB', status: 'not_selected', priority: 'routine', source: 'visual_selection' }
  ],
  // Radiology orders
  radiology: [
    { type: 'ECG 12-Lead', status: 'ordered', priority: 'urgent', source: 'text_order' },
    { type: 'Echocardiography 2D', status: 'ordered', priority: 'routine', source: 'visual_selection' },
    { type: 'Chest X-Ray PA View', status: 'ordered', priority: 'routine', source: 'visual_selection' }
  ],
  // Nuclear Medicine orders
  nuclear_medicine: [
    { type: 'Myocardial Perfusion Scan', status: 'ordered', priority: 'routine', source: 'visual_selection' }
  ],
  // Procedures
  procedures: [
    { name: 'Coronary Angiography', status: 'ordered', category: 'cardiac', source: 'text_order' }
  ]
};

// Sample data with no department orders
const sampleDataNoOrders = {
  patient: {
    name: 'John Doe',
    age: 35,
    gender: 'Male',
    mrn: 'MRN-345678'
  },
  doctor: {
    name: 'Dr. Emily Brown',
    department: 'General Medicine'
  },
  meta: {
    rx_date: '2025-05-03'
  },
  medications: [
    { name: 'Paracetamol 500mg', dose: '500mg', frequency: 'SOS', duration: '5 days' }
  ],
  diagnosis: {
    principal: 'Viral fever'
  },
  investigations: [],
  radiology: [],
  nuclear_medicine: [],
  procedures: []
};

async function testDepartmentAlerts() {
  console.log('\n' + '='.repeat(70));
  console.log('DEPARTMENT ALERTS SYSTEM TEST');
  console.log('='.repeat(70) + '\n');

  const agent = new DepartmentAlertAgent();

  // Test 1: With department orders
  console.log('TEST 1: Prescription WITH department orders');
  console.log('-'.repeat(70));
  console.log('Patient: Jane Smith');
  console.log('Doctor: Dr. Robert Johnson (Cardiology)');
  console.log('Lab Tests: 4 ordered');
  console.log('Radiology: 3 ordered');
  console.log('Nuclear Medicine: 1 ordered');
  console.log('Procedures: 1 ordered');
  console.log('');

  const result1 = await agent.sendAlerts(sampleDataWithOrders, {
    documentId: 'TEST-WITH-ORDERS-' + Date.now()
  });

  console.log('\nResult 1 Summary:');
  console.log('  Success:', result1.success ? '✓' : '✗');
  console.log('  Sent:', result1.sent ? 'Yes' : 'No');
  console.log('  Departments Notified:');
  for (const [dept, info] of Object.entries(result1.departments || {})) {
    console.log(`    - ${dept}: ${info.sent ? '✓ Sent' : '✗ Failed'} (${info.itemCount} items)`);
  }

  // Test 2: Without department orders
  console.log('\n\n' + '='.repeat(70));
  console.log('TEST 2: Prescription WITHOUT department orders');
  console.log('-'.repeat(70));
  console.log('Patient: John Doe');
  console.log('Doctor: Dr. Emily Brown');
  console.log('Lab Tests: 0');
  console.log('Radiology: 0');
  console.log('Nuclear Medicine: 0');
  console.log('Procedures: 0');
  console.log('');

  const result2 = await agent.sendAlerts(sampleDataNoOrders, {
    documentId: 'TEST-NO-ORDERS-' + Date.now()
  });

  console.log('\nResult 2 Summary:');
  console.log('  Success:', result2.success ? '✓' : '✗');
  console.log('  Sent:', result2.sent ? 'Yes' : 'No');
  console.log('  Skipped:', result2.skipped ? `Yes (${result2.reason})` : 'No');

  // Check alert history
  console.log('\n\n' + '='.repeat(70));
  console.log('ALERT HISTORY (last 5)');
  console.log('='.repeat(70));
  const history = await agent.getAlertHistory(5);
  history.forEach((alert, idx) => {
    console.log(`\n${idx + 1}. ${alert.timestamp}`);
    console.log('   Document:', alert.documentId);
    console.log('   Patient:', alert.patientName, '(MRN:', alert.patientMrn + ')');
    console.log('   Departments:');
    alert.departments.forEach(d => {
      console.log(`     - ${d.department}: ${d.count} orders`);
    });
  });

  console.log('\n' + '='.repeat(70) + '\n');
}

// Run test
testDepartmentAlerts().catch(console.error);
