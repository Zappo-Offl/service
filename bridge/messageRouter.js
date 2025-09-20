const AIEngine = require('../ai-engine');

class MessageRouter {
  constructor() {
    this.aiEngine = null;
    this.fallbackEnabled = true;
    this.aiEnabled = process.env.AI_ENABLED === 'true';
  }

  async initialize() {
    if (this.aiEnabled) {
      try {
        this.aiEngine = new AIEngine();
        console.log('✅ Message Router: AI Engine initialized');
      } catch (error) {
        console.error('❌ Message Router: Failed to initialize AI Engine:', error);
        this.aiEnabled = false;
      }
    }
  }

  async routeMessage(sock, message) {
    try {
      // Extract message content and user info
      const messageContent = this.extractMessageContent(message);
      const userPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');

      console.log(`📨 Routing message from ${userPhone}: "${messageContent.substring(0, 50)}..."`);

      // Check if AI is enabled and available
      if (this.aiEnabled && this.aiEngine) {
        try {
          const aiResult = await this.aiEngine.processMessage(messageContent, userPhone);
          
          if (aiResult.success && !aiResult.fallback) {
            console.log('🤖 AI processing successful, routing to function mapper');
            return await this.handleAIResponse(sock, message, aiResult, userPhone);
          } else {
            console.log('🔄 AI requested fallback or failed, using traditional handler');
            return await this.handleTraditional(sock, message);
          }
        } catch (aiError) {
          console.error('❌ AI processing error:', aiError.message);
          return await this.handleTraditional(sock, message);
        }
      } else {
        console.log('🏦 AI disabled, using traditional handler');
        return await this.handleTraditional(sock, message);
      }
      
    } catch (error) {
      console.error('❌ Message routing error:', error);
      
      // Send friendly error message to user
      await sock.sendMessage(message.key.remoteJid, {
        text: "Oops! I ran into a technical hiccup. No worries, we'll figure this out together! Try rephrasing your request or use standard commands like 'balance' or 'send'."
      });
    }
  }

  extractMessageContent(message) {
    // Handle different message types
    if (message.message?.conversation) {
      return message.message.conversation;
    } else if (message.message?.extendedTextMessage?.text) {
      return message.message.extendedTextMessage.text;
    } else if (message.message?.imageMessage?.caption) {
      return message.message.imageMessage.caption;
    } else if (message.message?.documentMessage?.caption) {
      return message.message.documentMessage.caption;
    } else {
      return '';
    }
  }

  async handleAIResponse(sock, message, aiResult, userPhone) {
    // Route to function mapper for execution
    const FunctionMapper = require('./functionMapper');
    const mapper = new FunctionMapper();
    
    return await mapper.executeAIIntent(sock, message, aiResult, userPhone);
  }

  async handleTraditional(sock, message) {
    // Use existing traditional command handler
    try {
      const CommandHandler = require('../src/handlers/commandHandler');
      
      // Check if the handler has the expected methods
      if (CommandHandler && typeof CommandHandler.handleMessage === 'function') {
        return await CommandHandler.handleMessage(sock, message);
      } else {
        // Fallback to basic command parsing if handler structure is different
        console.log('🔄 Using basic command fallback');
        return await this.basicCommandFallback(sock, message);
      }
    } catch (error) {
      console.error('❌ Traditional handler error:', error);
      return await this.basicCommandFallback(sock, message);
    }
  }

  async basicCommandFallback(sock, message) {
    const text = this.extractMessageContent(message).toLowerCase().trim();
    
    // Basic command recognition as fallback
    if (text.includes('balance')) {
      await sock.sendMessage(message.key.remoteJid, {
        text: "💼 To check your balance, please use the command: `/balance`"
      });
    } else if (text.includes('send')) {
      await sock.sendMessage(message.key.remoteJid, {
        text: "💸 To send ETH, please use: `/send` followed by amount and address"
      });
    } else if (text.includes('help')) {
      await sock.sendMessage(message.key.remoteJid, {
        text: `🤖 *ZAPPO Help*\\n\\nAvailable commands:\\n• \`/balance\` - Check your ETH balance\\n• \`/send\` - Send ETH to someone\\n• \`create wallet\` - Create new wallet\\n• \`/help\` - Show this help\\n\\nOr just chat with me naturally!`
      });
    } else {
      await sock.sendMessage(message.key.remoteJid, {
        text: "👋 Hi! I'm Zappo, your Arbitrum ETH wallet assistant. Type 'help' to see what I can do, or just ask me naturally like 'check my balance' or 'send ETH to John'!"
      });
    }
  }

  // Enable/disable AI at runtime
  setAIEnabled(enabled) {
    this.aiEnabled = enabled;
    console.log(`🔧 AI ${enabled ? 'enabled' : 'disabled'} at runtime`);
  }

  // Get router status
  getStatus() {
    return {
      aiEnabled: this.aiEnabled,
      aiEngineReady: this.aiEngine !== null,
      fallbackEnabled: this.fallbackEnabled
    };
  }
}

module.exports = MessageRouter;