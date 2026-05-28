const VADSegmentationTool = require("../../tools/audio/vad_segmentation.tool.cjs");

class VADSegmentationSkill {
  constructor(config = {}) {
    this.name = "VAD Segmentation Skill";
    this.version = "1.0.0";
    this.type = "audio_segmentation_skill";
    this.debug = config.debug || false;
    this.tool = config.tool || new VADSegmentationTool(config);
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[VADSkill] ${message}`, data);
    }
  }

  async execute(context = {}) {
    const { audioPath, options = {} } = context;
    if (!audioPath) {
      return {
        success: false,
        error: "audioPath is required",
        backend: "vad-energy",
      };
    }

    const startedAt = Date.now();

    try {
      this.log("execute", { audioPath, options });
      const data = await this.tool.execute({ audioPath, options });
      const latency = Date.now() - startedAt;

      return {
        success: true,
        data: {
          ...data,
          metadata: {
            backend: "vad-energy",
            mode: "speech_segmentation",
            latencyMs: latency,
          },
        },
        backend: "vad-energy",
        latency,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        backend: "vad-energy",
        latency: Date.now() - startedAt,
      };
    }
  }
}

module.exports = VADSegmentationSkill;
