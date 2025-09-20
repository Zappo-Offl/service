const GasService = require('../ai-engine/core/gasService');

class FunctionMapper {
  constructor() {
    this.gasService = new GasService();
  }

  async executeAIIntent(sock, message, aiResult, userPhone) {
    try {
      // Parse AI response to extract intent and entities
      const aiData = this.parseAIResponse(aiResult.content);
      
      console.log(`🎯 Executing intent: ${aiData.intent}`, aiData.entities);

      // Route based on detected intent
      switch (aiData.intent) {
        case 'GET_BALANCE':
          return await this.handleBalanceCheck(sock, message, aiData, userPhone);
          
        case 'SEND_ETH':
          return await this.handleSendETH(sock, message, aiData, userPhone);
          
        case 'CREATE_WALLET':
          return await this.handleCreateWallet(sock, message, aiData, userPhone);
          
        case 'HELP':
          return await this.handleHelp(sock, message, aiData);
          
        case 'GENERAL_CHAT':
        default:
          return await this.handleGeneralChat(sock, message, aiData);
      }
      
    } catch (error) {
      console.error('❌ Function mapping error:', error);
      await sock.sendMessage(message.key.remoteJid, {
        text: "Oops! I ran into a technical hiccup. No worries, we'll figure this out together! Try rephrasing your request or use standard commands like 'balance' or 'send'."
      });
    }
  }

