/**
 * STT Router Agent
 * LangGraph-based orchestrator for Speech-to-Text transcription
 *
 * Features:
 * - Switchable backends (Whisper, Gemini)
 * - Automatic fallback on failure
 * - Quality-based result selection
 * - Comprehensive audit trail
 */

const { StateGraph } = require("@langchain/langgraph");

// Import STT skills
const WhisperSTTSkill = require("../skills/stt/whisper_stt_skill.cjs");
const GeminiSTTSkill = require("../skills/stt/gemini_stt_skill.cjs");
const STTResultReconcilerSkill = require("../skills/stt/stt_result_reconciler_skill.cjs");

class STTRouterAgent {
  constructor(config = {}) {
    this.name = "STT Router Agent";
    this.version = "1.0.0";
    this.type = "stt_router_agent";

    // Configuration
    this.config = {
      primaryBackend: config.primaryBackend || process.env.STT_BACKEND || "whisper",
      enableFallback: config.enableFallback ?? true,
      debug: config.debug || false,
      timeout: config.timeout || 120000,
      ...config,
    };

    // Initialize skills
    this.whisperSkill = new WhisperSTTSkill({
      url: config.whisperUrl || process.env.WHISPER_STT_URL,
      language: config.language || process.env.WHISPER_LANGUAGE || "auto",
      temperature: config.temperature || process.env.WHISPER_TEMPERATURE || "0",
      timeout: config.whisperTimeout || 60000,
      maxRetries: config.whisperMaxRetries || 2,
      debug: this.config.debug,
    });

    this.geminiSkill = new GeminiSTTSkill({
      model: config.geminiModel || process.env.VOICE_GEMINI_MODEL || process.env.GEMINI_MODEL,
      apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY,
      timeout: config.geminiTimeout || 300000,
      maxRetries: config.geminiMaxRetries || 2,
      debug: this.config.debug,
    });

    this.reconcilerSkill = new STTResultReconcilerSkill({
      debug: this.config.debug,
    });

    // Build the graph
    this.graph = this.buildGraph();
  }

