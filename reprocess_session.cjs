#!/usr/bin/env node
const LiveConversationSTTAgent = require('./agents/live_conversation_stt_agent.cjs');
const LiveConversationDraftExtractorSkill = require('./skills/extraction/live_conversation_draft_extractor.skill.cjs');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const sessionId = 'live-1781587514818-4c632132';
const audioPath = path.join(__dirname, 'server', 'storage', 'live_conversation_audio', `${sessionId}.webm`);

console.log('Reprocessing session:', sessionId);
console.log('Audio path:', audioPath);

if (!fs.existsSync(audioPath)) {
  console.error('Audio file not found:', audioPath);
  process.exit(1);
}

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/doctor_dashboard',
  });

  try {
    console.log('Starting STT transcription...');
    const sttAgent = new LiveConversationSTTAgent({ debug: true });

    const result = await sttAgent.execute({
      audioPath,
      options: {
        mode: 'fixed_window_no_vad',
        windowSeconds: 15,
        enableSpeakerDiarization: true,
        enableGeminiFallback: true,
        browserWhisperAttempts: 3,
        skipValidation: false,
      },
    });

    if (!result.success) {
      console.error('STT failed:', result.error);
      return;
    }

    const transcript = result.data;
    console.log('Transcript success!');
    console.log('Raw text length:', transcript?.rawText?.length || 0);
    console.log('Normalized text length:', transcript?.normalizedText?.length || 0);
    console.log('Segments:', transcript?.segments?.length || 0);

    // Save transcript to database
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Generate transcript ID
      const transcriptId = `transcript-${sessionId}`;
      const transcriptJson = {
        rawText: transcript.rawText || '',
        normalizedText: transcript.normalizedText || '',
        segments: transcript.segments || [],
        speakers: transcript.speakers || [],
        quality: transcript.quality || {},
        metadata: transcript.metadata || {},
      };

      // Delete existing transcript if any
      await client.query('DELETE FROM transcripts WHERE live_session_id = $1', [sessionId]);

      // Insert new transcript
      await client.query(
        `INSERT INTO transcripts (id, live_session_id, backend, language_code, raw_text, normalized_text, transcript_jsonb, quality_jsonb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          transcriptId,
          sessionId,
          transcript.backend || 'whisper',
          transcript.metadata?.language || 'en',
          transcript.rawText || '',
          transcript.normalizedText || '',
          JSON.stringify(transcriptJson),
          JSON.stringify(transcript.quality || {}),
        ]
      );

      // Update session with transcript ID
      await client.query(
        'UPDATE live_conversation_sessions SET current_transcript_id = $1 WHERE id = $2',
        [transcriptId, sessionId]
      );

      console.log('Transcript saved to database');

      // Now do draft extraction
      const transcriptText = transcript.normalizedText || transcript.rawText || '';
      if (transcriptText.length > 20) {
        console.log('Starting draft extraction...');

        // Check if LLM is configured
        const hasGemma = process.env.GEMMA_URL;
        const hasGemini = process.env.GEMINI_API_KEY;

        if (!hasGemma && !hasGemini) {
          console.error('No LLM configured. Set GEMMA_URL or GEMINI_API_KEY');
          console.log('Using heuristic draft extraction instead...');

          // Use heuristic extraction from websocket module
          const { normalizeLiveDraft } = require('./server/live_conversation_draft.cjs');
          const wsModule = require('./server/live_conversation_websocket.cjs');

          // Create a minimal instance for heuristic extraction
          const tempWs = {
            extractSymptomsFromTranscript: (t) => [],
            extractVitalsFromTranscript: () => ({ latest: { bp: {}, pulse: {}, temperature: {}, spo2: {}, weight: {} } }),
            extractPatientFromTranscript: () => ({ name: '', age: null, gender: '' }),
            extractFollowUpFromTranscript: () => [],
            extractPastHistoryFromTranscript: () => [],
            buildFallbackHpi: () => '',
            buildFallbackPlan: () => [],
          };

          const heuristicDraft = {
            diagnosis: '',
            assessment: '',
            symptoms: [],
            medications: [],
            labs: [],
            radiology: [],
            procedures: [],
            followUp: [],
            plan: [],
            patient: { name: '', age: null, gender: '' },
            vitals: { latest: { bp: {}, pulse: {}, temperature: {}, spo2: {}, weight: {} } },
            ros: [],
            hpi: '',
            pastHistory: [],
          };

          const draft = normalizeLiveDraft(heuristicDraft);

          console.log('Using basic draft (empty due to missing LLM)');
        } else {
          const draftExtractor = new LiveConversationDraftExtractorSkill({
            gemma: hasGemma ? { url: process.env.GEMMA_URL } : {},
            gemini: hasGemini ? { apiKey: process.env.GEMINI_API_KEY } : {},
          });

          const extractionResult = await draftExtractor.execute({
            transcript: transcriptText,
            session: { id: sessionId },
            geminiApiKey: process.env.GEMINI_API_KEY,
            gemmaUrl: process.env.GEMMA_URL,
          });

          if (extractionResult.success && extractionResult.data) {
            const draft = extractionResult.data;
            console.log('Draft extraction success!');
            console.log('Diagnosis:', draft.diagnosis || 'none');
            console.log('Symptoms:', draft.symptoms?.length || 0);
            console.log('Medications:', draft.medications?.length || 0);

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

            console.log('Draft saved to database');
          } else {
            console.error('Draft extraction failed:', extractionResult.error);
          }
        }
      } else {
        console.log('Transcript too short for extraction');
      }

      await client.query('COMMIT');
      console.log('All done! Refresh the UI to see the results.');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Database error:', error);
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Processing error:', error);
  } finally {
    await pool.end();
  }
}

main();
