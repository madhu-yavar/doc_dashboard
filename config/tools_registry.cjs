/**
 * Tools Registry
 * Central catalog of all available tools with their configurations
 */

module.exports = {
  registryVersion: "1.0.0",
  lastUpdated: "2026-04-04",

  tools: {
    // PDF Processing Tools
    pdf_reader: {
      id: "pdf_reader",
      name: "PDF Reader",
      version: "1.0.0",
      category: "pdf",
      handler: "../tools/pdf/pdf_reader.tool.cjs",
      description: "Extracts text content from PDF files",
      parameters: {
        filePath: {
          type: "string",
          required: true,
          description: "Absolute path to PDF file"
        },
        maxLength: {
          type: "number",
          required: false,
          default: 12000,
          description: "Maximum characters to extract"
        }
      },
      timeout: 30000
    },

    // Risk Assessment Tools
    fall_risk_calculator: {
      id: "fall_risk_calculator",
      name: "Fall Risk Calculator",
      version: "1.0.0",
      category: "risk",
      handler: "../tools/risk/fall_risk_calculator.tool.cjs",
      description: "Calculates fall risk score from assessment data",
      parameters: {
        score: {
          type: "number",
          required: true
        },
        level: {
          type: "string",
          required: false
        }
      }
    },

    dvt_risk_calculator: {
      id: "dvt_risk_calculator",
      name: "DVT Risk Calculator",
      version: "1.0.0",
      category: "risk",
      handler: "../tools/risk/dvt_risk_calculator.tool.cjs",
      description: "Calculates DVT risk score from assessment data",
      parameters: {
        score: {
          type: "number",
          required: true
        }
      }
    },

    pressure_ulcer_calculator: {
      id: "pressure_ulcer_calculator",
      name: "Pressure Ulcer Risk Calculator",
      version: "1.0.0",
      category: "risk",
      handler: "../tools/risk/pressure_ulcer_calculator.tool.cjs",
      description: "Calculates pressure ulcer risk (Braden Scale)",
      parameters: {
        score: {
          type: "number",
          required: true
        }
      }
    },

    aspiration_risk_calculator: {
      id: "aspiration_risk_calculator",
      name: "Aspiration Risk Calculator",
      version: "1.0.0",
      category: "risk",
      handler: "../tools/risk/aspiration_risk_calculator.tool.cjs",
      description: "Calculates aspiration risk score",
      parameters: {
        score: {
          type: "number",
          required: true
        }
      }
    },

    ews_calculator: {
      id: "ews_calculator",
      name: "Early Warning Score Calculator",
      version: "1.0.0",
      category: "clinical",
      handler: "../tools/clinical/ews_calculator.tool.cjs",
      description: "Calculates EWS score and determines severity",
      parameters: {
        score: {
          type: "number",
          required: true
        }
      }
    },

    gcs_calculator: {
      id: "gcs_calculator",
      name: "Glasgow Coma Scale Calculator",
      version: "1.0.0",
      category: "clinical",
      handler: "../tools/clinical/gcs_calculator.tool.cjs",
      description: "Parses GCS shorthand notation (E4M6V5) into components",
      parameters: {
        shorthand: {
          type: "string",
          required: false,
          description: "GCS shorthand like E4M6V5"
        },
        eyes: {
          type: "number",
          required: false
        },
        motor: {
          type: "number",
          required: false
        },
        verbal: {
          type: "number",
          required: false
        }
      }
    },

    vitals_interpreter: {
      id: "vitals_interpreter",
      name: "Vitals Interpreter",
      version: "1.0.0",
      category: "clinical",
      handler: "../tools/clinical/vitals_interpreter.tool.cjs",
      description: "Interprets vital signs and flags abnormalities",
      parameters: {
        bp: {
          type: "object",
          required: false
        },
        pulse: {
          type: "number",
          required: false
        },
        spo2: {
          type: "number",
          required: false
        },
        grbs: {
          type: "number",
          required: false
        }
      }
    },

    // LLM Tools
    gemma_client: {
      id: "gemma_client",
      name: "Gemma LLM Client",
      version: "1.0.0",
      category: "llm",
      handler: "../tools/llm/gemma_client.tool.cjs",
      description: "Communicates with Gemma API for text generation",
      parameters: {
        prompt: {
          type: "string",
          required: true
        },
        temperature: {
          type: "number",
          required: false,
          default: 0.1
        },
        maxTokens: {
          type: "number",
          required: false,
          default: 3000
        }
      },
      config: {
        baseUrl: process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
        model: process.env.GEMMA_MODEL || "google/gemma-4-31B-it",
        timeout: 90000
      }
    },

    prompt_builder: {
      id: "prompt_builder",
      name: "Prompt Builder",
      version: "1.0.0",
      category: "llm",
      handler: "../tools/llm/prompt_builder.tool.cjs",
      description: "Builds structured prompts for extraction tasks",
      parameters: {
        templateName: {
          type: "string",
          required: true
        },
        context: {
          type: "object",
          required: true
        }
      }
    },

    citation_tracker: {
      id: "citation_tracker",
      name: "Citation Tracker",
      version: "1.0.0",
      category: "llm",
      handler: "../tools/llm/citation_tracker.tool.cjs",
      description: "Tracks source citations for extracted data with verification links",
      parameters: {
        field: {
          type: "string",
          required: true
        },
        citation: {
          type: "object",
          required: true
        }
      }
    }
  },

  // Helper method to get tool by ID
  getTool(id) {
    return this.tools[id] || null;
  },

  // Helper method to get tools by category
  getToolsByCategory(category) {
    return Object.values(this.tools)
      .filter(tool => tool.category === category);
  },

  // Helper method to get all tool IDs
  getAllToolIds() {
    return Object.keys(this.tools);
  }
};
