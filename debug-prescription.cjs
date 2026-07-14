#!/usr/bin/env node
/**
 * Debug script to test prescription generation
 * Run with: node debug-prescription.js <documentId>
 */

const fs = require('fs');
const path = require('path');

// Check if prescription templates exist
const TEMPLATE_DIR = path.join(__dirname, 'prescription_template_dev');

console.log('🔍 Checking prescription templates...');
console.log('Template directory:', TEMPLATE_DIR);

try {
  const files = fs.readdirSync(TEMPLATE_DIR);
  console.log('✅ Template files found:', files);

  // Check each template file
  files.forEach(file => {
    const filePath = path.join(TEMPLATE_DIR, file);
    const stats = fs.statSync(filePath);
    console.log(`  - ${file}: ${(stats.size / 1024).toFixed(2)} KB`);
  });
} catch (error) {
  console.error('❌ Template directory error:', error.message);
  process.exit(1);
}

// Check if output directory exists
const OUTPUT_DIR = path.join(__dirname, 'server', 'storage', 'prescriptions');
console.log('\n🔍 Checking output directory:', OUTPUT_DIR);

try {
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.log('⚠️  Output directory does not exist, creating...');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log('✅ Output directory created');
  } else {
    const files = fs.readdirSync(OUTPUT_DIR);
    console.log('✅ Output directory exists, files:', files.length);
  }
} catch (error) {
  console.error('❌ Output directory error:', error.message);
}

// Check if Playwright is available
console.log('\n🔍 Checking Playwright...');
try {
  const { chromium } = require('playwright');
  console.log('✅ Playwright available');
} catch (error) {
  console.error('❌ Playwright error:', error.message);
  console.error('   Run: npm install playwright');
}

// Check server configuration
console.log('\n🔍 Checking server configuration...');

// Check if repositories are available
try {
  const serverPath = path.join(__dirname, 'server', 'index.cjs');
  if (fs.existsSync(serverPath)) {
    console.log('✅ Server file exists');

    // Read the server file to check configuration
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    if (serverContent.includes('prescriptionService')) {
      console.log('✅ Prescription service configured in server');
    } else {
      console.error('❌ Prescription service not found in server');
    }

    if (serverContent.includes('documentsRepository')) {
      console.log('✅ Documents repository configured');
    } else {
      console.error('❌ Documents repository not configured');
    }

    if (serverContent.includes('liveSessionsRepository')) {
      console.log('✅ Live sessions repository configured');
    } else {
      console.error('❌ Live sessions repository not configured');
    }
  } else {
    console.error('❌ Server file not found');
  }
} catch (error) {
  console.error('❌ Server check error:', error.message);
}

console.log('\n🎯 To test prescription generation:');
console.log('1. Start the server: npm run server');
console.log('2. Run this command:');
console.log('   curl -X POST http://localhost:3000/api/prescriptions/generate \\');
console.log('     -H "Content-Type: application/json" \\');
console.log('     -d \'{"documentId":"voice-live-live-1780483830844-c45144be","format":"both"}\'');
console.log('');
console.log('Or test with the document ID from your curl command:');
const docId = process.argv[2] || 'voice-live-live-1780483830844-c45144be';
console.log(`   curl -X POST http://localhost:3000/api/prescriptions/generate \\`);
console.log(`     -H "Content-Type: application/json" \\`);
console.log(`     -d '{"documentId":"${docId}","format":"both"}'`);

console.log('\n📋 If prescription generation fails, check:');
console.log('1. Server logs for error messages');
console.log('2. Database connectivity');
console.log('3. Document exists in database');
console.log('4. Playwright/Chromium dependencies');
console.log('5. File system permissions for output directory');
