/**
 * WhatsApp Notifier for Pharmacy Alerts (MOCK)
 *
 * This is a MOCK implementation for development/testing.
 * For production, integrate with:
 * - WhatsApp Business API (Meta)
 * - Twilio API for WhatsApp
 * - CallmeBot (for simple use cases)
 */

class WhatsAppNotifier {
  constructor(config = {}) {
    this.config = {
      phoneNumber: process.env.PHARMACY_WHATSAPP_PHONE_NUMBER || '',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      ...config
    };

    this.mockMode = true; // Always mock until real API is configured
  }

  /**
   * Initialize WhatsApp Business API client
   * (Mock for now - would use @whiskeysockets/bailets or similar in production)
   */
  initialize() {
    const hasConfig = this.config.accessToken && this.config.phoneNumber;
    if (!hasConfig) {
      console.warn(`      ⚠️ WhatsApp not configured - using mock mode`);
      console.warn(`      └─ Set WHATSAPP_ACCESS_TOKEN and PHARMACY_WHATSAPP_PHONE_NUMBER to enable`);
      return false;
    }
    return true;
  }

  /**
   * Send WhatsApp message
   * @param {object} alertContent - Formatted alert content from AlertFormatter
   * @returns {Promise<object>}
   */
  async send(alertContent) {
    const isConfigured = this.initialize();

    const message = this.buildMessage(alertContent);

    console.log(`      └─ To: ${this.config.phoneNumber || '(not configured)'}`);
    console.log(`      └─ Message preview:`);
    console.log(`         ${message.split('\n').slice(0, 5).join('\n         ')}...`);

    if (!isConfigured || this.mockMode || process.env.PHARMACY_ALERT_LOG_ONLY === 'true') {
      // Mock mode
      console.log(`      └─ 📱 MOCK MODE (WhatsApp not actually sent)`);
      return {
        success: true,
        mock: true,
        messageId: `mock-wa-${Date.now()}`,
        phoneNumber: this.config.phoneNumber,
        messagePreview: message
      };
    }

    // Production implementation would go here
    // Example using WhatsApp Business API:
    /*
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${this.config.phoneNumber}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: this.config.phoneNumber,
          type: 'text',
          text: { body: message }
        })
      }
    );
    */

    return {
      success: true,
      mock: false,
      messageId: `wa-${Date.now()}`
    };
  }

  /**
   * Build WhatsApp message text
   * WhatsApp messages work best with plain text and emoji formatting
   */
  buildMessage(content) {
    const lines = [
      '🔔 *NEW PRESCRIPTION ALERT*',
      '',
      '👤 *PATIENT*',
      '───────────────'
    ];

    lines.push(`Name: ${content.patient.name || 'Unknown'}`);
    if (content.patient.age) lines.push(`Age: ${content.patient.age}`);
    if (content.patient.mrn) lines.push(`ID: ${content.patient.mrn}`);

    lines.push('');
    lines.push('👨‍⚕️ *DOCTOR*');
    lines.push('───────────────');
    lines.push(`Dr. ${content.doctor.name || 'Unknown'}`);

    lines.push('');
    lines.push('💊 *MEDICATIONS*');
    lines.push('───────────────');

    content.medications.forEach((med, idx) => {
      const numEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][idx] || '•';
      lines.push(`${numEmoji} *${med.name}*`);
      if (med.dose) lines.push(`   📏 ${med.dose}`);
      if (med.frequency) lines.push(`   ⏰ ${med.frequency}`);
      if (med.duration) lines.push(`   📅 ${med.duration}`);
    });

    if (content.diagnosis) {
      lines.push('');
      lines.push('📝 *Diagnosis*');
      lines.push('───────────────');
      lines.push(content.diagnosis);
    }

    lines.push('');
    lines.push(`📅 Date: ${content.rxDate || new Date().toLocaleDateString()}`);

    if (content.dashboardLink) {
      // Use a shorter link for WhatsApp (in production, use URL shortener)
      lines.push(`🔗 Details: ${content.dashboardLink}`);
    }

    lines.push('');
    lines.push('⚠️ Please prepare medications for pickup.');

    return lines.join('\n');
  }
}

module.exports = WhatsAppNotifier;
