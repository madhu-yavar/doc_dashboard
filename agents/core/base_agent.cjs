/**
 * Base Agent Class
 * Provides common functionality for all agents using ReAct pattern
 */

const AgentState = require("./agent_state.cjs");

class BaseAgent {
  constructor(config = {}) {
    this.name = config.name || "BaseAgent";
    this.version = config.version || "1.0.0";
    this.config = config;
    this.tools = {};
    this.maxIterations = config.maxIterations || 10;
    this.debug = config.debug || false;
  }

  /**
   * Register a tool that this agent can use
   */
  registerTool(name, tool) {
    this.tools[name] = {
      fn: tool.fn,
      description: tool.description,
      parameters: tool.parameters || {},
      category: tool.category || "general"
    };
    return this;
  }

  /**
   * Get tool descriptions for LLM prompting
   */
  getToolDescriptions(includeCategory = true) {
    return Object.entries(this.tools)
      .map(([name, tool]) => {
        const category = includeCategory && tool.category
          ? `[${tool.category}] `
          : "";
        return `- ${name}: ${category}${tool.description}`;
      })
      .join("\n");
  }

  /**
   * Execute a tool by name
   */
  async executeTool(toolName, params = {}) {
    if (!this.tools[toolName]) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    this.log(`Executing tool: ${toolName}`, params);

    const startTime = Date.now();
    try {
      const result = await this.tools[toolName].fn(params);
      const duration = Date.now() - startTime;

      this.log(`Tool ${toolName} completed in ${duration}ms`);

      return {
        success: true,
        result,
        duration,
        tool: toolName
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`Tool ${toolName} failed: ${error.message}`);

      return {
        success: false,
        error: error.message,
        duration,
        tool: toolName
      };
    }
  }

  /**
   * THINK: Generate reasoning about current state
   * Override in subclass for specific behavior
   */
  async think(state) {
    throw new Error("think() must be implemented by subclass");
  }

  /**
   * ACT: Parse thought and decide action
   * Override in subclass for specific behavior
   */
  parseAction(thought, state) {
    throw new Error("parseAction() must be implemented by subclass");
  }

  /**
   * DECIDE: Check if agent should continue or stop
   * Override in subclass for specific behavior
   */
  shouldContinue(state) {
    throw new Error("shouldContinue() must be implemented by subclass");
  }

  /**
   * Main ReAct loop execution
   */
  async execute(initialState) {
    const state = new AgentState(initialState);

    this.log(`Starting ${this.name} execution`, {
      document: state.state.documentName
    });

    let iteration = 0;

    while (iteration < this.maxIterations && !state.state.isComplete) {
      iteration++;
      this.log(`Iteration ${iteration}/${this.maxIterations}`);

      // THINK: Analyze current state and decide next action
      const thought = await this.think(state);

      // Add thought to state
      state.addThought(thought.reasoning);

      this.log("Thought:", thought.reasoning);

      // ACT: Parse action and execute tool if needed
      if (thought.action && thought.action.tool) {
        state.addAction(thought.action.tool, thought.action.params);

        // Normalize parameters - inject documentPath if tool expects it
        const params = this.normalizeParams(thought.action.tool, thought.action.params, state);

        const toolResult = await this.executeTool(
          thought.action.tool,
          params
        );

        // OBSERVE: Update state with tool result
        state.addObservation(
          `Result of ${thought.action.tool}`,
          toolResult
        );
        state.setToolResult(thought.action.tool, toolResult);

        // Check if tool failed
        if (!toolResult.success && state.state.retryCount >= state.state.maxRetries) {
          state.addError(new Error(toolResult.error), { tool: thought.action.tool });
        }
      }

      // DECIDE: Should we continue?
      const shouldContinue = await this.shouldContinue(state);

      if (!shouldContinue.continue) {
        state.complete(shouldContinue.result);
        break;
      }

      // Update step if specified
      if (shouldContinue.nextStep) {
        state.transitionTo(shouldContinue.nextStep);
      }
    }

    // Max iterations reached without completion
    if (iteration >= this.maxIterations && !state.state.isComplete) {
      state.addError(new Error("Max iterations reached"), { iterations: iteration });
    }

    const summary = state.getSummary();
    this.log(`Execution complete`, summary);

    return state.toJSON();
  }

  /**
   * Logging helper
   */
  log(message, data = null) {
    if (this.debug) {
      console.log(`[${this.name}]`, message);
      if (data) console.log(JSON.stringify(data, null, 2));
    }
  }

  /**
   * Format tool result as observation text
   */
  formatObservation(toolName, toolResult) {
    if (toolResult.success) {
      return `Tool ${toolName} returned: ${JSON.stringify(toolResult.result)}`;
    } else {
      return `Tool ${toolName} failed: ${toolResult.error}`;
    }
  }

  /**
   * Normalize tool parameters from LLM response
   * Handles cases where LLM uses different parameter names than expected
   */
  normalizeParams(toolName, llmParams, state) {
    const params = { ...llmParams };

    // Tools that need pdfPath - add it if missing
    const pdfPathTools = ["convert_first_page", "extract_text", "detect_handwriting", "get_page_count"];
    if (pdfPathTools.includes(toolName)) {
      if (!params.pdfPath || params.pdfPath === "undefined" || params.pdfPath === undefined) {
        params.pdfPath = state.state.documentPath;
      }
    }

    // Tools that need imagePath - add it from previous tool result
    const imagePathTools = ["classify_with_llm", "analyze_structure"];
    if (imagePathTools.includes(toolName)) {
      if (!params.imagePath && state.state.toolResults.convert_first_page?.result?.imagePath) {
        params.imagePath = state.state.toolResults.convert_first_page.result.imagePath;
      }
    }

    // Tools that need ocrText - add it from previous tool result
    const ocrTextTools = ["classify_with_llm", "analyze_structure"];
    if (ocrTextTools.includes(toolName)) {
      if (!params.ocrText && state.state.toolResults.extract_text?.result?.text) {
        params.ocrText = state.state.toolResults.extract_text.result.text;
      }
    }

    return params;
  }
}

module.exports = BaseAgent;
