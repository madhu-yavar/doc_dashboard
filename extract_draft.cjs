#!/usr/bin/env node
const LiveConversationDraftExtractorSkill = require('./skills/extraction/live_conversation_draft_extractor.skill.cjs');
const GemmaClientTool = require('./tools/llm/gemma_client.tool.cjs');
const { Pool } = require('pg');

const sessionId = 'live-1781587514818-4c632132';

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/doctor_dashboard',
  });

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT raw_text, normalized_text FROM transcripts WHERE live_session_id = $1 LIMIT 1',
        [sessionId]
      );

      if (result.rows.length === 0) {
        console.error('No transcript found for session:', sessionId);
        return;
      }

      const transcript = result.rows[0];
      const transcriptText = transcript.normalized_text || transcript.raw_text || '';

      console.log('Transcript length:', transcriptText.length);
      console.log('Starting draft extraction with Gemma...');

      // Create Gemma client
      const gemmaClient = new GemmaClientTool({
        url: process.env.GEMMA_URL,
        model: process.env.GEMMA_MODEL,
        timeout: 120000,
      });

      const draftExtractor = new LiveConversationDraftExtractorSkill({});

      const extractionResult = await draftExtractor.execute({
        transcript: transcriptText,
        session: { id: sessionId },
        gemmaClient, // Pass the actual client
      });

      if (extractionResult.success && extractionResult.data) {
        const draft = extractionResult.data;
        console.log('\n✓ Draft extraction success!');
        console.log('Diagnosis:', draft.diagnosis || 'none');
        console.log('Symptoms:', draft.symptoms?.length || 0);
        console.log('Medications:', draft.medications?.length || 0);
        console.log('Labs:', draft.labs?.length || 0);
        console.log('Follow-up:', draft.followUp?.length || 0);

        // Save draft to database
        const draftJson = {
          extractedData: draft,
          reviewItems: [],
          lastUpdatedAt: new Date().toISOString(),
        };

        await client.query(
          `UPDATE live_conversation_sessions
           SET draft_extraction_jsonb = $1
           WHERE id = $2`,
          [JSON.stringify(draftJson), sessionId]
        );

        console.log('\n✓ Draft saved to database');
        console.log('Refresh the UI to see the results!');
      } else {
        console.error('Draft extraction failed:', extractionResult.error);
        console.log('Extraction result:', extractionResult);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();
