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
const MedASRSTTSkill = require("../skills/stt/medasr_stt_skill.cjs");
const WhisperSTTSkill = require("../skills/stt/whisper_stt_skill.cjs");
const GeminiSTTSkill = require("../skills/stt/gemini_stt_skill.cjs");
const STTResultReconcilerSkill = require("../skills/stt/stt_result_reconciler_skill.cjs");
const HybridSTTReconcilerSkill = require("../skills/stt/hybrid_stt_reconciler_skill.cjs");

class STTRouterAgent {
  constructor(config = {}) {
    this.name = "STT Router Agent";
    this.version = "2.0.0"; // Updated for hybrid mode
    this.type = "stt_router_agent";

    // Configuration
    this.config = {
      primaryBackend: config.primaryBackend || process.env.STT_BACKEND || "medasr",
      enableHybrid: config.enableHybrid ?? (process.env.ENABLE_HYBRID_STT === "true"),
      enableFallback: config.enableFallback ?? true,
      debug: config.debug || false,
      timeout: config.timeout || 180000, // Increased for hybrid mode
      ...config,
    };

    // Initialize skills
    this.medasrSkill = new MedASRSTTSkill({
      endpoint: config.medasrEndpoint || process.env.MEDASR_ENDPOINT,
      timeout: config.medasrTimeout || 30000,
      maxRetries: config.medasrMaxRetries || 2,
      debug: this.config.debug,
    });

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

    this.hybridReconcilerSkill = new HybridSTTReconcilerSkill({
      gemmaUrl: config.gemmaUrl || process.env.GEMMA_URL,
      gemmaModel: config.gemmaModel || process.env.GEMMA_MODEL,
      timeout: config.hybridTimeout || 180000, // 3 minutes for LLM reconciliation
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
      medasrResult: null,
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
   * Node: Transcribe with MedASR
   */
  async transcribeMedASR(state) {
    const stepName = "transcribe_medasr";
    this.log(stepName, "Starting");

    try {
      const result = await this.medasrSkill.execute({
        audioPath: state.audioPath,
        mimeType: state.mimeType,
      });

      if (result.success) {
        console.log(`✅ [MEDASR] Transcription completed in ${result.latency}ms`);
        console.log(`   Text length: ${result.data?.rawText?.length || 0} chars`);
        this.log(stepName, "Completed", {
          backend: "medasr",
          latency: result.latency,
          textLength: result.data?.rawText?.length || 0,
        });
      } else {
        console.log(`❌ [MEDASR] Transcription failed: ${result.error}`);
        this.log(stepName, "Failed", { error: result.error });
      }

      return {
        ...state,
        medasrResult: result,
        steps: [...state.steps, {
          name: stepName,
          status: result.success ? "completed" : "failed",
          result: result.success ? { backend: "medasr", latency: result.latency } : null,
          error: result.success ? null : result.error,
        }],
      };
    } catch (error) {
      this.log(stepName, "Failed", { error: error.message });
      return {
        ...state,
        medasrResult: { success: false, error: error.message, backend: "medasr" },
        errors: [...state.errors, { step: stepName, error: error.message }],
        steps: [...state.steps, { name: stepName, status: "failed", error: error.message }],
      };
    }
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
      medasrSuccess: state.medasrResult?.success,
      whisperSuccess: state.whisperResult?.success,
      geminiSuccess: state.geminiResult?.success,
    });

    try {
      const result = await this.reconcilerSkill.execute({
        medasrResult: state.medasrResult,
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
      transcribeMedASR: this.transcribeMedASR.bind(this),
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
   *
   * Fallback chain: medASR → Whisper → Gemini
   */
  determineNextStep(state) {
    // Initial state -> decide strategy
    if (state.status === "queued") {
      return "decideStrategy";
    }

    // After strategy decision, run primary backend
    if (state.steps.some(s => s.name === "decide_strategy") &&
        !state.steps.some(s => s.name.startsWith("transcribe_"))) {
      if (state.primaryBackend === "medasr") {
        return "transcribeMedASR";
      } else if (state.primaryBackend === "whisper") {
        return "transcribeWhisper";
      } else {
        return "transcribeGemini";
      }
    }

    // Fallback chain: medASR → Whisper → Gemini
    const hasRunMedASR = state.steps.some(s => s.name === "transcribe_medasr");
    const hasRunWhisper = state.steps.some(s => s.name === "transcribe_whisper");
    const hasRunGemini = state.steps.some(s => s.name === "transcribe_gemini");

    // After medASR, check if we need fallback
    const medasrStep = state.steps.find(s => s.name === "transcribe_medasr");

    if (medasrStep && medasrStep.status === "failed" && state.enableFallback && !hasRunWhisper) {
      return "transcribeWhisper";
    }

    // After Whisper (either as primary or fallback), check if we need Gemini fallback
    const whisperStep = state.steps.find(s => s.name === "transcribe_whisper");

    if (whisperStep && whisperStep.status === "failed" && state.enableFallback && !hasRunGemini) {
      return "transcribeGemini";
    }

    // After Gemini as primary (if configured), check for Whisper fallback
    const geminiStep = state.steps.find(s => s.name === "transcribe_gemini");

    if (geminiStep && geminiStep.status === "failed" && state.enableFallback && state.primaryBackend === "gemini" && !hasRunWhisper) {
      return "transcribeWhisper";
    }

    // After all backends or successful primary, reconcile
    const hasResults = state.medasrResult || state.whisperResult || state.geminiResult;

    if (hasResults && !state.steps.some(s => s.name === "reconcile_results")) {
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
    const startTime = Date.now();

    // Check if hybrid mode is enabled
    if (this.config.enableHybrid) {
      return await this.executeHybrid(audioPath, options, startTime);
    }

    // Traditional fallback mode
    return await this.executeTraditional(audioPath, options, startTime);
  }

  /**
   * Execute with progress callback support
   */
  async executeWithProgress(audioPath, options = {}, progressCallback = null) {
    const startTime = Date.now();
    const optionsWithCallback = { ...options, progressCallback };

    // Check if hybrid mode is enabled
    if (this.config.enableHybrid) {
      return await this.executeHybrid(audioPath, optionsWithCallback, startTime);
    }

    // Traditional fallback mode
    return await this.executeTraditional(audioPath, optionsWithCallback, startTime);
  }

  /**
   * Execute in HYBRID mode: MedASR + Whisper in parallel, then Gemma reconciliation
   */
  async executeHybrid(audioPath, options, startTime) {
    const progressCallback = options.progressCallback || null;

    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                   STT ROUTER AGENT - HYBRID MODE                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  Mode: HYBRID (MedASR + Whisper → Gemma Reconciliation)                ║
║  Fallback Enabled: ${String(this.config.enableFallback).padEnd(20)}║
╚══════════════════════════════════════════════════════════════════════╝`);

    this.log("execute", "Starting HYBRID STT routing", {
      audioPath,
      mode: "hybrid",
    });

    try {
      // Step 1: Run MedASR and Whisper in parallel
      console.log(`\n⏱️  [HYBRID] Running MedASR and Whisper in parallel...`);

      if (progressCallback) {
        await progressCallback({
          stage: "parallel_transcription",
          message: "Running MedASR (medical) + Whisper (general) in parallel...",
          progress: 10,
        });
      }

      const [medasrResult, whisperResult] = await Promise.all([
        this.medasrSkill.execute({
          audioPath,
          mimeType: options.mimeType || "audio/wav",
          language: options.language || "auto",
          temperature: options.temperature || "0",
        }).catch(error => ({
          success: false,
          error: error.message,
          backend: "medasr"
        })),
        this.whisperSkill.execute({
          audioPath,
          mimeType: options.mimeType || "audio/wav",
          language: options.language || "auto",
          temperature: options.temperature || "0",
        }).catch(error => ({
          success: false,
          error: error.message,
          backend: "whisper"
        })),
      ]);

      // Log results
      console.log(`✅ [MEDASR] Transcription ${medasrResult.success ? 'completed' : 'failed'} in ${medasrResult.latency || 0}ms`);
      if (medasrResult.success) {
        console.log(`   Text length: ${medasrResult.data?.rawText?.length || 0} chars`);
      } else {
        console.log(`   Error: ${medasrResult.error}`);
      }

      console.log(`✅ [WHISPER] Transcription ${whisperResult.success ? 'completed' : 'failed'} in ${whisperResult.latency || 0}ms`);
      if (whisperResult.success) {
        console.log(`   Text length: ${whisperResult.data?.rawText?.length || 0} chars`);
      } else {
        console.log(`   Error: ${whisperResult.error}`);
      }

      if (progressCallback) {
        await progressCallback({
          stage: "parallel_transcription_complete",
          message: `✅ MedASR (${medasrResult.latency || 0}ms) + Whisper (${whisperResult.latency || 0}ms) complete`,
          progress: 40,
          medasrSuccess: medasrResult.success,
          whisperSuccess: whisperResult.success,
        });
      }

      // Step 2: Reconcile using Gemma
      console.log(`\n🧠 [HYBRID] Reconciling transcripts with Gemma...`);

      if (progressCallback) {
        await progressCallback({
          stage: "gemma_reconciliation",
          message: "🧠 Reconciling with Gemma AI (combining medical + general accuracy)...",
          progress: 50,
        });
      }

      const reconciliationResult = await this.hybridReconcilerSkill.execute({
        medasrResult,
        whisperResult,
        options: { maxRetries: 2 },
      });

      if (!reconciliationResult.success) {
        throw new Error(reconciliationResult.error || "Hybrid reconciliation failed");
      }

      console.log(`✅ [RECONCILIATION] Completed in ${reconciliationResult.latency}ms`);
      console.log(`   Tokens used: ${reconciliationResult.tokens || 0}`);
      console.log(`   Confidence: ${reconciliationResult.confidence || 'unknown'}`);
      if (reconciliationResult.rationale) {
        console.log(`   Rationale: ${reconciliationResult.rationale}`);
      }

      // Build final response
      const elapsed = Date.now() - startTime;

      const finalBackend = reconciliationResult.backend || "hybrid";

      console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                     STT ROUTER - SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════╣
║  Status: COMPLETED                                                   ║
║  Final Backend: ${finalBackend.toUpperCase().padEnd(49)}║
║  Total Time: ${elapsed}ms${" ".repeat(14)}║
║  Text Length: ${(reconciliationResult.data?.rawText?.length || 0)} chars${" ".repeat(8)}║
║  MedASR Time: ${medasrResult.latency || 0}ms${" ".repeat(14)}║
║  Whisper Time: ${whisperResult.latency || 0}ms${" ".repeat(14)}║
║  Reconciliation Time: ${reconciliationResult.latency}ms${" ".repeat(11)}║
╚══════════════════════════════════════════════════════════════════════╝`);

      return {
        success: true,
        data: reconciliationResult.data,
        status: "completed",
        backend: finalBackend,
        latency: elapsed,
        steps: [
          { name: "transcribe_medasr", status: medasrResult.success ? "completed" : "failed", latency: medasrResult.latency },
          { name: "transcribe_whisper", status: whisperResult.success ? "completed" : "failed", latency: whisperResult.latency },
          { name: "reconcile_hybrid", status: "completed", latency: reconciliationResult.latency },
        ],
        errors: [],
        audit: {
          audioPath,
          mode: "hybrid",
          enableFallback: this.config.enableFallback,
          medasrSuccess: medasrResult.success,
          whisperSuccess: whisperResult.success,
          reconciliationBackend: finalBackend,
          reconciliationTokens: reconciliationResult.tokens,
          reconciliationConfidence: reconciliationResult.confidence,
        },
      };

    } catch (error) {
      // If hybrid fails and fallback is enabled, try traditional mode
      if (this.config.enableFallback) {
        console.log(`⚠️  [HYBRID] Failed: ${error.message}`);
        console.log(`🔄 [HYBRID] Falling back to traditional mode...`);
        return await this.executeTraditional(audioPath, options, startTime);
      }

      const elapsed = Date.now() - startTime;
      console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                     STT ROUTER - SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════╣
║  Status: FAILED                                                      ║
║  Error: ${error.message.padEnd(56)}║
║  Total Time: ${elapsed}ms${" ".repeat(14)}║
╚══════════════════════════════════════════════════════════════════════╝`);

      return {
        success: false,
        error: error.message,
        backend: "hybrid",
        latency: elapsed,
        steps: [],
        errors: [error.message],
      };
    }
  }

  /**
   * Execute in TRADITIONAL mode: Sequential fallback
   */
  async executeTraditional(audioPath, options, startTime) {
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
    const elapsed = startTime ? Date.now() - startTime : (state.completedAt
      ? new Date(state.completedAt) - new Date(state.startedAt)
      : 0);

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
        medasrSuccess: state.medasrResult?.success || false,
        whisperSuccess: state.whisperResult?.success || false,
        geminiSuccess: state.geminiResult?.success || false,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
      },
    };
  }
}

module.exports = STTRouterAgent;
