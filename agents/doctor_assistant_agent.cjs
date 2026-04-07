const QueryIntentAgent = require("./query_intent_agent.cjs");
const RecordContextAgent = require("./record_context_agent.cjs");
const ExternalKnowledgeAgent = require("./external_knowledge_agent.cjs");
const AnswerComposerAgent = require("./answer_composer_agent.cjs");
const SafetyGuardAgent = require("./safety_guard_agent.cjs");
const ActionRouterAgent = require("./action_router_agent.cjs");
const SessionMemoryAgent = require("./session_memory_agent.cjs");
const VitalNormalityTool = require("../tools/chat/vital_normality.tool.cjs");
const MedicationComparisonTool = require("../tools/chat/medication_comparison.tool.cjs");

class DoctorAssistantAgent {
  constructor(config = {}) {
    this.name = "Doctor Assistant Agent";
    this.version = "1.0.0";
    this.intentAgent = new QueryIntentAgent(config);
    this.recordAgent = new RecordContextAgent(config);
    this.externalAgent = new ExternalKnowledgeAgent(config);
    this.answerAgent = new AnswerComposerAgent(config);
    this.safetyAgent = new SafetyGuardAgent(config);
    this.actionAgent = new ActionRouterAgent(config);
    this.sessionAgent = new SessionMemoryAgent({
      readSessions: config.readSessions,
      writeSessions: config.writeSessions,
    });
    this.vitalNormalityTool = new VitalNormalityTool(config);
    this.medicationComparisonTool = new MedicationComparisonTool(config);
    this.useGeminiForExternal = config.gemini?.enabled !== false;
    this.defaultGeminiApiKey = String(config.gemini?.apiKey || "").trim();
  }

  isAffirmative(message = "") {
    return /\b(yes|yeah|yep|ok|okay|sure|go ahead|please do|do it|search|look it up)\b/i.test(String(message || ""));
  }

