require('dotenv').config();

module.exports = {
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.AI_MODEL || 'ollama/llama3.1:8b',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 800,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7,
    timeout: parseInt(process.env.AI_TIMEOUT) || 10000
  },
  personality: {
    tone: 'helpful_neighbor',
    humor: 'light',
    errorHandling: 'encouraging',
    confirmationRequired: true,
    maxConversationLength: 10
  },
  intents: {
    GET_BALANCE: ['balance', 'how much', 'check wallet', 'my eth', 'show balance'],
    SEND_ETH: ['send', 'transfer', 'pay', 'give'],
    CREATE_WALLET: ['create wallet', 'new wallet', 'make wallet', 'generate wallet'],
    HELP: ['help', 'how to', 'explain', 'what can you do', 'commands'],
    GENERAL_CHAT: ['what is', 'tell me about', 'explain']
  },
  validation: {
    maxAmount: 100, // Maximum ETH amount without extra confirmation
    minAmount: 0.0001, // Minimum ETH amount
    addressPattern: /^0x[a-fA-F0-9]{40}$/,
    phonePattern: /^\d{10,15}$/
  }
};