  log(step, status, details = {}) {
    if (!this.config.debug) return;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [STTRouter] [${step}] ${status}`, details);
  }

  /**
   * Define the STTState structure
   * This is the state that flows through the LangGraph nodes
   */
  createInitialState(audioPath, options = {}) {
    return {
      // Input
      audioPath,
      mimeType: options.mimeType || "audio/wav",
      language: options.language || "auto",
      temperature: options.temperature || "0",

      // Strategy
      primaryBackend: this.config.primaryBackend,
      enableFallback: this.config.enableFallback,

      // Results
      whisperResult: null,
      geminiResult: null,
      selectedResult: null,

      // Audit trail
      steps: [],
      errors: [],

      // Status
      status: "queued",
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  /**
   * Node: Decide Strategy
   * Determines which backend(s) to use
   */
  async decideStrategy(state) {
    const stepName = "decide_strategy";
    this.log(stepName, "Starting", { primaryBackend: state.primaryBackend });

    return {
      ...state,
      status: "processing",
      steps: [...state.steps, {
        name: stepName,
        status: "completed",
        result: { primaryBackend: state.primaryBackend, enableFallback: state.enableFallback }
      }],
    };
  }

  /**
   * Node: Transcribe with Whisper
   */
  async transcribeWhisper(state) {
    const stepName = "transcribe_whisper";
    this.log(stepName, "Starting");

    try {
      const result = await this.whisperSkill.execute({
        audioPath: state.audioPath,
        mimeType: state.mimeType,
        language: state.language,
        temperature: state.temperature,
      });

      if (result.success) {
        console.log(`✅ [WHISPER] Transcription completed in ${result.latency}ms`);
        console.log(`   Text length: ${result.data?.rawText?.length || 0} chars`);
        this.log(stepName, "Completed", {
          backend: "whisper",
          latency: result.latency,
          textLength: result.data?.rawText?.length || 0,
        });
      } else {
        console.log(`❌ [WHISPER] Transcription failed: ${result.error}`);
        this.log(stepName, "Failed", { error: result.error });
      }

      return {
        ...state,
        whisperResult: result,
        steps: [...state.steps, {
          name: stepName,
          status: result.success ? "completed" : "failed",
          result: result.success ? { backend: "whisper", latency: result.latency } : null,
          error: result.success ? null : result.error,
        }],
      };
    } catch (error) {
      this.log(stepName, "Failed", { error: error.message });
      return {
        ...state,
        whisperResult: { success: false, error: error.message, backend: "whisper" },
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }],
      };
    }
  }

  /**
   * Node: Transcribe with Gemini
   */
  async transcribeGemini(state) {
    const stepName = "transcribe_gemini";
    this.log(stepName, "Starting");

    try {
      const result = await this.geminiSkill.execute({
        audioPath: state.audioPath,
        mimeType: state.mimeType,
        options: { maxRetries: 2 },
      });

      if (result.success) {
        console.log(`✅ [GEMINI] Transcription completed in ${result.latency}ms`);
        console.log(`   Text length: ${result.data?.rawText?.length || 0} chars`);
        this.log(stepName, "Completed", {
          backend: "gemini",
          latency: result.latency,
          textLength: result.data?.rawText?.length || 0,
        });
      } else {
        console.log(`❌ [GEMINI] Transcription failed: ${result.error}`);
        this.log(stepName, "Failed", { error: result.error });
      }

      return {
        ...state,
        geminiResult: result,
        steps: [...state.steps, {
          name: stepName,
          status: result.success ? "completed" : "failed",
          result: result.success ? { backend: "gemini", latency: result.latency } : null,
          error: result.success ? null : result.error,
        }],
      };
    } catch (error) {
      this.log(stepName, "Failed", { error: error.message });
      return {
        ...state,
        geminiResult: { success: false, error: error.message, backend: "gemini" },
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }],
      };
    }
  }

  /**
   * Node: Reconcile Results
   * Selects the best transcript from available results
   */
  async reconcileResults(state) {
    const stepName = "reconcile_results";
    this.log(stepName, "Starting", {
      whisperSuccess: state.whisperResult?.success,
      geminiSuccess: state.geminiResult?.success,
    });

    try {
      const result = await this.reconcilerSkill.execute({
        whisperResult: state.whisperResult,
        geminiResult: state.geminiResult,
        primaryBackend: state.primaryBackend,
      });

      if (result.success) {
        if (result.fallback) {
          console.log(`🔄 [FALLBACK] Primary backend failed, using ${result.source.toUpperCase()}`);
        } else {
          console.log(`✅ [SELECTED] Using ${result.source.toUpperCase()} backend`);
        }
        console.log(`   Reason: ${result.reason}`);
        this.log(stepName, "Completed", {
          selected: result.source,
          reason: result.reason,
          fallback: result.fallback,
        });
      } else {
        console.log(`❌ [RECONCILE] No valid transcripts available`);
        this.log(stepName, "Failed", { error: result.error || "No valid transcripts" });
      }

      return {
        ...state,
        selectedResult: result.success ? result.selected : null,
        steps: [...state.steps, {
          name: stepName,
          status: result.success ? "completed" : "failed",
          result: result.success ? { source: result.source, reason: result.reason } : null,
          error: result.success ? null : result.error,
        }],
      };
    } catch (error) {
      this.log(stepName, "Failed", { error: error.message });
      return {
        ...state,
        selectedResult: null,
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }],
      };
    }
  }

  /**
   * Node: Handle Failure
   * Final error handling
   */
  async handleFailure(state) {
    const stepName = "handle_failure";
    this.log(stepName, "No valid transcripts available");

    return {
      ...state,
      status: "failed",
      completedAt: new Date().toISOString(),
      steps: [...state.steps, {
        name: stepName,
        status: "completed",
        result: { message: "All backends failed" }
      }],
    };
  }

  /**
   * Node: Finalize
   * Mark as completed
   */
  async finalize(state) {
    const stepName = "finalize";
    this.log(stepName, "Completed successfully", {
      backend: state.selectedResult?.metadata?.backend,
    });

    return {
      ...state,
      status: "completed",
      completedAt: new Date().toISOString(),
      steps: [...state.steps, {
        name: stepName,
        status: "completed",
      }],
    };
  }

  /**
   * Build the LangGraph
   * Defines the state machine for STT routing
   */
  buildGraph() {
    // Nodes
    const nodes = {
      decideStrategy: this.decideStrategy.bind(this),
      transcribeWhisper: this.transcribeWhisper.bind(this),
      transcribeGemini: this.transcribeGemini.bind(this),
      reconcileResults: this.reconcileResults.bind(this),
      handleFailure: this.handleFailure.bind(this),
      finalize: this.finalize.bind(this),
    };

    return { nodes };
  }

  /**
   * Route function for sequential execution
   * Determines the next node based on current state
   */
  determineNextStep(state) {
    // Initial state -> decide strategy
    if (state.status === "queued") {
      return "decideStrategy";
    }

    // After strategy decision, run primary backend
    if (state.steps.some(s => s.name === "decide_strategy") &&
        !state.steps.some(s => s.name.startsWith("transcribe_"))) {
      if (state.primaryBackend === "whisper") {
        return "transcribeWhisper";
      } else {
        return "transcribeGemini";
      }
    }

    // After primary backend, check if we need fallback
    const primaryStep = state.steps.find(s =>
      s.name === `transcribe_${state.primaryBackend}`
    );

    if (primaryStep && primaryStep.status === "failed" && state.enableFallback) {
      // Primary failed, try fallback
      if (state.primaryBackend === "whisper") {
        return !state.steps.some(s => s.name === "transcribe_gemini")
          ? "transcribeGemini"
          : "reconcileResults";
      } else {
        return !state.steps.some(s => s.name === "transcribe_whisper")
          ? "transcribeWhisper"
          : "reconcileResults";
      }
    }

    // After both backends or successful primary, reconcile
    if ((state.whisperResult || state.geminiResult) &&
        !state.steps.some(s => s.name === "reconcile_results")) {
      return "reconcileResults";
    }

    // After reconciliation, finalize or fail
    if (state.steps.some(s => s.name === "reconcile_results")) {
      if (state.selectedResult) {
        return !state.steps.some(s => s.name === "finalize")
          ? "finalize"
          : null; // Done
      } else {
        return !state.steps.some(s => s.name === "handle_failure")
          ? "handleFailure"
          : null; // Done
      }
    }

    return null; // Done
  }

  /**
   * Execute the STT routing workflow
   */
  async execute(audioPath, options = {}) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                        STT ROUTER AGENT                              ║
╠══════════════════════════════════════════════════════════════════════╣
║  Primary Backend: ${this.config.primaryBackend.toUpperCase().padEnd(20)}║
║  Fallback Enabled: ${String(this.config.enableFallback).padEnd(20)}║
╚══════════════════════════════════════════════════════════════════════╝`);
    this.log("execute", "Starting STT routing", {
      audioPath,
      primaryBackend: this.config.primaryBackend,
    });

