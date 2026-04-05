class ChatPromptBuilderTool {
  constructor(config = {}) {
    this.name = "Chat Prompt Builder";
    this.version = "1.0.0";
    this.config = config;
  }

  build({ message, classification, internalEvidence = [], externalEvidence = [], chatHistory = [] }) {
    const internalBlock = internalEvidence
      .map((item) => `- ${item.value} | ${item.source_section} | ${item.source_excerpt}`)
      .join("\n");
    const externalBlock = externalEvidence
      .map((item) => `- ${item.value} | ${item.source_section} | ${item.source_excerpt} | ${item.url || ""}`)
      .join("\n");
    const historyBlock = (chatHistory || [])
      .slice(-6)
      .map((item) => `${item.role}: ${item.content || item.answer || ""}`)
      .join("\n");

    return `You are a doctor assistant embedded in a clinical dashboard.

Rules:
- Use only the provided evidence.
- Do not invent facts.
- Keep the answer concise and clinician-facing.
- For simple fact questions, answer with just the requested fact and no extra narration.
- If evidence is weak, say so directly.
- For mixed answers, separate "Patient Record" and "External Reference".
- For explanatory clinical questions, do not assign a patient-specific cause unless the chart explicitly documents it.
- When external evidence is present for an explanatory question, summarize it as general medical context only.
- Do not include citation markup in the answer body; citations are attached separately.

Question:
${message}

Intent:
${classification.intent}

Response style:
${classification.responseStyle || "default"}

Recent chat:
${historyBlock || "None"}

Internal evidence:
${internalBlock || "None"}

External evidence:
${externalBlock || "None"}

Return plain text only.`;
  }
}

module.exports = ChatPromptBuilderTool;
