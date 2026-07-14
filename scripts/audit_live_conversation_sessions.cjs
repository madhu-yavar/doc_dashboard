const fs = require("fs/promises");
const path = require("path");

const { LiveSessionsRepository } = require("../server/repositories/live_sessions_repository.cjs");

const repoRoot = path.join(__dirname, "..");
const storageDir = path.join(repoRoot, "server", "storage", "live_conversation_audio");

function parseArgs(argv = []) {
  const options = {
    json: false,
    repairStartedAt: false,
    sessionId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repair-started-at") {
      options.repairStartedAt = true;
      continue;
    }
    if (arg === "--session-id") {
      options.sessionId = argv[index + 1] || null;
      index += 1;
    }
  }

  return options;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseTranscriptEndSeconds(transcriptJson = null) {
  const segments = Array.isArray(transcriptJson?.segments) ? transcriptJson.segments : [];
  return segments.reduce((maxValue, segment) => {
    const numericEnd = Number(segment?.endSeconds);
    if (Number.isFinite(numericEnd)) return Math.max(maxValue, numericEnd);

    const label = normalizeText(segment?.endLabel || "");
    const match = label.match(/^(\d{2,}):(\d{2})$/);
    if (!match) return maxValue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return maxValue;
    return Math.max(maxValue, minutes * 60 + seconds);
  }, 0);
}

async function findSavedAudio(sessionId) {
  const candidates = [
    path.join(storageDir, `${sessionId}.webm`),
    path.join(storageDir, `${sessionId}.mp4`),
    path.join(storageDir, `${sessionId}.mp3`),
    path.join(storageDir, `${sessionId}.ogg`),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return {
          path: candidate,
          sizeBytes: stats.size,
        };
      }
    } catch {}
  }

  return null;
}

function buildFlags(row, transcriptJson, audioInfo) {
  const flags = [];
  const normalizedText = normalizeText(row.normalized_text || row.raw_text || transcriptJson?.normalizedText || transcriptJson?.rawText || "");
  const transcriptLength = normalizedText.length;
  const expectedDurationMs = Number(row.duration_ms || 0);
  const transcriptEndSeconds = parseTranscriptEndSeconds(transcriptJson);
  const coverageRatio = expectedDurationMs > 0
    ? (transcriptEndSeconds * 1000) / expectedDurationMs
    : null;

  if (!row.started_at && row.ended_at) {
    flags.push("missing_started_at");
  }
  if (row.ended_at && expectedDurationMs <= 0) {
    flags.push("missing_duration");
  }
  if (!audioInfo) {
    flags.push("missing_saved_audio");
  }
  if (expectedDurationMs >= 30000 && transcriptLength < 200) {
    flags.push("transcript_too_short_for_duration");
  }
  if (coverageRatio !== null && coverageRatio < 0.45) {
    flags.push("low_transcript_time_coverage");
  }

  return {
    flags,
    transcriptLength,
    transcriptEndSeconds,
    coverageRatio,
  };
}

async function repairStartedAt(repo, rows) {
  const repaired = [];
  for (const row of rows) {
    if (row.started_at || !row.ended_at || !Number(row.duration_ms || 0)) continue;
    const endedAtMs = new Date(row.ended_at).getTime();
    const durationMs = Number(row.duration_ms || 0);
    if (!Number.isFinite(endedAtMs) || !Number.isFinite(durationMs) || durationMs <= 0) continue;

    const inferredStartedAt = new Date(endedAtMs - durationMs).toISOString();
    await repo.updateSession(row.id, {
      started_at: inferredStartedAt,
    });
    repaired.push({
      sessionId: row.id,
      inferredStartedAt,
    });
  }
  return repaired;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = new LiveSessionsRepository();
  await repo.initialize();

  const params = [];
  const filters = [];
  if (options.sessionId) {
    params.push(options.sessionId);
    filters.push(`s.id = $${params.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = await repo.query(`
    SELECT
      s.id,
      s.status,
      s.linked_patient_label,
      s.encounter_label,
      s.started_at,
      s.ended_at,
      s.duration_ms,
      s.current_transcript_id,
      s.transport_state_jsonb,
      t.raw_text,
      t.normalized_text,
      t.transcript_jsonb
    FROM ${repo.sessionsTableName} s
    LEFT JOIN transcripts t ON t.id = s.current_transcript_id
    ${whereClause}
    ORDER BY s.updated_at DESC
  `, params);

  const report = [];
  for (const row of rows) {
    const audioInfo = await findSavedAudio(row.id);
    const transcriptJson = row.transcript_jsonb && typeof row.transcript_jsonb === "object"
      ? row.transcript_jsonb
      : {};
    const details = buildFlags(row, transcriptJson, audioInfo);
    report.push({
      sessionId: row.id,
      status: row.status,
      linkedPatient: row.linked_patient_label || "",
      encounterLabel: row.encounter_label || "",
      startedAt: row.started_at || null,
      endedAt: row.ended_at || null,
      durationMs: Number(row.duration_ms || 0),
      currentTranscriptId: row.current_transcript_id || null,
      transcriptLength: details.transcriptLength,
      transcriptEndSeconds: details.transcriptEndSeconds,
      coverageRatio: details.coverageRatio,
      audioPath: audioInfo?.path || null,
      audioSizeBytes: audioInfo?.sizeBytes || 0,
      flags: details.flags,
    });
  }

  const suspicious = report.filter((item) => item.flags.length > 0);
  const repaired = options.repairStartedAt ? await repairStartedAt(repo, rows) : [];

  const payload = {
    totalSessions: report.length,
    suspiciousSessions: suspicious.length,
    repairedStartedAt: repaired.length,
    report,
    repaired,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Live conversation sessions audited: ${payload.totalSessions}`);
  console.log(`Suspicious sessions: ${payload.suspiciousSessions}`);
  console.log(`Started-at repairs applied: ${payload.repairedStartedAt}`);

  if (suspicious.length === 0) {
    console.log("No suspicious live sessions found.");
    return;
  }

  for (const item of suspicious) {
    console.log([
      `${item.sessionId}`,
      `status=${item.status}`,
      `durationMs=${item.durationMs}`,
      `transcriptLength=${item.transcriptLength}`,
      `coverage=${item.coverageRatio === null ? "n/a" : item.coverageRatio.toFixed(2)}`,
      `flags=${item.flags.join(",")}`,
    ].join(" | "));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