  isNegative(message = "") {
    return /\b(no|nope|don't|do not|stop|cancel|leave it)\b/i.test(String(message || ""));
  }

  createConsentPrompt(answer) {
    return {
      type: "external_search_consent",
      question: answer,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    };
  }

  createGeminiKeyPrompt(answer) {
    return {
      type: "gemini_api_key",
      question: answer,
      submit_label: "Use Gemini",
      placeholder: "Paste Gemini API key for this session",
    };
  }

  shouldTreatPendingClarificationAsNewQuestion(message = "", pendingClassification = null, nextClassification = null) {
    const text = String(message || "").trim();
    if (!text || !nextClassification) return false;
    if (this.isAffirmative(text) || this.isNegative(text)) return false;

    const looksStandalone =
      text.includes("?") ||
      /^(what|which|who|when|where|why|how|is|are|can|does|do|will|tell|show|list)\b/i.test(text);

    const intentChanged = nextClassification.intent && nextClassification.intent !== pendingClassification?.intent;
    const hasConcreteTarget =
      Boolean(nextClassification.factField) ||
      (Array.isArray(nextClassification.sectionHints) && nextClassification.sectionHints.length > 0) ||
      Boolean(nextClassification.needsExternal);

    return !nextClassification.needsClarification && (looksStandalone || intentChanged || hasConcreteTarget);
  }

  async execute({ document, documentId, message, sectionContext, chatId, geminiApiKey = "" }) {
    const session =
      (await this.sessionAgent.load(documentId, chatId)) || {
        chatId: chatId || crypto.randomUUID(),
        documentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        confirmedActions: [],
        pendingExternalConsent: null,
        pendingClarification: null,
        pendingGeminiKeyPrompt: null,
      };

    const userMessage = String(message || "");
    const providedGeminiApiKey = String(geminiApiKey || "").trim();
    let executionMessage = userMessage;
    let externalConsentGranted = false;
    let classification = null;
    let transientGeminiApiKey = providedGeminiApiKey;
    let userContentForHistory = userMessage;

    if (session.pendingGeminiKeyPrompt) {
      const pending = session.pendingGeminiKeyPrompt;
      if (!providedGeminiApiKey) {
        const promptMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          answer: "A Gemini API key is required to continue with Gemini-backed external synthesis for this turn.",
          citations: [],
          confidence: 60,
          confidence_label: "low",
          source_class: "external",
          proposed_actions: [],
          decision_prompt: this.createGeminiKeyPrompt("Enter a Gemini API key to continue. It will be used only for this session and will not be stored in chat history."),
          createdAt: new Date().toISOString(),
        };
        session.messages.push(promptMessage);
        session.updatedAt = new Date().toISOString();
        await this.sessionAgent.save(session);

        return {
          success: true,
          data: {
            chatId: session.chatId,
            documentId,
            answer: promptMessage.answer,
            source_class: "external",
            confidence: 60,
            confidence_label: "low",
            citations: [],
            refused: false,
            proposed_actions: [],
            decision_prompt: promptMessage.decision_prompt,
          },
          session,
        };
      }

      executionMessage = pending.message;
      sectionContext = pending.sectionContext;
      classification = pending.classification || null;
      session.pendingGeminiKeyPrompt = null;
      externalConsentGranted = true;
      userContentForHistory = "Gemini API key provided";
    }

    if (session.pendingExternalConsent) {
      const pending = session.pendingExternalConsent;

      if (this.isAffirmative(userMessage)) {
        executionMessage = pending.message;
        sectionContext = pending.sectionContext;
        classification = pending.classification || null;
        session.pendingExternalConsent = null;
        externalConsentGranted = true;
        if (this.useGeminiForExternal && !transientGeminiApiKey && !this.defaultGeminiApiKey) {
          const keyPrompt =
            "External search is approved. Enter a Gemini API key to use Gemini for grounded external synthesis. The key will not be stored in chat history.";

          session.pendingGeminiKeyPrompt = {
            message: executionMessage,
            sectionContext,
            classification,
            createdAt: new Date().toISOString(),
          };
          session.messages.push({
            id: crypto.randomUUID(),
            role: "user",
            content: "Yes",
            createdAt: new Date().toISOString(),
          });
          session.messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            answer: keyPrompt,
            citations: [],
            confidence: 60,
            confidence_label: "low",
            source_class: "external",
            proposed_actions: [],
            decision_prompt: this.createGeminiKeyPrompt(keyPrompt),
            createdAt: new Date().toISOString(),
          });
          session.updatedAt = new Date().toISOString();
          await this.sessionAgent.save(session);

          return {
            success: true,
            data: {
              chatId: session.chatId,
              documentId,
              answer: keyPrompt,
              source_class: "external",
              confidence: 60,
              confidence_label: "low",
              citations: [],
              refused: false,
              proposed_actions: [],
              decision_prompt: this.createGeminiKeyPrompt(keyPrompt),
            },
            session,
          };
        }
      } else if (this.isNegative(userMessage)) {
        const declineMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          answer: "Okay. I will not search external medical sources for that question.",
          citations: [],
          confidence: 60,
          confidence_label: "low",
          source_class: "internal",
          proposed_actions: [],
          decision_prompt: null,
          createdAt: new Date().toISOString(),
        };

