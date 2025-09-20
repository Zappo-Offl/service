const AIService = require('./core/aiService');
const IntentDetection = require('./core/intentDetection');
const ConversationManager = require('./core/conversationManager');

class AIEngine {
  constructor() {
    this.aiService = new AIService();
    this.intentDetection = new IntentDetection();
    this.conversationManager = new ConversationManager();
    
    // Start session cleanup interval
    setInterval(() => {
      this.conversationManager.cleanupSessions();
    }, 5 * 60 * 1000); // Clean up every 5 minutes
    
    console.log('✅ AI Engine initialized successfully');
  }

  async processMessage(message, userPhone) {
    try {
      const messageText = message.toString().trim();
      
      // Get conversation context
      const context = this.conversationManager.getContext(userPhone);
      
      // Quick intent detection for routing decisions
      const quickIntent = this.intentDetection.detectIntent(messageText);
      console.log(`🎯 Quick intent detection: ${quickIntent.intent} (${quickIntent.confidence})`);
      
      // Send to AI for processing with context
      const aiResponse = await this.aiService.processMessage(messageText, userPhone, context);
      
      if (aiResponse.success) {
        // Update conversation context
        this.conversationManager.addToHistory(userPhone, messageText, aiResponse.content);
        
        return {
          success: true,
          content: aiResponse.content,
          intent: quickIntent,
          fallback: false
        };
      } else {
        console.log('🔄 AI processing failed, requesting fallback');
        return {
          success: false,
          error: aiResponse.error,
          fallback: true
        };
      }
      
    } catch (error) {
      console.error('❌ AI Engine processing error:', error);
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }

  // Get conversation session info
  getSessionInfo(userPhone) {
    return this.conversationManager.getSession(userPhone);
  }

  // Clear user session
  clearSession(userPhone) {
    this.conversationManager.clearSession(userPhone);
    this.aiService.clearConversationHistory(userPhone);
  }

  // Get AI engine statistics
  getStats() {
    return {
      sessions: this.conversationManager.getSessionStats(),
      aiService: {
        rateLimits: this.aiService.rateLimitMap.size,
        conversations: this.aiService.conversationHistory.size
      }
    };
  }
}

module.exports = AIEngine;