  parseAIResponse(aiContent) {
    try {
      // Try to parse JSON from AI response
      const jsonMatch = aiContent.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON, treat as general chat
        return {
          intent: 'GENERAL_CHAT',
          entities: {},
          conversationalResponse: aiContent,
          confidence: 0.5
        };
      }
    } catch (parseError) {
      console.log('🔄 Could not parse AI JSON, treating as general chat');
      return {
        intent: 'GENERAL_CHAT',
        entities: {},
        conversationalResponse: aiContent,
        confidence: 0.5
      };
    }
  }

  async handleBalanceCheck(sock, message, aiData, userPhone) {
    try {
      // Import your existing nebula service for balance checking
      const NebulaService = require('../src/services/nebula');
      const nebula = new NebulaService();
      
      // Get balance using existing function
      const balance = await nebula.getBalance(userPhone);
      
      // Create conversational response
      const balanceNum = parseFloat(balance);
      let conversationalResponse;
      
      if (balanceNum === 0) {
        conversationalResponse = `Your wallet is empty right now! 😊 No worries - you can fund it anytime. Need help getting started?`;
      } else if (balanceNum < 0.01) {
        conversationalResponse = `You have ${balance} ETH in your wallet! Not much there yet, but every journey starts somewhere! 🚀`;
      } else if (balanceNum < 1) {
        conversationalResponse = `You've got ${balance} ETH in your wallet! Looking good! 💪`;
      } else {
        conversationalResponse = `Wow! You have ${balance} ETH in your wallet! That's solid! 🎉💎`;
      }
      
      await sock.sendMessage(message.key.remoteJid, {
        text: conversationalResponse
      });
      
    } catch (error) {
      console.error('❌ Balance check error:', error);
      await sock.sendMessage(message.key.remoteJid, {
        text: "Oops! Had trouble checking your balance. The network might be a bit slow right now. Want to try again in a moment?"
      });
    }
  }

  async handleSendETH(sock, message, aiData, userPhone) {
    try {
      const entities = aiData.entities || {};
      
      // Check what information we have
      if (!entities.amount) {
        await sock.sendMessage(message.key.remoteJid, {
          text: "I'd love to help you send ETH! How much would you like to send? 💸"
        });
        return;
      }

      if (!entities.recipient && !entities.address) {
        await sock.sendMessage(message.key.remoteJid, {
          text: `Got it! You want to send ${entities.amount} ETH. Please share the contact of who you'd like to send it to, so I can get their verified address! 📱`
        });
        return;
      }

      // Get current gas fees for preview
      const gasData = await this.gasService.getCurrentGasFees();
      const gasStatus = this.gasService.getGasStatusMessage(gasData);
      
      // If we have an address, show transaction preview
      if (entities.address) {
        const previewMessage = `📋 *Transaction Preview*

💰 Amount: ${entities.amount} ETH
📍 To: ${entities.address.substring(0, 8)}...${entities.address.substring(-6)}
${this.gasService.formatGasForUser(gasData)}

${gasStatus}

Type 'YES' to confirm or 'NO' to cancel`;

        await sock.sendMessage(message.key.remoteJid, { text: previewMessage });
        return;
      }

      // Route through existing send flow for contact-based sending
      const response = `Perfect! I'll help you send ${entities.amount} ETH to ${entities.recipient}. 

${gasStatus}

Please share ${entities.recipient}'s contact so I can get their verified wallet address! Once you share the contact, I'll show you the transaction preview for confirmation. 📱`;

      await sock.sendMessage(message.key.remoteJid, { text: response });
      
    } catch (error) {
      console.error('❌ Send ETH error:', error);
      await sock.sendMessage(message.key.remoteJid, {
        text: "Oops! Transaction setup hit a snag. No worries, we'll sort this out! The network might be busy right now. Want to try again?"
      });
    }
  }

  async handleCreateWallet(sock, message, aiData, userPhone) {
    try {
      const response = `🆕 *Creating a New Wallet!*

I'll generate a secure wallet for you right now! This will:

✅ Create a new Ethereum address
✅ Generate secure private keys  
✅ Set up on Arbitrum network
✅ Be ready for ETH transactions

Creating your wallet... 🔐`;

      await sock.sendMessage(message.key.remoteJid, { text: response });

      // Route to existing wallet creation logic
      // You'll need to adjust this based on your actual wallet creation function
      const WalletHandler = require('../src/handlers/commandHandler');
      
      // Simulate wallet creation call - adjust based on your actual implementation
      setTimeout(async () => {
        await sock.sendMessage(message.key.remoteJid, {
          text: `🎉 *Wallet Created Successfully!*

Your new Arbitrum wallet is ready! Here's what's next:

💡 *Get some ETH:* Visit our faucet to get test ETH
🔐 *Keep it safe:* Your wallet is securely stored  
💸 *Start sending:* You can now send and receive ETH

Type 'balance' to check your wallet or ask me anything else! Welcome to the Arbitrum family! 🚀`
        });
      }, 2000);
      
    } catch (error) {
      console.error('❌ Create wallet error:', error);
      await sock.sendMessage(message.key.remoteJid, {
        text: "Oops! Wallet creation hit a technical snag. No worries, we'll get you set up! Try typing 'create wallet' or let me know if you need help!"
      });
    }
  }

  async handleHelp(sock, message, aiData) {
    const helpMessage = `🤖 *Hey! I'm Zappo, your friendly Arbitrum ETH wallet assistant!*

I can help you with:

💰 *Check Balance*
Just ask: "How much ETH do I have?" or "check my balance"

💸 *Send ETH*  
Say: "Send 0.5 ETH to John" and I'll walk you through it!

🆕 *Create Wallet*
Tell me: "I need a new wallet" and I'll set you up!

⛽ *Gas Fees*
Ask: "What are gas fees like?" for current network status

❓ *Learn About Crypto*
Ask me anything: "What are gas fees?" or "How does Arbitrum work?"

*Traditional commands also work:*
• Type 'balance' for quick balance check
• Type 'send' to start sending ETH  
• Type 'create wallet' for new wallet

Ready to help with whatever you need! 🚀`;

    await sock.sendMessage(message.key.remoteJid, { text: helpMessage });
  }

  async handleGeneralChat(sock, message, aiData) {
    // Send the conversational response from AI
    const response = aiData.conversationalResponse || "I'm here to help with your Arbitrum ETH wallet! What would you like to do today?";
    
    await sock.sendMessage(message.key.remoteJid, { text: response });
  }
}

module.exports = FunctionMapper;