    // Initialize state
    let state = this.createInitialState(audioPath, options);

    // Execute nodes sequentially
    const nodes = this.graph.nodes;

    let nextStep = this.determineNextStep(state);
    let maxIterations = 20; // Safety limit
    let iterations = 0;

    while (nextStep && iterations < maxIterations) {
      iterations++;

      if (nodes[nextStep]) {
        state = await nodes[nextStep](state);
        nextStep = this.determineNextStep(state);
      } else {
        this.log("execute", `Unknown step: ${nextStep}`);
        break;
      }
    }

    if (iterations >= maxIterations) {
      this.log("execute", "Max iterations reached");
      state.status = "failed";
      state.completedAt = new Date().toISOString();
    }

    // Build final response
    const success = state.status === "completed" && !!state.selectedResult;
    const elapsed = state.completedAt
      ? new Date(state.completedAt) - new Date(state.startedAt)
      : 0;

    this.log("execute", "Finished", {
      success,
      status: state.status,
      elapsed,
      stepsCount: state.steps.length,
      errorsCount: state.errors.length,
    });

    // Print final summary to console
    const finalBackend = state.selectedResult?.metadata?.backend || "none";
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                     STT ROUTER - SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════╣
║  Status: ${(state.status).toUpperCase().padEnd(20)}║
║  Final Backend: ${finalBackend.toUpperCase().padEnd(15)}║
║  Total Time: ${elapsed}ms${" ".repeat(14)}║
║  Text Length: ${(state.selectedResult?.rawText?.length || 0)} chars${" ".repeat(8)}║
╚══════════════════════════════════════════════════════════════════════╝`);

    return {
      success,
      data: state.selectedResult,
      status: state.status,
      backend: state.selectedResult?.metadata?.backend || null,
      latency: elapsed,
      steps: state.steps,
      errors: state.errors,
      audit: {
        audioPath: state.audioPath,
        primaryBackend: state.primaryBackend,
        enableFallback: state.enableFallback,
        whisperSuccess: state.whisperResult?.success || false,
        geminiSuccess: state.geminiResult?.success || false,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
      },
    };
  }
}

module.exports = STTRouterAgent;
