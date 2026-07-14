/**
 * Live Session Repair Script
 *
 * This script repairs existing live conversation sessions to work with the new status mapping layer.
 * It ensures sessions have proper context for correct DB→UI status mapping.
 *
 * Run this after deploying the status mapping fix to restore visibility of past conversations.
 */

const { LiveSessionsRepository } = require('./server/repositories/live_sessions_repository.cjs');
const path = require('path');

async function repairLiveSessions() {
  console.log('🔧 Starting live session repair...\n');

  try {
    // Initialize repository
    const liveSessionsRepo = new LiveSessionsRepository();
    await liveSessionsRepo.initialize();

    // Get all sessions
    const sessions = await liveSessionsRepo.query(`
      SELECT id, status, linked_patient_label, encounter_label,
             transport_state_jsonb, draft_extraction_jsonb,
             started_at, ended_at, updated_at
      FROM ${liveSessionsRepo.sessionsTableName}
      ORDER BY started_at DESC
    `);

    console.log(`📊 Found ${sessions.length} live conversation sessions\n`);

    let repairedCount = 0;
    let skippedCount = 0;

    for (const session of sessions) {
      console.log(`🔍 Session: ${session.id}`);
      console.log(`   Current DB status: ${session.status}`);
      console.log(`   Patient: ${session.linked_patient_label || 'N/A'}`);
      console.log(`   Encounter: ${session.encounter_label || 'N/A'}`);

      // Parse existing JSONB fields
      const transportState = session.transport_state_jsonb || {};
      const draftExtraction = session.draft_extraction_jsonb || {};

      // Check for issues that need repair
      let needsRepair = false;
      let repairs = [];

      // Check transport state
      if (!transportState.connectionState) {
        transportState.connectionState = 'idle';
        repairs.push('Set transport.connectionState to idle');
        needsRepair = true;
      }

      // Check draft extraction structure
      if (!draftExtraction.extracted_data) {
        draftExtraction.extracted_data = {};
        repairs.push('Initialized draft extraction data');
        needsRepair = true;
      }

      if (!draftExtraction.review_items) {
        draftExtraction.review_items = [];
        repairs.push('Initialized review items array');
        needsRepair = true;
      }

      // Apply repairs if needed
      if (needsRepair) {
        console.log(`   🛠️  Repairs needed:`);
        repairs.forEach(repair => console.log(`      - ${repair}`));

        await liveSessionsRepo.query(`
          UPDATE ${liveSessionsRepo.sessionsTableName}
          SET transport_state_jsonb = $1,
              draft_extraction_jsonb = $2,
              updated_at = NOW()
          WHERE id = $3
        `, [JSON.stringify(transportState), JSON.stringify(draftExtraction), session.id]);

        console.log(`   ✅ Repairs applied`);
        repairedCount++;
      } else {
        console.log(`   ✅ Session healthy - no repairs needed`);
        skippedCount++;
      }

      // Show what UI status this will map to
      const uiStatus = mapDbStatusToUiStatus(session.status, {
        hasTranscript: false, // We'll check this below
        hasReviewItems: (draftExtraction.review_items || []).length > 0,
        isRecording: transportState.connectionState === 'connected',
        isPaused: transportState.connectionState === 'paused',
        isFinalizing: false
      });
      console.log(`   → Will display as UI status: ${uiStatus}\n`);
    }

    console.log('📈 Repair Summary:');
    console.log(`   Total sessions: ${sessions.length}`);
    console.log(`   Repaired: ${repairedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log('\n✅ Live session repair complete!\n');

    // Show status mapping reference
    console.log('📋 Status Mapping Reference:');
    console.log('   DB Status → UI Status');
    console.log('   ─────────────────────────');
    console.log('   active    → draft (default)');
    console.log('   active    → live (if recording or has transcript)');
    console.log('   active    → paused (if paused)');
    console.log('   active    → review_required (if has review items)');
    console.log('   active    → finalizing (if finalizing)');
    console.log('   ended     → finalized');
    console.log('   abandoned → failed');
    console.log('\n');

  } catch (error) {
    console.error('❌ Repair failed:', error);
    process.exit(1);
  }
}

// DB → UI status mapping (copied from live_conversation_store.cjs)
function mapDbStatusToUiStatus(dbStatus, uiContext = {}) {
  switch (dbStatus) {
    case 'active':
      // Map 'active' to appropriate UI state based on context
      if (uiContext.hasTranscript || uiContext.isRecording) return 'live';
      if (uiContext.isPaused) return 'paused';
      if (uiContext.hasReviewItems) return 'review_required';
      if (uiContext.isFinalizing) return 'finalizing';
      return 'draft'; // Default for newly created active sessions
    case 'ended':
      return 'finalized';
    case 'abandoned':
      return 'failed';
    default:
      // Fallback for unknown statuses - treat as active/draft
      return 'draft';
  }
}

// Run the repair
if (require.main === module) {
  repairLiveSessions()
    .then(() => {
      console.log('✅ Repair script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Repair script failed:', error);
      process.exit(1);
    });
}

module.exports = { repairLiveSessions };