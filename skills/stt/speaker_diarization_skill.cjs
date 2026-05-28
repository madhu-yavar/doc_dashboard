const PyannoteSpeakerDiarizationTool = require("../../tools/audio/pyannote_speaker_diarization.tool.cjs");
const GeminiSpeakerDiarizationTool = require("../../tools/llm/gemini_speaker_diarization.tool.cjs");

class SpeakerDiarizationSkill {
  constructor(config = {}) {
    this.name = "Speaker Diarization Skill";
    this.version = "2.0.0";
    this.type = "speaker_diarization_skill";
    this.debug = config.debug || false;
    this.timeout = config.timeout || 300000;
    this.maxRetries = config.maxRetries || 1;
    this.provider = String(config.provider || process.env.SPEAKER_DIARIZATION_PROVIDER || "pyannote").trim().toLowerCase();
    this.fallbackProvider = String(config.fallbackProvider || process.env.SPEAKER_DIARIZATION_FALLBACK || "gemini").trim().toLowerCase();
    this.allowFallback = config.allowFallback ?? (process.env.SPEAKER_DIARIZATION_ALLOW_FALLBACK === "true");
    this.pyannoteTool = config.pyannoteTool || new PyannoteSpeakerDiarizationTool({
      ...config,
      timeout: config.pyannoteTimeout ?? config.timeout,
    });
    this.geminiTool = config.geminiTool || new GeminiSpeakerDiarizationTool({
      ...config,
      timeout: config.geminiTimeout ?? config.timeout,
    });
  }

  log(message, data = {}) {
    if (this.debug) {
      console.log(`[SpeakerDiarizationSkill] ${message}`, data);
    }
  }

  getTool(provider) {
    if (provider === "pyannote") {
      return this.pyannoteTool;
    }
    if (provider === "gemini") {
      return this.geminiTool;
    }
    return null;
  }

  buildBackendName(provider) {
    return provider === "pyannote" ? "pyannote_diarization" : "gemini_diarization";
  }

  buildProviderChain(options = {}) {
    const provider = String(options.provider || this.provider || "pyannote").trim().toLowerCase();
    const allowFallback = options.allowFallback ?? this.allowFallback;
    const fallbackProvider = String(options.fallbackProvider || this.fallbackProvider || "").trim().toLowerCase();
    const chain = [provider];

    if (allowFallback && fallbackProvider && fallbackProvider !== provider) {
      chain.push(fallbackProvider);
    }

    return chain.filter(Boolean);
  }

  async execute(context = {}) {
    const { audioPath, mimeType, transcriptHint, options = {} } = context;

    if (!audioPath) {
      return {
        success: false,
        error: "audioPath is required",
        backend: this.buildBackendName(this.provider),
      };
    }

    const startedAt = Date.now();
    const providerChain = this.buildProviderChain(options);

    for (let index = 0; index < providerChain.length; index += 1) {
      const provider = providerChain[index];
      const tool = this.getTool(provider);
      const backend = this.buildBackendName(provider);
      if (!tool) {
        continue;
      }

      try {
        this.log("execute", { audioPath, mimeType, provider });
        const result = await tool.execute(audioPath, {
          mimeType: mimeType || options.mimeType || "audio/mpeg",
          transcriptHint,
          maxRetries: options.maxRetries ?? this.maxRetries,
          temperature: options.temperature ?? 0.1,
          maxTokens: options.maxTokens ?? 4096,
          includeRoles: options.includeRoles ?? true,
          numSpeakers: options.numSpeakers,
          minSpeakers: options.minSpeakers,
          maxSpeakers: options.maxSpeakers,
          windowSeconds: options.windowSeconds,
          windowOverlapSeconds: options.windowOverlapSeconds,
          windowedThresholdSeconds: options.windowedThresholdSeconds,
        });

        if (!result.success) {
          if (index < providerChain.length - 1) {
            this.log("provider_fallback", { provider, error: result.error });
            continue;
          }
          return {
            success: false,
            error: result.error || "Speaker diarization failed",
            backend,
            latency: Date.now() - startedAt,
          };
        }

        return {
          success: true,
          data: {
            ...result.data,
            metadata: {
              ...(result.data?.metadata || {}),
              backend,
              provider,
              model: result.model || result.data?.metadata?.model || null,
              fallbackUsed: index > 0,
              fallbackFrom: index > 0 ? providerChain[index - 1] : null,
            },
          },
          usage: result.usage || null,
          backend,
          model: result.model || null,
          latency: Date.now() - startedAt,
        };
      }
      catch (error) {
        if (index < providerChain.length - 1) {
          this.log("provider_error_fallback", { provider, error: error?.message || String(error) });
          continue;
        }
        return {
          success: false,
          error: error?.message || String(error),
          backend,
          latency: Date.now() - startedAt,
        };
      }
    }

    return {
      success: false,
      error: "No speaker diarization provider is configured",
      backend: this.buildBackendName(this.provider),
      latency: Date.now() - startedAt,
    };
  }
}

module.exports = SpeakerDiarizationSkill;
