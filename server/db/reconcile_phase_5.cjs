#!/usr/bin/env node
/**
 * Phase 5: Identity Reconciliation CLI
 *
 * Command-line interface for running identity reconciliation operations.
 *
 * Usage:
 *   node server/db/reconcile_phase_5.cjs [options]
 *
 * Options:
 *   --dry-run              Simulate reconciliation without writing changes
 *   --report-only          Generate report only without executing reconciliation
 *   --entity-type=TYPE     Run reconciliation for specific entity type (patient|encounter)
 *   --case-id=ID           Reconcile specific case or entity by ID
 *   --output=FILE          Write report to JSON file
 *   --help                 Show this help message
 *
 * Examples:
 *   node server/db/reconcile_phase_5.cjs --dry-run --entity-type=patient
 *   node server/db/reconcile_phase_5.cjs --case-id=123-abc-456
 *   node server/db/reconcile_phase_5.cjs --report-only --output=report.json
 */

const { IdentityReconciliationService } = require('../identity_reconciliation_service.cjs');
const { postgresClient } = require('./postgres_client.cjs');

// Parse command line arguments
function parseArgs(args) {
  const options = {
    dryRun: false,
    reportOnly: false,
    entityType: null,
    caseId: null,
    outputFile: null,
    help: false
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--report-only') {
      options.reportOnly = true;
    } else if (arg.startsWith('--entity-type=')) {
      options.entityType = arg.split('=')[1];
    } else if (arg.startsWith('--case-id=')) {
      options.caseId = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      options.outputFile = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
Phase 5: Identity Reconciliation CLI

Usage:
  node server/db/reconcile_phase_5.cjs [options]

Options:
  --dry-run              Simulate reconciliation without writing changes
  --report-only          Generate report only without executing reconciliation
  --entity-type=TYPE     Run reconciliation for specific entity type (patient|encounter)
  --case-id=ID           Reconcile specific case or entity by ID
  --output=FILE          Write report to JSON file
  --help                 Show this help message

Examples:
  # Dry run patient reconciliation
  node server/db/reconcile_phase_5.cjs --dry-run --entity-type=patient

  # Dry run encounter reconciliation
  node server/db/reconcile_phase_5.cjs --dry-run --entity-type=encounter

  # Reconcile specific entity by ID
  node server/db/reconcile_phase_5.cjs --case-id=patient-123

  # Generate report only
  node server/db/reconcile_phase_5.cjs --report-only --output=report.json

  # Full reconciliation (patients and encounters)
  node server/db/reconcile_phase_5.cjs
`);
}

// Validate options
function validateOptions(options) {
  const errors = [];

  if (options.entityType && !['patient', 'encounter'].includes(options.entityType)) {
    errors.push(`Invalid entity-type: ${options.entityType}. Must be 'patient' or 'encounter'`);
  }

  if (options.caseId && options.entityType) {
    errors.push('Cannot specify both --case-id and --entity-type');
  }

  return errors;
}

// Main execution function
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const validationErrors = validateOptions(options);
  if (validationErrors.length > 0) {
    console.error('Validation errors:');
    validationErrors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Phase 5: Identity Reconciliation CLI             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Options:');
  console.log(`  Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);
  console.log(`  Report Only: ${options.reportOnly ? 'Yes' : 'No'}`);
  console.log(`  Entity Type: ${options.entityType || 'All'}`);
  console.log(`  Case ID: ${options.caseId || 'None'}`);
  console.log(`  Output File: ${options.outputFile || 'stdout'}`);
  console.log('');

  try {
    // Initialize database connection
    console.log('Initializing database connection...');
    await postgresClient.connect();

    // Initialize reconciliation service
    console.log('Initializing reconciliation service...');
    const service = new IdentityReconciliationService(postgresClient);
    await service.initialize();

    // Get initial statistics
    console.log('Getting initial statistics...');
    const initialStats = await service.getSummaryStats();
    console.log('Initial statistics:');
    console.log(`  Patients: ${initialStats.patients.total} (${initialStats.patients.provisional} provisional, ${initialStats.patients.reconciled} reconciled, ${initialStats.patients.conflicted} conflicted)`);
    console.log(`  Encounters: ${initialStats.encounters.total} (${initialStats.encounters.provisional} provisional, ${initialStats.encounters.reconciled} reconciled, ${initialStats.encounters.conflicted} conflicted)`);
    console.log(`  Cases: ${initialStats.cases.total} total`);
    console.log('');

    if (options.reportOnly) {
      // Report only mode - just output current state
      console.log('Report-only mode: Skipping reconciliation...');
      const report = {
        initial_stats: initialStats,
        timestamp: new Date().toISOString(),
        mode: 'report_only'
      };

      if (options.outputFile) {
        const fs = require('fs');
        fs.writeFileSync(options.outputFile, JSON.stringify(report, null, 2));
        console.log(`Report written to ${options.outputFile}`);
      } else {
        console.log('\nReport:');
        console.log(JSON.stringify(report, null, 2));
      }

      await postgresClient.close();
      return;
    }

    if (options.caseId) {
      // Reconcile specific entity/case by ID
      console.log(`Reconciling specific entity: ${options.caseId}...`);
      const result = await reconcileEntityById(service, options.caseId, options);
      console.log('Result:', JSON.stringify(result, null, 2));
    } else if (options.entityType) {
      // Run reconciliation for specific entity type
      console.log(`Running ${options.entityType} reconciliation...`);
      await runEntityTypeReconciliation(service, options.entityType, options);
    } else {
      // Run full reconciliation
      console.log('Running full reconciliation...');
      await runFullReconciliation(service, options);
    }

    // Get final statistics
    console.log('\nGetting final statistics...');
    const finalStats = await service.getSummaryStats();
    console.log('Final statistics:');
    console.log(`  Patients: ${finalStats.patients.total} (${finalStats.patients.provisional} provisional, ${finalStats.patients.reconciled} reconciled, ${finalStats.patients.conflicted} conflicted)`);
    console.log(`  Encounters: ${finalStats.encounters.total} (${finalStats.encounters.provisional} provisional, ${finalStats.encounters.reconciled} reconciled, ${finalStats.encounters.conflicted} conflicted)`);
    console.log(`  Cases: ${finalStats.cases.total} total`);

    // Get reconciliation report
    const report = service.getReport();
    console.log('\nReconciliation Report:');
    console.log(`  Patients Scanned: ${report.patients_scanned}`);
    console.log(`  Encounters Scanned: ${report.encounters_scanned}`);
    console.log(`  Patient Reconciliations: ${report.patient_reconciliations}`);
    console.log(`  Encounter Reconciliations: ${report.encounter_reconciliations}`);
    console.log(`  Patient Merges: ${report.patient_merges}`);
    console.log(`  Encounter Merges: ${report.encounter_merges}`);
    console.log(`  Cases Created: ${Object.values(report.cases_created_by_reason).reduce((sum, count) => sum + count, 0)}`);
    console.log(`  Cases Resolved: ${report.cases_resolved}`);
    console.log(`  Cases Deferred: ${report.cases_deferred}`);
    console.log(`  Entities Skipped (in review): ${report.entities_skipped_in_review}`);
    console.log(`  Identifiers Promoted to Verified: ${report.identifiers_promoted_to_verified}`);
    console.log(`  Identifiers Marked Deprecated: ${report.identifiers_marked_deprecated}`);
    console.log(`  Errors: ${report.errors.length}`);

    if (Object.keys(report.cases_created_by_reason).length > 0) {
      console.log('\nCases Created by Reason:');
      for (const [reason, count] of Object.entries(report.cases_created_by_reason)) {
        console.log(`  ${reason}: ${count}`);
      }
    }

    if (report.errors.length > 0) {
      console.log('\nErrors:');
      report.errors.forEach(err => {
        console.log(`  [${err.entity_type}:${err.entity_id}] ${err.error}`);
      });
    }

    // Write report to file if specified
    if (options.outputFile) {
      const fs = require('fs');
      const fullReport = {
        initial_stats: initialStats,
        final_stats: finalStats,
        reconciliation_report: report,
        options: options,
        generated_at: new Date().toISOString()
      };

      fs.writeFileSync(options.outputFile, JSON.stringify(fullReport, null, 2));
      console.log(`\nReport written to ${options.outputFile}`);
    }

    console.log('\n✓ Reconciliation completed successfully');

    // Close database connection
    await postgresClient.close();

  } catch (error) {
    console.error('\n✗ Error during reconciliation:', error);
    console.error(error.stack);
    await postgresClient.close();
    process.exit(1);
  }
}

