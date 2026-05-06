class SmtpMailer {
  constructor(config = {}) {
    const rawPort = process.env.SMTP_PORT || "587";
    const parsedPort = Number.parseInt(rawPort, 10);
    const port = Number.isFinite(parsedPort) ? parsedPort : 587;
    const secureEnv = String(process.env.SMTP_SECURE || "").toLowerCase();

    this.config = {
      host: process.env.SMTP_HOST || process.env.SMTP_SERVER || "",
      port,
      secure: secureEnv ? secureEnv === "true" : port === 465,
      user: process.env.SMTP_USER || process.env.SMTP_USERNAME || "",
      pass:
        process.env.SMTP_PASS ||
        process.env.SMTP_PASSWORD ||
        process.env.SMTP_APP_PASSWORD ||
        "",
      fromEmail:
        process.env.SMTP_FROM_EMAIL ||
        process.env.FROM_EMAIL ||
        process.env.EMAIL_FROM ||
        "",
      replyTo:
        process.env.SMTP_REPLY_TO ||
        process.env.EMAIL_REPLY_TO ||
        "",
      requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
      ...config,
    };

    this.transporter = null;
  }

  isConfigured() {
    return Boolean(
      this.config.host &&
      this.config.port &&
      this.config.user &&
      this.config.pass &&
      this.config.fromEmail
    );
  }

  getMissingConfig() {
    const missing = [];

    if (!this.config.host) missing.push("SMTP_HOST");
    if (!this.config.port) missing.push("SMTP_PORT");
    if (!this.config.user) missing.push("SMTP_USER");
    if (!this.config.pass) missing.push("SMTP_PASS");
    if (!this.config.fromEmail) missing.push("SMTP_FROM_EMAIL");

    return missing;
  }

  getTransporter() {
    if (!this.isConfigured()) {
      throw new Error(`SMTP is not fully configured: missing ${this.getMissingConfig().join(", ")}`);
    }

    if (this.transporter) {
      return this.transporter;
    }

    const nodemailer = require("nodemailer");

    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTLS: this.config.requireTLS,
      auth: {
        user: this.config.user,
        pass: this.config.pass,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    return this.transporter;
  }

  async sendMail(message = {}) {
    const transporter = this.getTransporter();

    return transporter.sendMail({
      from: message.from || this.config.fromEmail,
      replyTo: message.replyTo || this.config.replyTo || this.config.fromEmail,
      ...message,
    });
  }

  async verify() {
    const transporter = this.getTransporter();
    return transporter.verify();
  }
}

module.exports = SmtpMailer;
