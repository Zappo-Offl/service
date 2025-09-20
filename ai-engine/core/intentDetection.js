const config = require('../config/aiConfig');

class IntentDetection {
  constructor() {
    this.patterns = {
      GET_BALANCE: [
        /\b(balance|how much|check wallet|show balance)\b/i,
        /\b(what do i have|my eth|my balance)\b/i,
        /\b(wallet balance|current balance|eth balance)\b/i
      ],
      SEND_ETH: [
        /\b(send|transfer|pay|give)\b.*\b(eth|ethereum)\b/i,
        /\b(send|transfer)\b.*\b(to|@)\b/i,
        /\b(pay|send)\b.*\d+(\.\d+)?\s*(eth)?\b/i
      ],
      CREATE_WALLET: [
        /\b(create|new|make|generate)\b.*\bwallet\b/i,
        /\bi need.*wallet\b/i,
        /\bsetup.*wallet\b/i
      ],
      HELP: [
        /\b(help|how to|guide|explain|tutorial)\b/i,
        /\b(what can you do|commands|instructions)\b/i,
        /\bhow do i\b/i
      ]
    };
  }

  detectIntent(message) {
    const text = message.toLowerCase().trim();
    
    // Check each intent pattern
    for (const [intent, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return {
            intent,
            confidence: this.calculateConfidence(text, pattern),
            matchedPattern: pattern.source
          };
        }
      }
    }
    
    // If no specific intent detected, classify as general chat
    return {
      intent: 'GENERAL_CHAT',
      confidence: 0.5,
      matchedPattern: null
    };
  }

  calculateConfidence(text, pattern) {
    // Simple confidence calculation based on match strength
    const matches = text.match(pattern);
    if (!matches) return 0.5;
    
    const matchLength = matches[0].length;
    const textLength = text.length;
    const ratio = matchLength / textLength;
    
    // Higher confidence for more specific matches
    return Math.min(0.9, 0.5 + ratio);
  }

  extractEntities(message, intent) {
    const entities = {};
    const text = message.toLowerCase();
    
    if (intent === 'SEND_ETH') {
      // Extract amount - handle various formats
      const amountPatterns = [
        /(\d+(?:\.\d+)?)\s*(eth|ethereum)/i,
        /(\d+(?:\.\d+)?)\s*(?=\s+to|$)/i,
        /(all|everything|max)/i,
        /(half|50%)/i
      ];
      
      for (const pattern of amountPatterns) {
        const match = message.match(pattern);
        if (match) {
          let amount = match[1];
          if (amount === 'all' || amount === 'everything' || amount === 'max') {
            entities.amount = 'ALL';
          } else if (amount === 'half' || amount === '50%') {
            entities.amount = 'HALF';
          } else {
            entities.amount = amount;
          }
          break;
        }
      }
      
      // Extract recipient mentions
      const recipientPatterns = [
        /to\s+([a-zA-Z]+)/i,
        /@([a-zA-Z]+)/,
        /send\s+[^to]*to\s+([a-zA-Z]+)/i
      ];
      
      for (const pattern of recipientPatterns) {
        const match = message.match(pattern);
        if (match) {
          entities.recipient = match[1];
          break;
        }
      }
      
      // Extract Ethereum addresses
      const addressMatch = message.match(/0x[a-fA-F0-9]{40}/);
      if (addressMatch) {
        entities.address = addressMatch[0];
      }
    }
    
    return entities;
  }

  // Validate extracted entities
  validateEntities(entities, intent) {
    const validation = { isValid: true, errors: [] };
    
    if (intent === 'SEND_ETH') {
      // Validate amount
      if (entities.amount) {
        if (!['ALL', 'HALF'].includes(entities.amount)) {
          const amount = parseFloat(entities.amount);
          if (isNaN(amount) || amount <= 0) {
            validation.isValid = false;
            validation.errors.push('Invalid amount specified');
          } else if (amount < config.validation.minAmount) {
            validation.isValid = false;
            validation.errors.push(`Minimum amount is ${config.validation.minAmount} ETH`);
          } else if (amount > config.validation.maxAmount) {
            validation.errors.push(`Large amount detected (${amount} ETH) - extra confirmation required`);
          }
        }
      }
      
      // Validate address if provided
      if (entities.address && !config.validation.addressPattern.test(entities.address)) {
        validation.isValid = false;
        validation.errors.push('Invalid Ethereum address format');
      }
    }
    
    return validation;
  }

  // Generate contextual prompts based on missing entities
  generateMissingEntityPrompts(intent, entities) {
    const prompts = [];
    
    if (intent === 'SEND_ETH') {
      if (!entities.amount) {
        prompts.push("How much ETH would you like to send?");
      }
      
      if (!entities.recipient && !entities.address) {
        prompts.push("Who would you like to send it to? Please share their contact so I can get their verified address! 📱");
      }
    }
    
    return prompts;
  }

  // Analyze message sentiment for better responses
  analyzeSentiment(message) {
    const urgentWords = ['urgent', 'quickly', 'asap', 'now', 'immediately'];
    const politeWords = ['please', 'thank you', 'thanks', 'kindly'];
    const confusedWords = ['confused', 'help', 'don\'t understand', 'how'];
    
    const text = message.toLowerCase();
    
    return {
      isUrgent: urgentWords.some(word => text.includes(word)),
      isPolite: politeWords.some(word => text.includes(word)),
      isConfused: confusedWords.some(word => text.includes(word)),
      tone: this.detectTone(text)
    };
  }

  detectTone(text) {
    const casualWords = ['hey', 'yo', 'sup', 'hi there'];
    const formalWords = ['hello', 'good morning', 'good evening', 'greetings'];
    
    if (casualWords.some(word => text.includes(word))) {
      return 'casual';
    } else if (formalWords.some(word => text.includes(word))) {
      return 'formal';
    } else {
      return 'neutral';
    }
  }
}

module.exports = IntentDetection;