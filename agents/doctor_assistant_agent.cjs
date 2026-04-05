const QueryIntentAgent = require("./query_intent_agent.cjs");
const RecordContextAgent = require("./record_context_agent.cjs");
const ExternalKnowledgeAgent = require("./external_knowledge_agent.cjs");
const AnswerComposerAgent = require("./answer_composer_agent.cjs");
const SafetyGuardAgent = require("./safety_guard_agent.cjs");
const ActionRouterAgent = require("./action_router_agent.cjs");
const SessionMemoryAgent = require("./session_memory_agent.cjs");

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

  async execute({ document, documentId, message, sectionContext, chatId }) {
    const session =
      (await this.sessionAgent.load(documentId, chatId)) || {
        chatId: chatId || crypto.randomUUID(),
        documentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        confirmedActions: [],
        pendingExternalConsent: null,
      };

    const userMessage = String(message || "");
    let executionMessage = userMessage;
    let externalConsentGranted = false;
    let classification = null;

    if (session.pendingExternalConsent) {
      const pending = session.pendingExternalConsent;

      if (this.isAffirmative(userMessage)) {
        executionMessage = pending.message;
        sectionContext = pending.sectionContext;
        classification = pending.classification || null;
        session.pendingExternalConsent = null;
        externalConsentGranted = true;
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
          content: userMessage,
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

    if (!classification) {
      const intentResult = await this.intentAgent.execute({ message: executionMessage, sectionContext });
      classification = intentResult.data;
    }

    if (classification.needsClarification) {
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

    const recordResult = await this.recordAgent.execute({
      document,
      message: executionMessage,
      sectionHints: classification.sectionHints,
      classification,
    });
    const internalEvidence = recordResult.data.evidence || [];

    const externalResult = classification.needsExternal
      ? await this.externalAgent.execute({ query: executionMessage, classification })
      : { success: true, data: { evidence: [], source_class: "internal" } };
    const externalEvidence = externalResult.data.evidence || [];
    const externalError = externalResult.data.error || null;
    const externalErrorType = externalResult.data.error_type || null;

    const safety = await this.safetyAgent.execute({
      classification,
      internalEvidence,
      externalEvidence,
    });

    let answerPayload;
    if (safety.data.refusal.refused) {
      answerPayload = {
        answer: safety.data.refusal.reason,
        citations: [],
        source_class: externalEvidence.length ? "external" : "internal",
      };
    } else if (classification.needsExternal && !externalEvidence.length) {
      const internalSummary = internalEvidence[0]?.value
        ? ` The uploaded record documents: ${internalEvidence[0].value}.`
        : "";
      const failureReason =
        externalErrorType === "no_results"
          ? "I searched approved external medical sources but did not find a reliable answer for that question."
          : "I tried approved external medical sources, but the external search is unavailable right now.";

      answerPayload = {
        answer: `${failureReason}${internalSummary}`,
        citations: internalEvidence.length ? [internalEvidence[0]] : [],
        source_class: internalEvidence.length ? "mixed" : "external",
      };
    } else {
      answerPayload = (
        await this.answerAgent.execute({
          message: executionMessage,
          classification,
          internalEvidence,
          externalEvidence,
          chatHistory: session.messages,
        })
      ).data;
    }

    const actionResult = await this.actionAgent.execute({
      classification,
      message: executionMessage,
      evidence: [...internalEvidence, ...externalEvidence],
      documentId,
    });

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      answer: answerPayload.answer,
      citations: answerPayload.citations,
      confidence: safety.data.confidence.score,
      confidence_label: safety.data.confidence.label,
      source_class: answerPayload.source_class,
      proposed_actions: actionResult.data.proposals,
      decision_prompt: null,
      createdAt: new Date().toISOString(),
    };

    session.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: externalConsentGranted ? "Yes" : userMessage,
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
        confidence: safety.data.confidence.score,
        confidence_label: safety.data.confidence.label,
        citations: answerPayload.citations,
        refused: safety.data.refusal.refused,
        refusal_reason: safety.data.refusal.reason || undefined,
        proposed_actions: actionResult.data.proposals,
        decision_prompt: assistantMessage.decision_prompt,
      },
      session,
    };
  }
}

module.exports = DoctorAssistantAgent;