        session.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content: userContentForHistory,
          createdAt: new Date().toISOString(),
        });
        session.messages.push(declineMessage);
        session.updatedAt = new Date().toISOString();
        await this.sessionAgent.save(session);

        return {
          success: true,
          data: {
            chatId: session.chatId,
            documentId,
            answer: declineMessage.answer,
            source_class: "internal",
            confidence: 60,
            confidence_label: "low",
            citations: [],
            refused: false,
            proposed_actions: [],
            decision_prompt: null,
          },
          session,
        };
      }
    }

    if (session.pendingClarification) {
      const pending = session.pendingClarification;
      const standaloneIntent = await this.intentAgent.execute({ message: userMessage, sectionContext });

      if (this.shouldTreatPendingClarificationAsNewQuestion(userMessage, pending.classification, standaloneIntent.data)) {
        session.pendingClarification = null;
        classification = standaloneIntent.data;
      } else {
        executionMessage = `${pending.message}\nClarification: ${userMessage}`;
        sectionContext = pending.sectionContext;
        classification = {
          ...pending.classification,
          needsClarification: false,
          clarificationPrompt: "",
        };
        session.pendingClarification = null;
      }
    }

    if (!classification) {
      const intentResult = await this.intentAgent.execute({ message: executionMessage, sectionContext });
      classification = intentResult.data;
    }

    const preRecordResults = classification.intent === "vital_normality"
      ? this.vitalNormalityTool.interpret(executionMessage, document)
      : null;

    if (classification.needsClarification) {
      session.pendingClarification = {
        message: executionMessage,
        sectionContext,
        classification,
        createdAt: new Date().toISOString(),
      };
      const clarificationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        answer: classification.clarificationPrompt,
        citations: [],
        confidence: 60,
        confidence_label: "low",
        source_class: "internal",
        proposed_actions: [],
        decision_prompt: null,
        createdAt: new Date().toISOString(),
      };

      session.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      });
      session.messages.push(clarificationMessage);
      session.updatedAt = new Date().toISOString();
      await this.sessionAgent.save(session);

      return {
        success: true,
        data: {
          chatId: session.chatId,
          documentId,
          answer: classification.clarificationPrompt,
          source_class: "internal",
          confidence: 60,
          confidence_label: "low",
          citations: [],
          refused: false,
          proposed_actions: [],
          decision_prompt: null,
        },
        session,
      };
    }

    if (!externalConsentGranted && classification.requiresExternalConsent && classification.needsExternal) {
      const consentPrompt =
        "This answer is not available in the uploaded record. I can search approved medical sources to answer it. Do you want me to do that?";

      session.pendingExternalConsent = {
        message: executionMessage,
        sectionContext,
        classification: {
          ...classification,
          requiresExternalConsent: false,
          needsExternal: true,
        },
        createdAt: new Date().toISOString(),
      };
      session.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      });
      session.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        answer: consentPrompt,
        citations: [],
        confidence: 60,
        confidence_label: "low",
        source_class: "internal",
        proposed_actions: [],
        decision_prompt: this.createConsentPrompt(consentPrompt),
        createdAt: new Date().toISOString(),
      });
      session.updatedAt = new Date().toISOString();
      await this.sessionAgent.save(session);

      return {
        success: true,
        data: {
          chatId: session.chatId,
          documentId,
          answer: consentPrompt,
          source_class: "internal",
          confidence: 60,
          confidence_label: "low",
          citations: [],
          refused: false,
          proposed_actions: [],
          decision_prompt: this.createConsentPrompt(consentPrompt),
        },
        session,
      };
    }

    const internalEvidence = classification.needsExternal
      ? []
      : (
          await this.recordAgent.execute({
            document,
            message: executionMessage,
            sectionHints: classification.sectionHints,
            classification,
          })
        ).data.evidence || [];

    const comparisonResolution =
      !classification.needsExternal &&
      (classification.intent === "medication_comparison" || classification.intent === "medication_substitution")
        ? this.medicationComparisonTool.resolve(executionMessage, internalEvidence)
        : null;

    const useGeminiWebSearch =
      classification.needsExternal &&
      this.useGeminiForExternal &&
      Boolean(transientGeminiApiKey || this.defaultGeminiApiKey);

    if (comparisonResolution?.needsClarification) {
      session.pendingClarification = {
        message: executionMessage,
        sectionContext,
        classification,
        createdAt: new Date().toISOString(),
      };
      const clarificationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        answer: comparisonResolution.clarificationPrompt,
        citations: [],
        confidence: 60,
        confidence_label: "low",
        source_class: "internal",
        proposed_actions: [],
        decision_prompt: null,
        createdAt: new Date().toISOString(),
      };

      session.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      });
      session.messages.push(clarificationMessage);
      session.updatedAt = new Date().toISOString();
      await this.sessionAgent.save(session);

      return {
        success: true,
        data: {
          chatId: session.chatId,
          documentId,
          answer: comparisonResolution.clarificationPrompt,
          source_class: "internal",
          confidence: 60,
          confidence_label: "low",
          citations: [],
          refused: false,
          proposed_actions: [],
          decision_prompt: null,
        },
        session,
      };
    }

    if (preRecordResults) {
      const safety = await this.safetyAgent.execute({
        classification,
        internalEvidence: preRecordResults.citations || internalEvidence,
        externalEvidence: [],
      });

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        answer: preRecordResults.answer,
        citations: preRecordResults.citations || [],
        confidence: safety.data.confidence.score,
        confidence_label: safety.data.confidence.label,
        source_class: preRecordResults.source_class || "internal",
        proposed_actions: [],
        decision_prompt: null,
        createdAt: new Date().toISOString(),
      };

      session.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      });
      session.messages.push(assistantMessage);
      session.updatedAt = new Date().toISOString();
      await this.sessionAgent.save(session);

      return {
        success: true,
        data: {
          chatId: session.chatId,
          documentId,
          answer: preRecordResults.answer,
          source_class: preRecordResults.source_class || "internal",
          confidence: safety.data.confidence.score,
          confidence_label: safety.data.confidence.label,
          citations: preRecordResults.citations || [],
          refused: false,
          proposed_actions: [],
          decision_prompt: null,
        },
        session,
      };
    }

    if (comparisonResolution?.answer && classification.needsExternal && !externalConsentGranted && classification.requiresExternalConsent) {
      // consent path continues below; comparisonResolution only provides local fallback context
    } else if (comparisonResolution?.answer && !classification.needsExternal) {
      const safety = await this.safetyAgent.execute({
        classification,
        internalEvidence: comparisonResolution.citations || internalEvidence,
        externalEvidence: [],
      });

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        answer: comparisonResolution.answer,
        citations: comparisonResolution.citations || [],
        confidence: safety.data.confidence.score,
        confidence_label: safety.data.confidence.label,
        source_class: comparisonResolution.source_class || "internal",
        proposed_actions: [],
        decision_prompt: null,
        createdAt: new Date().toISOString(),
      };

      session.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      });
      session.messages.push(assistantMessage);
      session.updatedAt = new Date().toISOString();
      await this.sessionAgent.save(session);

      return {
        success: true,
        data: {
          chatId: session.chatId,
          documentId,
          answer: comparisonResolution.answer,
          source_class: comparisonResolution.source_class || "internal",
          confidence: safety.data.confidence.score,
          confidence_label: safety.data.confidence.label,
          citations: comparisonResolution.citations || [],
          refused: false,
          proposed_actions: [],
          decision_prompt: null,
        },
        session,
      };
    }

    const externalResult = classification.needsExternal && !useGeminiWebSearch
      ? await this.externalAgent.execute({ query: executionMessage, classification, internalEvidence: [] })
      : { success: true, data: { evidence: [], source_class: "internal" } };
    const externalEvidence = externalResult.data.evidence || [];
    const externalError = externalResult.data.error || null;
    const externalErrorType = externalResult.data.error_type || null;
    const externalResolution = externalResult.data.resolution || null;

    const safety = await this.safetyAgent.execute({
      classification,
      internalEvidence,
      externalEvidence,
    });
    const allowResolvedDrugFallback =
      classification.intent === "drug_safety" &&
      !externalEvidence.length &&
      Boolean(externalResolution?.generic_name || externalResolution?.normalized_display);
    const allowExternalAnswerDespiteLowSafety = classification.needsExternal && (externalEvidence.length || useGeminiWebSearch);

    let answerPayload;
    if (safety.data.refusal.refused && !allowResolvedDrugFallback && !allowExternalAnswerDespiteLowSafety) {
      answerPayload = {
        answer: safety.data.refusal.reason,
        citations: [],
        source_class: externalEvidence.length ? "external" : "internal",
      };
    } else if ((classification.intent === "medication_comparison" || classification.intent === "medication_substitution") && !externalEvidence.length && comparisonResolution?.answer) {
      answerPayload = {
        answer: comparisonResolution.answer,
        citations: comparisonResolution.citations || [],
        source_class: comparisonResolution.source_class || "mixed",
      };
    } else if (classification.needsExternal && !externalEvidence.length && !useGeminiWebSearch) {
      const resolvedSummary =
        externalResolution?.generic_name || externalResolution?.normalized_display
          ? ` I identified the medication as ${externalResolution.generic_name || externalResolution.normalized_display}, but I could not retrieve a reliable external fact for this question right now.`
          : "";
      const failureReason =
        externalErrorType === "no_results"
          ? "I searched approved external medical sources but did not find a reliable answer for that question."
          : "I tried approved external medical sources, but the external search is unavailable right now.";

      answerPayload = {
        answer: `${failureReason}${resolvedSummary}`,
        citations: [],
        source_class: "external",
      };
    } else {
      answerPayload = (
        await this.answerAgent.execute({
          message: executionMessage,
          classification,
          internalEvidence: classification.needsExternal ? [] : internalEvidence,
          externalEvidence,
          externalMeta: { resolution: externalResolution },
          chatHistory: session.messages,
          externalComposer: useGeminiWebSearch
            ? "gemini_web"
            : classification.needsExternal && externalEvidence.length && this.useGeminiForExternal && (transientGeminiApiKey || this.defaultGeminiApiKey)
            ? "gemini"
            : "gemma",
          geminiApiKey: transientGeminiApiKey || this.defaultGeminiApiKey,
        })
      ).data;
    }

    const actionResult = await this.actionAgent.execute({
      classification,
      message: executionMessage,
      evidence: [...internalEvidence, ...externalEvidence],
      documentId,
    });

    const effectiveConfidence =
      answerPayload.llm_provider === "gemini_web" && answerPayload.citations?.length
        ? { score: 88, label: "high" }
        : safety.data.confidence;

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      answer: answerPayload.answer,
      citations: answerPayload.citations,
      confidence: effectiveConfidence.score,
      confidence_label: effectiveConfidence.label,
      source_class: answerPayload.source_class,
      llm_provider: answerPayload.llm_provider || undefined,
      proposed_actions: actionResult.data.proposals,
      decision_prompt: null,
      createdAt: new Date().toISOString(),
    };

    session.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: externalConsentGranted && userContentForHistory === userMessage ? "Yes" : userContentForHistory,
      createdAt: new Date().toISOString(),
    });
    session.messages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();

    await this.sessionAgent.save(session);

    return {
      success: true,
      data: {
        chatId: session.chatId,
        documentId,
        answer: answerPayload.answer,
        source_class: answerPayload.source_class,
        confidence: effectiveConfidence.score,
        confidence_label: effectiveConfidence.label,
        citations: answerPayload.citations,
        refused: answerPayload.llm_provider === "gemini_web" ? false : allowExternalAnswerDespiteLowSafety ? false : safety.data.refusal.refused,
        refusal_reason: answerPayload.llm_provider === "gemini_web" ? undefined : allowExternalAnswerDespiteLowSafety ? undefined : safety.data.refusal.reason || undefined,
        llm_provider: answerPayload.llm_provider || undefined,
        proposed_actions: actionResult.data.proposals,
        decision_prompt: assistantMessage.decision_prompt,
      },
      session,
    };
  }
}

module.exports = DoctorAssistantAgent;
