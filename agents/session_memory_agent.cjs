class SessionMemoryAgent {
  constructor(config = {}) {
    this.name = "Session Memory Agent";
    this.version = "1.0.0";
    this.readSessions = config.readSessions;
    this.writeSessions = config.writeSessions;
  }

  async load(documentId, chatId = "") {
    const sessions = await this.readSessions();
    if (chatId) {
      return sessions.find((session) => session.chatId === chatId) || null;
    }
    return sessions.find((session) => session.documentId === documentId) || null;
  }

  async save(session) {
    const sessions = await this.readSessions();
    const index = sessions.findIndex((item) => item.chatId === session.chatId);
    if (index >= 0) sessions[index] = session;
    else sessions.unshift(session);
    await this.writeSessions(sessions);
    return session;
  }
}

module.exports = SessionMemoryAgent;
