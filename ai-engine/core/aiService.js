const axios = require('axios');
const config = require('../config/aiConfig');

class AIService {
  constructor() {
    this.config = config.openRouter;
    this.rateLimitMap = new Map();
    this.conversationHistory = new Map();
  }

  async processMessage(userMessage, userPhone, context = []) {
    try {
      // Rate limiting check
      if (!this.checkRateLimit(userPhone)) {
        throw new Error('Rate limit exceeded - please wait a moment');
      }

      // Prepare the conversation context
      const messages = [
        {
          role: 'system',
          content: this.getSystemPrompt()
        },
        ...context.slice(-5), // Keep last 5 messages for context
        {
          role: 'user',
          content: userMessage
        }
      ];

      console.log('🤖 Sending request to AI:', {
        model: this.config.model,
        messageCount: messages.length,
        userMessage: userMessage.substring(0, 50) + '...'
      });

      const response = await axios.post(this.config.baseUrl, {
        model: this.config.model,
        messages: messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature
      }, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/charan0318/zappo',
          'X-Title': 'Zappo AI WhatsApp ETH Wallet'
        },
        timeout: this.config.timeout
      });

      const aiResponse = response.data.choices[0].message.content;
      
      // Update conversation history
      this.updateConversationHistory(userPhone, userMessage, aiResponse);

      console.log('✅ AI Response received:', aiResponse.substring(0, 100) + '...');

      return {
        success: true,
        content: aiResponse,
        usage: response.data.usage
      };
    } catch (error) {
      console.error('❌ AI Service Error:', error.message);
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }

  getSystemPrompt() {
    return `You are Zappo, a helpful and friendly AI assistant for a WhatsApp-based Ethereum wallet on the Arbitrum network. 

PERSONALITY:
- Helpful neighbor who's good with tech
- Light humor, encouraging tone  
- Always explain risks in a friendly way
- Keep responses concise but warm
- Use encouraging language for errors: "No worries, we'll figure this out together!"

YOUR CAPABILITIES:
- Help users check their ETH balance
- Assist with sending ETH (always require confirmation)
- Create new wallets
- Explain crypto concepts simply
- General conversation about cryptocurrency

CRITICAL SAFETY RULES:
- NEVER execute transactions directly
- ALWAYS require explicit user confirmation for any wallet operations
- If you detect a transaction intent, respond with structured JSON data
- Be honest about errors and encourage users
- For large amounts (>1 ETH), add extra warnings

RESPONSE FORMAT:
When you detect user intents that require wallet operations, respond with this JSON structure:
{
  "intent": "GET_BALANCE|SEND_ETH|CREATE_WALLET|HELP|GENERAL_CHAT",
  "entities": {
    "amount": "extracted_amount_if_any",
    "recipient": "extracted_recipient_name_if_any", 
    "address": "extracted_address_if_any"
  },
  "requiresConfirmation": true/false,
  "conversationalResponse": "Your friendly response here",
  "confidence": 0.8
}

For general chat or explanations, just respond conversationally without JSON.

EXAMPLE RESPONSES:
User: "How much ETH do I have?"
You: {"intent": "GET_BALANCE", "entities": {}, "requiresConfirmation": false, "conversationalResponse": "Let me check your ETH balance for you! 🔍", "confidence": 0.9}

User: "Send 0.5 ETH to John"  
You: {"intent": "SEND_ETH", "entities": {"amount": "0.5", "recipient": "John"}, "requiresConfirmation": true, "conversationalResponse": "I'd love to help you send 0.5 ETH to John! I'll need John's contact so I can get his verified address. 📱", "confidence": 0.9}

User: "What is gas fee?"
You: Think of gas fees like postage stamps - they're the cost to send your transaction through the Arbitrum network! When the network is busy (like rush hour), fees go up. When it's quiet, they're cheaper. Don't worry, everyone finds this confusing at first! 😊`;
  }

  updateConversationHistory(userPhone, userMessage, aiResponse) {
    if (!this.conversationHistory.has(userPhone)) {
      this.conversationHistory.set(userPhone, []);
    }
    
    const history = this.conversationHistory.get(userPhone);
    history.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: aiResponse }
    );
    
    // Keep only last 10 messages (5 exchanges)
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    this.conversationHistory.set(userPhone, history);
  }

  getConversationHistory(userPhone) {
    return this.conversationHistory.get(userPhone) || [];
  }

  clearConversationHistory(userPhone) {
    this.conversationHistory.delete(userPhone);
  }

  checkRateLimit(userPhone) {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 20; // 20 requests per minute per user
    
    if (!this.rateLimitMap.has(userPhone)) {
      this.rateLimitMap.set(userPhone, []);
    }
    
    const requests = this.rateLimitMap.get(userPhone);
    const recentRequests = requests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= maxRequests) {
      return false;
    }
    
    recentRequests.push(now);
    this.rateLimitMap.set(userPhone, recentRequests);
    return true;
  }

  // Validate AI response format
  validateAIResponse(response) {
    try {
      if (typeof response === 'string' && response.trim().startsWith('{')) {
        const parsed = JSON.parse(response);
        if (parsed.intent && parsed.conversationalResponse) {
          return { isValid: true, data: parsed };
        }
      }
      return { 
        isValid: false, 
        data: { 
          intent: 'GENERAL_CHAT', 
          conversationalResponse: response,
          confidence: 0.5
        }
      };
    } catch (error) {
      return { 
        isValid: false, 
        data: { 
          intent: 'GENERAL_CHAT', 
          conversationalResponse: response || 'I had trouble understanding that. Could you rephrase?',
          confidence: 0.3
        }
      };
    }
  }
}

module.exports = AIService;