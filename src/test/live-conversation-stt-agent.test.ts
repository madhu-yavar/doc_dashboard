import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LiveConversationSTTAgent = require("../../agents/live_conversation_stt_agent.cjs");

describe("LiveConversationSTTAgent browser diarization", () => {
  const audioPath = path.join(os.tmpdir(), `live-browser-diarization-${process.pid}.mp4`);

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.unlinkSync(audioPath);
    } catch {}
  });

  it("applies diarization labels to browser-recorded whisper_direct segments", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({ debug: false });
    agent.whisperSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Doctor hello. Patient thanks.",
          normalizedText: "Doctor hello. Patient thanks.",
          segments: [
            {
              id: "seg-1",
              startLabel: "00:00",
              endLabel: "00:02",
              startSeconds: 0,
              endSeconds: 2,
              text: "Doctor hello.",
              normalizedText: "Doctor hello.",
              flags: [],
              status: "final",
            },
            {
              id: "seg-2",
              startLabel: "00:02",
              endLabel: "00:04",
              startSeconds: 2,
              endSeconds: 4,
              text: "Patient thanks.",
              normalizedText: "Patient thanks.",
              flags: [],
              status: "final",
            },
          ],
          quality: {
            overallConfidence: 0.94,
          },
        },
      })),
    };
    agent.runSpeakerDiarization = vi.fn(async () => ({
      backend: "pyannote",
      speakers: [
        { id: "spk_1", label: "Speaker 1", role: "doctor" },
        { id: "spk_2", label: "Speaker 2", role: "patient" },
      ],
      segments: [
        {
          speakerId: "spk_1",
          speakerRole: "doctor",
          speakerLabel: "Speaker 1",
          startSeconds: 0,
          endSeconds: 2,
        },
        {
          speakerId: "spk_2",
          speakerRole: "patient",
          speakerLabel: "Speaker 2",
          startSeconds: 2,
          endSeconds: 4,
        },
      ],
    }));

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBe("whisper_direct");
    expect(agent.runSpeakerDiarization).toHaveBeenCalledTimes(1);
    expect(result.data.segments).toHaveLength(2);
    expect(result.data.segments[0]).toMatchObject({
      speakerRole: "doctor",
      speakerLabel: "Speaker 1",
      speakerId: "spk_1",
    });
    expect(result.data.segments[1]).toMatchObject({
      speakerRole: "patient",
      speakerLabel: "Speaker 2",
      speakerId: "spk_2",
    });
    expect(result.data.speakers).toEqual([
      { id: "spk_1", label: "Speaker 1", role: "doctor", confidence: null },
      { id: "spk_2", label: "Speaker 2", role: "patient", confidence: null },
    ]);
    expect(result.data.quality.speakerAmbiguityCount).toBe(0);
  });

  it("treats token-only transcripts as unusable and falls back for browser recordings", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({
      debug: false,
      enableGeminiFallback: true,
    });
    agent.whisperSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "</s>",
          normalizedText: "</s>",
          segments: [],
          quality: {
            overallConfidence: 0.99,
          },
        },
      })),
    };
    agent.medasrSkill = {
      execute: vi.fn(async () => ({
        success: false,
        error: "medasr unavailable",
      })),
    };
    agent.geminiSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Patient has fever for two days.",
          normalizedText: "Patient has fever for two days.",
        },
        backend: "gemini",
      })),
    };
    agent.runSpeakerDiarization = vi.fn(async () => null);

    expect(agent.hasUsableTranscriptResult({
      success: true,
      data: { rawText: "</s>", normalizedText: "</s>" },
    })).toBe(false);

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBe("gemini_browser_fallback");
    expect(result.data.normalizedText).toBe("Patient has fever for two days.");
    expect(agent.geminiSkill.execute).toHaveBeenCalledTimes(1);
    expect(agent.runSpeakerDiarization).toHaveBeenCalledTimes(1);
  });

  it("returns whisper_direct browser transcripts without throwing when diarization is disabled", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({ debug: false });
    agent.whisperSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Patient reports dysuria for two days.",
          normalizedText: "Patient reports dysuria for two days.",
          segments: [
            {
              id: "seg-1",
              startLabel: "00:00",
              endLabel: "00:03",
              startSeconds: 0,
              endSeconds: 3,
              text: "Patient reports dysuria for two days.",
              normalizedText: "Patient reports dysuria for two days.",
              flags: [],
              status: "final",
            },
          ],
          speakers: [],
          quality: {
            overallConfidence: 0.93,
          },
        },
      })),
    };
    agent.runSpeakerDiarization = vi.fn(async () => null);

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBe("whisper_direct");
    expect(result.data.normalizedText).toBe("Patient reports dysuria for two days.");
    expect(result.data.speakers).toEqual([]);
    expect(agent.runSpeakerDiarization).not.toHaveBeenCalled();
  });

  it("retries low-coverage browser whisper transcripts and keeps the fuller retry for long recordings", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({ debug: false });
    agent.whisperSkill = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          data: {
            rawText: "Short prefix only.",
            normalizedText: "Short prefix only.",
            segments: [
              {
                id: "seg-1",
                startLabel: "00:00",
                endLabel: "00:30",
                startSeconds: 0,
                endSeconds: 30,
                text: "Short prefix only.",
                normalizedText: "Short prefix only.",
                flags: [],
                status: "final",
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            rawText: "Patient reports fever and cough. ".repeat(90).trim(),
            normalizedText: "Patient reports fever and cough. ".repeat(90).trim(),
            segments: [
              {
                id: "seg-1",
                startLabel: "00:00",
                endLabel: "03:40",
                startSeconds: 0,
                endSeconds: 220,
                text: "Patient reports fever and cough. ".repeat(90).trim(),
                normalizedText: "Patient reports fever and cough. ".repeat(90).trim(),
                flags: [],
                status: "final",
              },
            ],
          },
        }),
    };
    agent.runSpeakerDiarization = vi.fn(async () => null);

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: false,
        expectedDurationMs: 240000,
      },
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBe("whisper_direct");
    expect(agent.whisperSkill.execute).toHaveBeenCalledTimes(2);
    expect(result.data.normalizedText.length).toBeGreaterThan(2000);
  });

  it("falls back to gemini when browser whisper coverage stays too low for a long final recording", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({
      debug: false,
      enableGeminiFallback: true,
    });
    agent.whisperSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Short prefix only.",
          normalizedText: "Short prefix only.",
          segments: [
            {
              id: "seg-1",
              startLabel: "00:00",
              endLabel: "00:25",
              startSeconds: 0,
              endSeconds: 25,
              text: "Short prefix only.",
              normalizedText: "Short prefix only.",
              flags: [],
              status: "final",
            },
          ],
        },
      })),
    };
    agent.medasrSkill = {
      execute: vi.fn(async () => ({
        success: false,
        error: "medasr unavailable",
      })),
    };
    agent.geminiSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Patient reports fever and cough. ".repeat(120).trim(),
          normalizedText: "Patient reports fever and cough. ".repeat(120).trim(),
        },
        backend: "gemini",
      })),
    };
    agent.runSpeakerDiarization = vi.fn(async () => null);

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: false,
        enableGeminiFallback: true,
        browserWhisperAttempts: 1,
        expectedDurationMs: 240000,
      },
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBe("gemini_browser_fallback");
    expect(result.data.normalizedText.length).toBeGreaterThan(2500);
    expect(agent.geminiSkill.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects fragmentary short browser fallback transcripts and prefers gemini for short recordings", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({
      debug: false,
      enableGeminiFallback: true,
    });
    agent.whisperSkill = {
      execute: vi.fn(async () => ({
        success: false,
        error: "whisper timeout",
      })),
    };
    agent.medasrSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "of more ab pressure sh",
          normalizedText: "of more ab pressure sh",
          segments: [
            {
              id: "seg-1",
              startLabel: "00:00",
              endLabel: "00:04",
              startSeconds: 0,
              endSeconds: 4,
              text: "of more ab pressure sh",
              normalizedText: "of more ab pressure sh",
              flags: [],
              status: "final",
            },
          ],
        },
      })),
    };
    agent.geminiSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Patient reports chest pressure and shortness of breath for three days.",
          normalizedText: "Patient reports chest pressure and shortness of breath for three days.",
        },
        backend: "gemini",
      })),
    };
    agent.runSpeakerDiarization = vi.fn(async () => null);

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: false,
        enableGeminiFallback: true,
        browserWhisperAttempts: 1,
        expectedDurationMs: 15000,
      },
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBe("gemini_browser_fallback");
    expect(result.data.normalizedText).toContain("chest pressure");
    expect(agent.geminiSkill.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects clinical-note-shaped browser candidates when artifact rejection is enabled", async () => {
    fs.writeFileSync(audioPath, Buffer.from("stub-audio"));

    const agent = new LiveConversationSTTAgent({
      debug: false,
      enableGeminiFallback: true,
    });
    agent.whisperSkill = {
      execute: vi.fn(async () => ({
        success: false,
        error: "whisper unavailable",
      })),
    };
    agent.medasrSkill = {
      execute: vi.fn(async () => ({
        success: false,
        error: "medasr unavailable",
      })),
    };
    agent.geminiSkill = {
      execute: vi.fn(async () => ({
        success: true,
        data: {
          rawText: "Subjective: The patient is a 45-year-old male who presents for follow-up of hypertension. Objective: Vital signs are stable. Assessment and Plan: Hypertension, well-controlled. Follow up in 6 months.",
          normalizedText: "Subjective: The patient is a 45-year-old male who presents for follow-up of hypertension. Objective: Vital signs are stable. Assessment and Plan: Hypertension, well-controlled. Follow up in 6 months.",
          segments: [
            {
              id: "seg-1",
              startLabel: "00:00",
              endLabel: "00:20",
              startSeconds: 0,
              endSeconds: 20,
              text: "Subjective: The patient is a 45-year-old male who presents for follow-up of hypertension. Objective: Vital signs are stable. Assessment and Plan: Hypertension, well-controlled. Follow up in 6 months.",
              normalizedText: "Subjective: The patient is a 45-year-old male who presents for follow-up of hypertension. Objective: Vital signs are stable. Assessment and Plan: Hypertension, well-controlled. Follow up in 6 months.",
            },
          ],
        },
        backend: "gemini",
      })),
    };

    const result = await agent.execute({
      audioPath,
      options: {
        mimeType: "audio/mp4",
        enableSpeakerDiarization: false,
        enableGeminiFallback: true,
        rejectClinicalNoteArtifacts: true,
        browserWhisperAttempts: 1,
        expectedDurationMs: 65000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("whisper unavailable");
    expect(agent.geminiSkill.execute).toHaveBeenCalledTimes(1);
  });
});
