/**
 * Agent State Management
 * Core state definitions for LangGraph-style agents
 */

class AgentState {
  constructor(initialState = {}) {
    this.state = {
      // Input
      documentPath: initialState.documentPath || null,
      documentName: initialState.documentName || null,

      // Document Analysis
      documentType: initialState.documentType || null,
      confidence: initialState.confidence || 0,
      classificationReason: initialState.classificationReason || null,

      // Page Handling
      totalPages: initialState.totalPages || 0,
      firstPageOnly: initialState.firstPageOnly || true,
      currentPageImage: initialState.currentPageImage || null,

      // OCR Content
      ocrText: initialState.ocrText || "",
      ocrConfidence: initialState.ocrConfidence || 0,

      // Agent Reasoning (ReAct)
      thoughts: initialState.thoughts || [],
      actions: initialState.actions || [],
      observations: initialState.observations || [],

      // Tool Results
      toolResults: initialState.toolResults || {},
      toolsUsed: initialState.toolsUsed || [],

      // Error Handling
      errors: initialState.errors || [],
      retryCount: initialState.retryCount || 0,
      maxRetries: initialState.maxRetries || 3,

      // Execution Status
      isComplete: initialState.isComplete || false,
      currentStep: initialState.currentStep || "initialize",
      stepHistory: initialState.stepHistory || [],

      // Timing
      startTime: initialState.startTime || Date.now(),
      endTime: initialState.endTime || null,
      duration: initialState.duration || 0,

      // Metadata
      metadata: initialState.metadata || {}
    };
  }

  /**
   * Update state with partial updates
   */
  update(updates) {
    this.state = { ...this.state, ...updates };
    return this;
  }

  /**
   * Add a thought to the reasoning chain
   */
  addThought(thought) {
    this.state.thoughts.push({
      thought,
      timestamp: Date.now(),
      step: this.state.currentStep
    });
    return this;
  }

  /**
   * Add an action to the execution history
   */
  addAction(action, params) {
    this.state.actions.push({
      action,
      params,
      timestamp: Date.now(),
      step: this.state.currentStep
    });
    this.state.toolsUsed.push(action);
    return this;
  }

  /**
   * Add an observation from tool execution
   */
  addObservation(observation, result) {
    this.state.observations.push({
      observation,
      result,
      timestamp: Date.now(),
      step: this.state.currentStep
    });
    return this;
  }

  /**
   * Store tool result
   */
  setToolResult(toolName, result) {
    this.state.toolResults[toolName] = result;
    return this;
  }

  /**
   * Add error with retry tracking
   */
  addError(error, context = {}) {
    const errorEntry = {
      error: error.message || error,
      context,
      timestamp: Date.now(),
      step: this.state.currentStep,
      retryCount: this.state.retryCount
    };
    this.state.errors.push(errorEntry);
    this.state.retryCount++;
    return this;
  }

  /**
   * Move to next step
   */
  transitionTo(step) {
    this.state.stepHistory.push(this.state.currentStep);
    this.state.currentStep = step;
    return this;
  }

  /**
   * Mark as complete
   */
  complete(result = {}) {
    this.state.isComplete = true;
    this.state.endTime = Date.now();
    this.state.duration = this.state.endTime - this.state.startTime;
    this.state = { ...this.state, ...result };
    return this;
  }

  /**
   * Get current state snapshot
   */
  toJSON() {
    return { ...this.state };
  }

  /**
   * Get summary for logging
   */
  getSummary() {
    return {
      documentType: this.state.documentType,
      confidence: this.state.confidence,
      reasoning: this.state.classificationReason,
      stepsTaken: this.state.stepHistory.length,
      toolsUsed: this.state.toolsUsed,
      thoughts: this.state.thoughts.length,
      duration: this.state.duration || Date.now() - this.state.startTime,
      errors: this.state.errors.length
    };
  }
}

module.exports = AgentState;