// Reconcile specific entity by ID
async function reconcileEntityById(service, entityId, options) {
  // Try to find if it's a patient, encounter, or case
  const patient = await service.masterDataRepo.findById('patients', entityId);
  const encounter = await service.masterDataRepo.findById('encounters', entityId);
  const reconciliationCase = await service.masterDataRepo.findReconciliationCaseById(entityId);

  if (patient) {
    console.log('Found patient - running patient reconciliation...');
    return await service.reconcilePatient(entityId, { dryRun: options.dryRun });
  } else if (encounter) {
    console.log('Found encounter - running encounter reconciliation...');
    return await service.reconcileEncounter(entityId, { dryRun: options.dryRun });
  } else if (reconciliationCase) {
    console.log('Found reconciliation case - displaying case details...');
    return reconciliationCase;
  } else {
    throw new Error(`Entity not found: ${entityId}`);
  }
}

// Run reconciliation for specific entity type
async function runEntityTypeReconciliation(service, entityType, options) {
  if (entityType === 'patient') {
    console.log('Starting patient reconciliation batch...');
    const results = await service.runBatchPatientReconciliation({ dryRun: options.dryRun });
    console.log(`Patient reconciliation completed. Processed ${results.length} patients.`);
  } else if (entityType === 'encounter') {
    console.log('Starting encounter reconciliation batch...');
    const results = await service.runBatchEncounterReconciliation({ dryRun: options.dryRun });
    console.log(`Encounter reconciliation completed. Processed ${results.length} encounters.`);
  }
}

// Run full reconciliation (patients then encounters)
async function runFullReconciliation(service, options) {
  console.log('Step 1: Reconciling patients...');
  console.log('Patient reconciliation typically runs before encounter reconciliation.');
  console.log('This ensures patient identity is resolved before encounter ownership is verified.');
  console.log('');

  const patientResults = await service.runBatchPatientReconciliation({ dryRun: options.dryRun });
  console.log(`Patient reconciliation completed. Processed ${patientResults.length} patients.`);
  console.log('');

  console.log('Step 2: Reconciling encounters...');
  console.log('Encounter reconciliation runs after patient reconciliation.');
  console.log('This allows verification of patient-encounter ownership compatibility.');
  console.log('');

  const encounterResults = await service.runBatchEncounterReconciliation({ dryRun: options.dryRun });
  console.log(`Encounter reconciliation completed. Processed ${encounterResults.length} encounters.`);
  console.log('');

  return {
    patients: patientResults,
    encounters: encounterResults
  };
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
