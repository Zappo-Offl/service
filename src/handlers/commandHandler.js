const commandParser = require('../parsers/commandParser');
const walletHandler = require('./walletHandler');
const transactionHandler = require('./transactionHandler');
const contactHandler = require('./contactHandler');
const claimsService = require('../services/claims');
const nebulaService = require('../services/nebula');
const { logger, logUserAction } = require('../utils/logger');
const { users } = require('../services/database');
const config = require('../config');
const nebulaChat = require('../services/nebulaChat');
const whatsappService = require('../services/whatsapp');
const testnetMigration = require('../services/testnetMigration');
const errorHandler = require('../utils/errorHandler');
const errorRecovery = require('../utils/errorRecovery');
const { deposit, checkBalances, getZAPBalance } = require('../../Web3/contracts/connections');
const { swapUSDCtoWETH, getSwapQuote } = require('../../Web3/swapService');
const { getTokenBalances } = require('../../Web3/balanceService');

// Inject sendMessage function and shared state into handlers
const injectSendMessage = (sendMessageFunc, pendingTransactions) => {
  walletHandler.sendMessage = sendMessageFunc;
  transactionHandler.sendMessage = sendMessageFunc;
  transactionHandler.pendingTransactions = pendingTransactions; // Share pending transactions
  contactHandler.sendMessage = sendMessageFunc;
};

class CommandHandler {
  constructor(whatsapp) {
    this.whatsapp = whatsapp;
    this.userStates = new Map(); // Track user conversation states
    this.pendingTransactions = new Map(); // Track pending transaction confirmations
    this.seenGroupNotice = new Set();
  }
  
  // Initialize command handler and set up message listeners
  initialize() {
    // Inject sendMessage function and shared state into handlers
    injectSendMessage(this.sendMessage.bind(this), this.pendingTransactions);
    
    this.whatsapp.on('message', async (messageData) => {
      await this.handleMessage(messageData);
    });
    // New: handle shared contacts
    this.whatsapp.on('contact_shared', async (payload) => {
      await this.handleSharedContact(payload);
    });
    
    logger.info('✅ Command handler initialized');
  }
  
  // Main message handling function
  async handleMessage(messageData) {
    try {
      const { from, text, timestamp } = messageData;
      const phone = this.extractPhoneNumber(from);
      
      logUserAction(phone, 'message_received', { 
        text: text.substring(0, 100),
        isReaction: messageData.isReaction || false 
      });

      // Chat-only mode removed; proceed with command parsing
      
      // Check if user has a pending transaction confirmation
      if (this.pendingTransactions.has(phone)) {
        logger.info(`Processing transaction confirmation for ${phone}: "${text}"`);
        await this.handleTransactionConfirmation(from, phone, text);
        return;
      }
      
      // Check if user is in a specific state (wallet creation, import, etc.)
      if (this.userStates.has(phone)) {
        await this.handleStatefulMessage(from, phone, text);
        return;
      }

      // Parse the command/intent
      const parsed = commandParser.parseInput(text);
      
      // Debug logging to see what's happening
      logger.info(`Command parsed: ${text} -> Intent: ${parsed.intent}`);
      
      if (parsed.intent === 'UNKNOWN') {
        // Check if this is a first-time user (no wallet, no state) ONLY for unknown commands
        const existingUser = await users.findUserByPhone(phone);
        if (!existingUser && !text.toLowerCase().includes('help')) {
          await this.sendMessage(from, this.getWelcomeMessage());
          return;
        }
        // For existing users with unknown commands, show help
        await this.sendMessage(from, this.getUnknownCommandResponse());
        return;
      }
      
      if (parsed.intent === 'ERROR') {
        await this.sendMessage(from, 'Sorry, I couldn’t process that request. Please try again.');
        return;
      }
      
      // Admin-only commands (STATUS and RESET)
      if (this.isAdminCommand(text)) {
        await this.handleAdminCommand(from, phone, text);
        return;
      }
      
      // Route to appropriate handler
      await this.routeCommand(from, phone, parsed);
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, {
        action: 'handle_message',
        phone: this.extractPhoneNumber(messageData.from),
        message: messageData.text
      });
      
      // Create enhanced error message with recovery options
      const enhancedMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      
      await this.sendMessage(messageData.from, enhancedMessage);
      
      // If it's a high severity error, log additional details
      if (errorInfo.severity === 'high') {
        logger.error('High severity error in message handling:', {
          phone: this.extractPhoneNumber(messageData.from),
          error: error.message,
          stack: error.stack
        });
      }
    }
  }

  // Handle shared contact payload
  async handleSharedContact(payload) {
    const { from, phones } = payload;
    const senderPhone = this.extractPhoneNumber(from);
    try {
      const { users } = require('../services/database');
      // Prefer the first resolvable phone
      for (const p of phones) {
        const normalized = p.replace(/^\+/, '');
        const contactUser = await users.findUserByPhone(normalized);
        if (contactUser) {
          // Get display name - use phone number if no other info available
          const displayName = normalized; // Could be enhanced to get actual name from contacts
          
          await this.sendMessage(from, `✅ Contact is registered on ZAPPO testnet.\n\n🏦 *Testnet Address:* \`${contactUser.wallet_address}\`\n\n🧪 How much testnet ETH do you want to send?`);
          // Prime a state to expect amount then confirmation
          this.userStates.set(senderPhone, {
            state: 'AWAITING_AMOUNT_FOR_CONTACT',
            targetAddress: contactUser.wallet_address,
            contactPhone: normalized,
            contactName: displayName,
            timestamp: Date.now()
          });
          return;
        } else {
          // Not registered → offer claim-link escrow flow
          await this.sendMessage(from, `👤 This contact isn't registered on ZAPPO testnet yet.\n\nThey'll have up to 3 days to claim a testnet transfer you initiate; if they don't, it's automatically refunded to you.\n\n🧪 *Note:* This uses testnet ETH - no real money involved!\n\nHow much testnet ETH would you like to send?`);
          this.userStates.set(senderPhone, {
            state: 'AWAITING_AMOUNT_FOR_UNREGISTERED',
            recipientPhone: normalized,
            timestamp: Date.now()
          });
          return;
        }
      }
      await this.sendMessage(from, 'ℹ️ Couldn’t read a phone number from that contact. Please share again or paste a 0x address.');
    } catch (e) {
      logger.error('Error handling shared contact:', e);
      await this.sendMessage(from, '❌ Could not process the shared contact. Please try again.');
    }
  }
  
  // Route commands to appropriate handlers
  async routeCommand(from, phone, parsed) {
    const { intent, parameters } = parsed;
    
    try {
      switch (intent) {
        case 'HELP':
          await this.sendMessage(from, commandParser.getHelpText());
          break;
          
        case 'GREETING':
          await this.handleGreeting(from, phone);
          break;
          
        case 'CREATE_WALLET':
          await this.handleCreateWallet(from, phone);
          break;
          
        case 'IMPORT_WALLET':
          await this.handleImportWallet(from, phone);
          break;
          
        case 'BACKUP_WALLET':
          await walletHandler.handleBackup(from, phone);
          break;
          
        case 'GET_BALANCE':
          await transactionHandler.handleGetBalance(from, phone);
          break;
          
        case 'GET_HISTORY':
          await transactionHandler.handleGetHistory(from, phone);
          break;
          
        case 'SEND_ARB':
        case 'SEND_COMMAND':
        case 'NATURAL_SEND':
          await this.handleSendTransaction(from, phone, parameters);
          break;
          
        case 'SEND_ARB_START':
          await this.handleSendTransaction(from, phone, { intent: 'SEND_ARB_START' });
          break;

        case 'SEND_FUNDS':
          await this.handleSendFundsMenu(from, phone);
          break;

        case 'EXPLORE_DEFI':
          await this.handleExploreDeFiMenu(from, phone);
          break;

        case 'SEND_TO_CONTACT':
          await this.handleSendToContactMenu(from, phone);
          break;

        case 'SWAP_USDC':
          await this.handleSwapUSDC(from, phone);
          break;

        case 'DEPOSIT_FUNDS':
          await this.handleDepositFunds(from, phone);
          break;

        case 'DEPOSIT_ETH':
          await this.handleDepositETH(from, phone);
          break;

        case 'DEPOSIT_USDC':
          await this.handleDepositUSDC(from, phone);
          break;
          
        case 'ADD_CONTACT':
          await contactHandler.handleAddContact(from, phone, parameters);
          break;
          
        case 'LIST_CONTACTS':
          await contactHandler.handleListContacts(from, phone);
          break;

        case 'CLAIM':
          await this.handleClaimFlow(from, phone, parameters.token);
          break;

        case 'MAINNET_STATUS':
          await this.handleMainnetStatus(from, phone);
          break;
          
        default:
          await this.sendMessage(from, this.getUnknownCommandResponse());
      }
      
      logUserAction(phone, 'command_executed', { intent, success: true });
      
    } catch (error) {
      logger.error(`Error executing command ${intent}:`, error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
      logUserAction(phone, 'command_executed', { intent, success: false, error: error.message });
    }
  }

  // Handle claim flow when user sends CLAIM <TOKEN>
  async handleClaimFlow(from, phone, tokenPlain) {
    try {
      logger.info(`Claim attempt: ${phone} with token: ${tokenPlain?.substring(0, 8)}...`);
      
      // Ensure user has wallet; if not, prompt and exit
      const hasWallet = await walletHandler.validateUserWallet(phone);
      if (!hasWallet) {
        logger.info(`User ${phone} has no wallet, prompting wallet creation`);
        await this.sendMessage(from, `🌟 *Welcome! You have ETH waiting to claim!* 🌟\n\nTo receive your ETH, you need a wallet. Would you like me to:\n\n🆕 *Create a new wallet* (recommended for beginners)\n📥 *Import an existing wallet*\n\nReply with "create wallet" or "import wallet" to continue.`);
        return;
      }
      
      const wallet = await walletHandler.getUserWallet(phone);
      logger.info(`User ${phone} has wallet: ${wallet.address}`);
      
      const result = await claimsService.validateAndClaim({ 
        tokenPlain, 
        claimerPhone: phone, 
        recipientWalletAddress: wallet.address 
      });
      
      logger.info(`Claim successful for ${phone}: ${result.transferAmount} ETH`);
      
      await this.sendMessage(from, `✅ *Claimed Successfully!*

💰 *Amount Received:* ${result.transferAmount.toFixed(6)} ETH
⛽ *Gas Fee:* ${result.gasCost.toFixed(6)} ETH
🔗 *Transaction Hash:* \`${result.tx.hash}\`
📊 *View on Fuji Testnet:* https://testnet.snowtrace.io/tx/${result.tx.hash}

*Note: Gas fees were deducted from the held amount to complete your claim.*`);
      
    } catch (error) {
      logger.error(`Claim failed for ${phone}:`, error);
      
      // Provide better error messages based on error type
      if (error.message.includes('Amount too small')) {
        await this.sendMessage(from, `❌ *Claim Failed - Amount Too Small*

${error.message}

💡 *Solutions:*
• Ask sender to send more ETH
• Wait for lower network congestion
• Contact sender for assistance

⛽ *Gas fees vary with network activity*`);
      } else if (error.message.includes('gas fees')) {
        await this.sendMessage(from, `❌ *Claim Failed - Gas Fee Issue*

${error.message}

💡 *What happened:*
• Network gas fees are higher than expected
• Available amount is too small to cover fees

🔄 *Try again:*
• Ask sender to send at least 0.005 ETH
• Or try again during off-peak hours`);
      } else {
        await this.sendMessage(from, `❌ *Unable to claim:* ${error.message}\n\n🔍 *Possible reasons:*\n• Link expired or already used\n• Wrong phone number\n• Insufficient funds for gas fees\n• Technical issue\n\n💡 *Need help?* Contact support or ask the sender to resend the claim link.`);
      }
    }
  }
  
  // Handle wallet creation flow
  async handleCreateWallet(from, phone) {
    try {
      // Check if user already has a testnet wallet
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        const message = existingUser.mainnet_migrated 
          ? '✅ You already have a testnet wallet! Your mainnet wallet is safely preserved.\n\nUse `/balance` to check your testnet balance or `/backup` to export your testnet private key.'
          : '❌ You already have a wallet! Use `/backup` to export your private key.';
        await this.sendMessage(from, message);
        return;
      }
      
      // Check if user is a mainnet user
      const isMainnetUser = await testnetMigration.isMainnetUser(phone);
      
      if (isMainnetUser) {
        // Show special welcome message for mainnet users
        const mainnetUserData = await testnetMigration.getMainnetUser(phone);
        const welcomeMessage = `🏦 *Welcome back to ZAPPO!*

🔄 *Testnet Mode Active*

Your mainnet wallet is safe and will be restored when we return to mainnet. For now, let's explore ZAPPO on testnet!

📊 *Your Mainnet Wallet:*
• Address: \`${mainnetUserData?.wallet_address || 'Unknown'}\`
• This wallet is preserved and secure

🧪 *Creating your testnet wallet now...*`;

        await this.sendMessage(from, welcomeMessage);
      } else {
        await this.sendMessage(from, '🔄 Creating your wallet... This may take a moment.');
      }
      
      const result = await walletHandler.createWallet(phone);
      
      if (result.success) {
        if (result.isMainnetUser) {
          // Special success message for migrated users
          await this.sendMessage(from, `✅ *Testnet Wallet Created!*

🧪 *Your Testnet Wallet:*
• Address: \`${result.walletAddress}\`
• Ready for testnet transactions

💧 *Get Free Testnet ETH:*
🔗 [arbitrum Faucet](https://arbitrum.faucet.dev/ArbSepolia)
• Visit the faucet to get free testnet ETH
• Use your new testnet address above

🏦 *Your Mainnet Wallet:*
• Address: \`${result.mainnetAddress}\`
• Safe and will be restored later

Try these testnet commands:
• \`/balance\` - Check testnet balance
• \`/backup\` - Export testnet private key
• \`/help\` - See all commands`);
        } else {
          // Regular success message for new users
          await this.sendMessage(from, `✅ *Wallet Created Successfully!*

🏦 Your wallet is now ready to use! Try:
• \`/balance\` - Check your balance
• \`/backup\` - Export your private key
• \`/help\` - See all commands

� *Get Free Testnet ETH:*
🔗 [arbitrum Faucet](https://arbitrum.faucet.dev/ArbSepolia)

💡 *This is testnet mode - perfect for  testing!*`);
        }
        
        // Send wallet address as separate message for easy copying
        await this.sendMessage(from, `📋 *Your Testnet Wallet Address:*\n\`${result.walletAddress}\`\n\n*Tap to copy this address for the faucet!*`);
      } else {
        await this.sendMessage(from, `❌ Failed to create wallet: ${result.error}`);
      }
      
    } catch (error) {
      logger.error('Error creating wallet:', error);
      await this.sendMessage(from, `❌ Error creating wallet: ${error.message}`);
    }
  }
  
  // Handle greeting messages
  async handleGreeting(from, phone) {
    try {
      // Check if user has a wallet
      const existingUser = await users.findUserByPhone(phone);
      
      if (!existingUser) {
        // New user - send welcome message
        await this.sendMessage(from, this.getWelcomeMessage());
        return;
      }
      
      // Existing user - show fancy options
      const wallet = await walletHandler.getUserWallet(phone);
      if (wallet) {
        // Get fresh balance from blockchain
        const freshBalance = await nebulaService.getBalance(wallet.address);
        const balanceValue = parseFloat(freshBalance.balance) || 0;
        
        await this.sendMessage(from, `👋 *Hey there, Crypto Explorer!* 🚀

💰 *Balance:* ${balanceValue.toFixed(6)} ETH (Testnet)

🎯 *What's your next move?*

💸 **Send Funds to Friends**
   • Quick transfers to contacts
   • Share crypto instantly
   • Type: "send funds"

🌊 **Explore DeFi**
   • Check your balance & history
   • View transaction details  
   • Type: "explore defi"

🆘 **Need Help?**
   • Type "help" for all commands

🧪 *Testnet Mode - Safe to experiment!*`);
      } else {
        // User exists but no wallet - shouldn't happen, but handle gracefully
        await this.sendMessage(from, `👋 Hello! It seems there was an issue with your wallet. Please type "create wallet" to set up a new one.`);
      }
      
    } catch (error) {
      logger.error('Error handling greeting:', error);
      await this.sendMessage(from, `👋 Hello! Welcome to ZAPPO. Type "help" to see what I can do!`);
    }
  }
  
  // Handle wallet import flow
  async handleImportWallet(from, phone) {
    try {
      // Check if user already has a wallet
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        await this.sendMessage(from, 'You already have a wallet set up. You can export your private key anytime with /backup.');
        return;
      }
      
      // Set user state to expect private key
      this.userStates.set(phone, {
        state: 'IMPORTING_WALLET',
        timestamp: Date.now()
      });
      
      await this.sendMessage(from, `Let’s import your wallet.

Please paste your private key here to proceed.

Security tips:
- Share your private key only in this chat.
- Never share it with anyone else.
- We’ll encrypt it securely.

You can type cancel to stop anytime.`);
      
    } catch (error) {
      logger.error('Error starting wallet import:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Send Funds" menu option
  async handleSendFundsMenu(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      await this.sendMessage(from, `💸 *Send Funds to Friends* 🚀

Choose how you want to send:

📱 **Send to Contact**
   • Pick from your WhatsApp contacts
   • Type: "send to contact"

💰 **Send Specific Amount**
   • Send ETH to any address
   • Type: "send 0.1 ETH to 0x..."

📲 **Quick Send**
   • Share contact and I'll ask for amount
   • Just share a contact!

💡 **Tips:**
   • All transactions are on testnet
   • Gas fees are very low
   • Type "balance" to check funds first

🔙 Type "hi" to go back to main menu`);
      
    } catch (error) {
      logger.error('Error handling send funds menu:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Send to Contact" option
  async handleSendToContactMenu(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      // Set user state to await contact sharing
      this.userStates.set(phone, {
        state: 'AWAITING_CONTACT_FOR_SEND',
        timestamp: Date.now()
      });

      await this.sendMessage(from, `📱 *Send to WhatsApp Contact* 🚀

Please share a contact from your WhatsApp:

1️⃣ Tap the 📎 (attachment) button
2️⃣ Select "Contact"  
3️⃣ Choose the person you want to send ETH to
4️⃣ Send the contact

I'll then ask you how much ETH to send! 

💡 *Tip:* The person doesn't need ZAPPO yet - they'll get a claim link to receive the funds.

🔙 Type "cancel" to go back`);
      
    } catch (error) {
      logger.error('Error handling send to contact menu:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Explore DeFi" menu option  
  async handleExploreDeFiMenu(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      // Set user state to await DeFi menu selection
      this.userStates.set(phone, {
        state: 'AWAITING_DEFI_SELECTION',
        timestamp: Date.now()
      });

      const wallet = await walletHandler.getUserWallet(phone);
      
      await this.sendMessage(from, `🌊 *ZAPPO DeFi Hub* 🏦

🔹 **Your Wallet:** \`${wallet?.address?.slice(0,6)}...${wallet?.address?.slice(-4)}\`
🔹 **Network:** Arbitrum Sepolia

📋 **Choose an option:**

*1️⃣ Swap Tokens*
   Exchange ETH ↔ USDC at best rates

*2️⃣ Deposit USDC*
   Earn ZAP tokens (1 USDC = 1 ZAP)

*3️⃣ Check Balance* 
   View your token balances

*4️⃣ Transaction History*
   See your recent DeFi activity

🎯 **Reply with a number (1-4) to continue** �

Your DeFi Dashboard:

� **Swap Tokens**
   • Swap ETH ↔ USDC
   • Best rates on Arbitrum
   • Type: "swap usdc"

🏦 **Deposit to Vault**
   • Earn yield on your ETH
   • Secure lending protocols
   • Type: "deposit funds"

📊 **Portfolio Management**
   • "balance" - Check current balance
   • "history" - View recent transactions

🔍 **Wallet Details**
   • Address: \`${wallet?.address || 'Loading...'}\`
   • Network: Arbitrum Sepolia (Testnet)

🎯 **Quick Actions:**
   • "swap usdc" - Exchange ETH for USDC
   • "deposit funds" - Earn yield on deposits
   • "balance" - Check current balance
   • "history" - View transaction history

🧪 **Testnet Info:**
   • Practice DeFi safely with testnet tokens
   • No real money involved
   • Perfect for learning!

🔙 Type "back" to return to main menu`);
      
    } catch (error) {
      logger.error('Error handling explore DeFi menu:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Swap USDC" option
  async handleSwapUSDC(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      const wallet = await walletHandler.getUserWallet(phone);
      const freshBalance = await nebulaService.getBalance(wallet.address);
      const ethBalance = parseFloat(freshBalance.balance) || 0;

      await this.sendMessage(from, `💱 *Swap ETH ↔ USDC* 🔄

Current Balance: ${ethBalance.toFixed(6)} ETH

🔄 **Swap Options:**

📤 **ETH → USDC**
   • Convert ETH to USDC stablecoin
   • Get stable value exposure
   • Type: "swap eth to usdc"

📥 **USDC → ETH**
   • Convert USDC back to ETH
   • Re-enter ETH exposure
   • Type: "swap usdc to eth"

💡 **Swap Benefits:**
   • Instant swaps via Uniswap V3
   • Best rates on Arbitrum
   • Low gas fees on testnet

⚠️ **Coming Soon:**
   This feature is being integrated with DEX protocols. 
   For now, you can practice with direct ETH transfers!

🎯 **Alternative Actions:**
   • "send eth" - Send ETH to contacts
   • "balance" - Check current balance

🔙 Type "hi" to go back to main menu`);
      
    } catch (error) {
      logger.error('Error handling swap USDC:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Deposit Funds" option
  async handleDepositFunds(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      const wallet = await walletHandler.getUserWallet(phone);
      const freshBalance = await nebulaService.getBalance(wallet.address);
      const ethBalance = parseFloat(freshBalance.balance) || 0;

      await this.sendMessage(from, `🏦 *Deposit to Yield Vault* 💰

Current Balance: ${ethBalance.toFixed(6)} ETH

💎 **Yield Opportunities:**

🏛️ **ETH Lending Pool**
   • Earn 3-5% APY on ETH deposits
   • Withdraw anytime
   • Type: "deposit eth"

💵 **USDC Vault**
   • Stable 4-6% APY
   • Lower risk option
   • Type: "deposit usdc"

📈 **Strategy Vaults**
   • Auto-compounding yields
   • 8-12% APY potential
   • Type: "strategy vault"

💡 **Vault Benefits:**
   • Professional yield farming
   • Automated strategies
   • Secure smart contracts

⚠️ **Coming Soon:**
   Vault integrations with Aave, Compound, and other protocols are being implemented!
   
🎯 **Current Options:**
   • Practice with testnet funds
   • Learn DeFi concepts safely
   • "send eth" for peer transfers

🔙 Type "hi" to go back to main menu`);
      
    } catch (error) {
      logger.error('Error handling deposit funds:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Deposit ETH" command
  async handleDepositETH(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      await this.sendMessage(from, `⚠️ *ETH Deposit Coming Soon!* 🚧

ETH deposits to earn ZAP tokens are being integrated.

🎯 **Available Now:**
   • "deposit usdc" - Deposit USDC to earn ZAP tokens
   • "balance" - Check your current balance

🔙 Type "hi" to go back to main menu`);
      
    } catch (error) {
      logger.error('Error handling ETH deposit:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Swap Tokens" command
  async handleSwapTokens(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      // Set user state to await amount input
      this.userStates.set(phone, {
        state: 'AWAITING_SWAP_AMOUNT',
        timestamp: Date.now()
      });

      // Get current balances to show user
      const balanceData = await getTokenBalances();

      await this.sendMessage(from, `🔄 *Swap USDC to WETH* 💱

🔹 **Current Balances:**
• USDC: ${balanceData.usdcBalance || '0.00'} USDC
• WETH: ${parseFloat(balanceData.wethBalance || '0').toFixed(6)} WETH

💱 **Exchange Rate:** Market rate via Uniswap V3

🎯 **How much USDC would you like to swap?**

Examples:
• Type "1" for 1 USDC
• Type "0.5" for 0.5 USDC  
• Type "5" for 5 USDC

💡 **Swap Features:**
• Best rates on Arbitrum
• Instant execution
• Low gas fees

🔙 Type "cancel" to go back`);
      
    } catch (error) {
      logger.error('Error handling swap tokens:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle "Deposit USDC" command
  async handleDepositUSDC(from, phone) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }

      // Set user state to await amount input
      this.userStates.set(phone, {
        state: 'AWAITING_USDC_DEPOSIT_AMOUNT',
        timestamp: Date.now()
      });

      await this.sendMessage(from, `💰 *Deposit USDC to Earn ZAP Tokens* 🏦

💱 **Current Rate:** 1 USDC = 1 ZAP token

🎯 **How much USDC would you like to deposit?**

Examples:
• Type "1" for 1 USDC
• Type "0.5" for 0.5 USDC  
• Type "10" for 10 USDC

💡 **Benefits:**
• Instant ZAP token rewards
• 1:1 conversion rate
• Secure smart contract

🔙 Type "cancel" to go back`);
      
    } catch (error) {
      logger.error('Error handling USDC deposit:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle send transaction flow
  async handleSendTransaction(from, phone, parameters) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }
      
      let sendParams;
      
      if (parameters.amount && (parameters.recipient || parameters.recipientPhone)) {
        // Direct parameters from regex match or phone-based flows
        sendParams = {
          amount: parameters.amount,
          recipient: parameters.recipient,
          recipientPhone: parameters.recipientPhone,
          name: parameters.name, // Preserve the name parameter
          valid: true
        };
      } else if (parameters.args) {
        // Parse from command arguments
        sendParams = commandParser.parseSendParameters(parameters.args);
      } else if (parameters.intent === 'SEND_ARB_START') {
        // Multi-step flow: user just typed "send ETH"
        this.userStates.set(phone, {
          state: 'AWAITING_CONTACT_FOR_SEND',
          timestamp: Date.now()
        });
        await this.sendMessage(from, `📱 *Send Testnet ETH - Step 1: Contact* 🧪\n\nPlease share the contact you want to send testnet ETH to.\n\nYou can:\n• Share a contact from your phone\n• Or type the phone number (e.g., 919489042245)\n\n🧪 *Note:* This uses testnet ETH - no real money!\n\nType "cancel" to stop.`);
        return;
      } else {
        await this.sendMessage(from, '❌ Invalid send format. Try: "send 1 ETH to 0x..." or just type "send ETH" for step-by-step.');
        return;
      }
      
      if (!sendParams.valid) {
        await this.sendMessage(from, `❌ ${sendParams.error}`);
        return;
      }
      
      // Validate amount
      if (!commandParser.validateAmount(sendParams.amount)) {
        await this.sendMessage(from, '❌ Invalid amount. Please enter a valid amount between 0.000001 and 1,000,000 ETH.');
        return;
      }
      
      // Process the transaction
      await transactionHandler.handleSendTransaction(from, phone, sendParams);
      
    } catch (error) {
      logger.error('Error handling send transaction:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle transaction confirmation responses
  async handleTransactionConfirmation(from, phone, text) {
    try {
      const pendingTx = this.pendingTransactions.get(phone);
      
      if (!pendingTx) {
        await this.sendMessage(from, '❌ No pending transaction found.');
        return;
      }
      
      // Handle confirmations
      if (commandParser.isConfirmation(text)) {
        // User confirmed the transaction
        logger.info(`Transaction confirmed by ${phone} with: ${text}`);
        this.pendingTransactions.delete(phone);
        
        // Check transaction type
        if (pendingTx.type === 'usdc_deposit') {
          await this.executeUSDCDeposit(from, phone, pendingTx);
        } else if (pendingTx.type === 'usdc_swap') {
          await this.executeUSDCSwap(from, phone, pendingTx);
        } else {
          // Regular transaction
          await transactionHandler.executePendingTransaction(from, phone, pendingTx);
        }
        
      } else if (commandParser.isCancellation(text)) {
        // User cancelled the transaction
        logger.info(`Transaction cancelled by ${phone} with: ${text}`);
        this.pendingTransactions.delete(phone);
        
        if (pendingTx.type === 'usdc_deposit') {
          await this.sendMessage(from, '❌ USDC deposit cancelled.');
        } else if (pendingTx.type === 'usdc_swap') {
          await this.sendMessage(from, '❌ USDC swap cancelled.');
        } else {
          await this.sendMessage(from, '❌ Transaction cancelled.');
        }
        
      } else {
        // Invalid response
        logger.info(`Invalid confirmation response from ${phone}: ${text}`);
        
        if (pendingTx.type === 'usdc_deposit') {
          await this.sendMessage(from, '❓ Please reply "yes" to confirm your USDC deposit or "no" to cancel.');
        } else if (pendingTx.type === 'usdc_swap') {
          await this.sendMessage(from, '❓ Please reply "yes" to confirm your USDC swap or "no" to cancel.');
        } else {
          await this.sendMessage(from, '❓ Please react with 👍 to confirm or 👎 to cancel the transaction.');
        }
      }
      
    } catch (error) {
      logger.error('Error handling transaction confirmation:', error);
      this.pendingTransactions.delete(phone);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle stateful messages (wallet import, etc.)
  async handleStatefulMessage(from, phone, text) {
    try {
      const msg = (text ?? '').toString().trim();
      const userState = this.userStates.get(phone);
      
      if (msg.toLowerCase() === 'cancel') {
        this.userStates.delete(phone);
        await this.sendMessage(from, '❌ Operation cancelled.');
        return;
      }
      
      // If there is no active state, guide the user instead of crashing
      if (!userState) {
        await this.sendMessage(from, 'There’s no active action to continue. Please start again (e.g., share a contact or type a command).');
        return;
      }

      // Check if state has expired (5 minutes)
      if (Date.now() - userState.timestamp > 5 * 60 * 1000) {
        this.userStates.delete(phone);
        await this.sendMessage(from, '⏰ Operation timed out. Please try again.');
        return;
      }
      
      switch (userState.state) {
        case 'IMPORTING_WALLET':
          await this.handlePrivateKeyInput(from, phone, text);
          break;
          
        case 'AWAITING_DEFI_SELECTION': {
          const selection = msg.trim();
          this.userStates.delete(phone);
          
          switch(selection) {
            case '1':
              await this.handleSwapTokens(from, phone);
              break;
            case '2':
              await this.handleDepositUSDC(from, phone);
              break;
            case '3':
              await transactionHandler.handleBalance(from, phone);
              break;
            case '4':
              await transactionHandler.handleHistory(from, phone);
              break;
            case 'back':
              await this.handleGreeting(from, phone);
              break;
            default:
              await this.sendMessage(from, '❌ Please select a valid option (1-4) or type "back"');
              await this.handleExploreDeFiMenu(from, phone);
          }
          break;
        }
          
        case 'AWAITING_AMOUNT_FOR_CONTACT': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            const target = userState.targetAddress;
            const contactName = userState.contactName;
            const contactPhone = userState.contactPhone;
            this.userStates.delete(phone);
            await this.handleSendTransaction(from, phone, { 
              amount, 
              recipient: target, 
              name: contactName,
              recipientPhone: contactPhone 
            });
          } else {
            await this.sendMessage(from, '❌ Please enter a valid ETH amount (e.g., 0.1).');
          }
          break;
        }
        case 'AWAITING_AMOUNT_FOR_UNREGISTERED': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            const recipientPhone = userState.recipientPhone;
            this.userStates.delete(phone);
            // Route through send flow; it will detect phone-like recipient and use claim-link escrow
            await this.handleSendTransaction(from, phone, { 
              amount, 
              recipientPhone: recipientPhone, // Use recipientPhone for unregistered users
              name: recipientPhone 
            });
          } else {
            await this.sendMessage(from, '❌ Please enter a valid ETH amount (e.g., 0.1).');
          }
          break;
        }
        case 'AWAITING_CONTACT_FOR_SEND': {
          // User provided contact, now ask for amount
          this.userStates.set(phone, {
            state: 'AWAITING_AMOUNT_FOR_SEND',
            recipientPhone: msg,
            timestamp: Date.now()
          });
          await this.sendMessage(from, `📱 *Send Testnet ETH - Step 2: Amount* 🧪\n\nHow much testnet ETH would you like to send to ${msg}?\n\nPlease enter the amount (e.g., 0.1, 1.5, 10)\n\n🧪 *Note:* This is testnet ETH - safe to test!\n\nType "cancel" to stop.`);
          break;
        }
        case 'AWAITING_AMOUNT_FOR_SEND': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            const recipientPhone = userState.recipientPhone;
            this.userStates.delete(phone);
            // Route through send flow; it will detect phone-like recipient and use claim-link escrow
            await this.handleSendTransaction(from, phone, { 
              amount, 
              recipientPhone: recipientPhone, // Use recipientPhone for manual phone entry
              name: recipientPhone 
            });
          } else {
            await this.sendMessage(from, '❌ Please enter a valid ETH amount (e.g., 0.1).');
          }
          break;
        }

        case 'AWAITING_USDC_DEPOSIT_AMOUNT': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            this.userStates.delete(phone);
            await this.handleDepositConfirmation(from, phone, amount);
          } else {
            await this.sendMessage(from, '❌ Please enter a valid USDC amount (e.g., 1, 0.5, 10).');
          }
          break;
        }

        case 'AWAITING_SWAP_AMOUNT': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            this.userStates.delete(phone);
            await this.handleSwapConfirmation(from, phone, amount);
          } else if (msg.toLowerCase() === 'cancel') {
            this.userStates.delete(phone);
            await this.handleExploreDeFiMenu(from, phone);
          } else {
            await this.sendMessage(from, '❌ Please enter a valid USDC amount (e.g., 1, 0.5, 5).');
          }
          break;
        }
          
        default:
          this.userStates.delete(phone);
          await this.sendMessage(from, '❌ Invalid state. Please try again.');
      }
      
    } catch (error) {
      logger.error('Error handling stateful message:', error);
      this.userStates.delete(phone);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle deposit confirmation
  async handleDepositConfirmation(from, phone, amount) {
    try {
      const wallet = await walletHandler.getUserWallet(phone);
      if (!wallet) {
        await this.sendMessage(from, '❌ Wallet not found. Please create a wallet first.');
        return;
      }

      // Get current balances
      let currentUSDCBalance = 0;
      let currentZAPBalance = 0;
      
      try {
        // Get current USDC balance from smart contract
        const balances = await checkBalances();
        if (balances && balances.usdc) {
          currentUSDCBalance = parseFloat(balances.usdc);
        }
        
        // Get current ZAP balance
        const zapBalance = await getZAPBalance();
        const formattedZapBalance = (parseFloat(zapBalance) * 1e18).toFixed(0);
        currentZAPBalance = parseInt(formattedZapBalance);
      } catch (error) {
        logger.warn('Could not fetch current balances:', error.message);
      }

      // Calculate what user will receive (1:1 ratio for display)
      const zapTokensToReceive = amount;
      const newZAPBalance = currentZAPBalance + (amount * 1e18); // Estimate new balance

      const confirmMessage = `💰 *USDC Deposit Confirmation* 🏦

� *Current Holdings:*
• USDC Balance: ${currentUSDCBalance.toFixed(4)} USDC
• ZAP Balance: ${currentZAPBalance.toLocaleString()} ZAP

📥 *Deposit Details:*
• Amount: ${amount} USDC
• Rate: 1 USDC = 1 ZAP token
• You'll Receive: ${zapTokensToReceive} ZAP tokens

� *After Deposit:*
• New USDC Balance: ${(currentUSDCBalance - amount).toFixed(4)} USDC
• New ZAP Balance: ${newZAPBalance.toLocaleString()} ZAP

⚡ *Transaction Info:*
• Processing: Instant via smart contract
• Security: Fully audited contract
• Network: Arbitrum Sepolia testnet

*Reply "yes" to confirm or "no" to cancel*

⏱️ This confirmation expires in 5 minutes`;

      await this.sendMessage(from, confirmMessage);

      // Store pending deposit
      this.pendingTransactions.set(phone, {
        type: 'usdc_deposit',
        amount: amount,
        zapTokens: zapTokensToReceive,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error handling deposit confirmation:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Handle swap confirmation
  async handleSwapConfirmation(from, phone, amount) {
    try {
      const wallet = await walletHandler.getUserWallet(phone);
      if (!wallet) {
        await this.sendMessage(from, '❌ Wallet not found. Please create a wallet first.');
        return;
      }

      // Get quote and current balances
      const quoteResult = await getSwapQuote(amount);
      
      if (!quoteResult.success) {
        await this.sendMessage(from, `❌ ${quoteResult.error}\n\n🔙 Type "1" to try a different amount`);
        return;
      }

      const currentUSDCBalance = parseFloat(quoteResult.currentUSDCBalance);
      const wethToReceive = parseFloat(quoteResult.amountOut);

      // Get current WETH balance
      let currentWETHBalance = 0;
      try {
        const balanceData = await getTokenBalances();
        if (balanceData && balanceData.wethBalance) {
          currentWETHBalance = parseFloat(balanceData.wethBalance);
        }
      } catch (error) {
        logger.warn('Could not fetch WETH balance:', error.message);
      }

      const confirmMessage = `🔄 *USDC to WETH Swap Confirmation* 💱

📊 *Current Holdings:*
• USDC Balance: ${currentUSDCBalance.toFixed(4)} USDC
• WETH Balance: ${currentWETHBalance.toFixed(6)} WETH

🔄 *Swap Details:*
• Input: ${amount} USDC
• Output: ~${wethToReceive.toFixed(6)} WETH
• Rate: Market rate via Uniswap V3

📈 *After Swap:*
• New USDC Balance: ${(currentUSDCBalance - amount).toFixed(4)} USDC
• New WETH Balance: ${(currentWETHBalance + wethToReceive).toFixed(6)} WETH

⚡ *Transaction Info:*
• Processing: Instant via Uniswap V3
• Slippage: 5% maximum
• Network: Arbitrum Sepolia

*Reply "yes" to confirm or "no" to cancel*

⏱️ This confirmation expires in 5 minutes`;

      await this.sendMessage(from, confirmMessage);

      // Store pending swap
      this.pendingTransactions.set(phone, {
        type: 'usdc_swap',
        amount: amount,
        expectedOutput: wethToReceive,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error handling swap confirmation:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Execute USDC deposit
  async executeUSDCDeposit(from, phone, depositData) {
    try {
      const { amount, zapTokens } = depositData;

      await this.sendMessage(from, `⏳ *Processing Deposit...* 

💰 Depositing ${amount} USDC to vault...
🔄 Smart contract execution in progress...

Please wait while we process your transaction...`);

      // Execute the actual deposit using connections.js
      try {
        await deposit(amount);
        
        // Log the successful deposit
        logUserAction(phone, 'usdc_deposit', { 
          usdcAmount: amount, 
          zapTokens: zapTokens,
          success: true 
        });

        // Send success message with 1:1 display ratio
        await this.sendMessage(from, `✅ *Deposit Successful!* 🎉

💰 **Deposited:** ${amount} USDC
📈 **Received:** ${zapTokens} ZAP tokens
💱 **Rate:** 1:1 conversion

🎯 **Your ZAP Tokens:**
• Total ZAP earned: ${zapTokens}
• Earning potential: Active
• Withdraw anytime

🌊 **Next Steps:**
• Type "balance" to check updated balance
• Type "explore defi" for more DeFi options
• Type "deposit usdc" to deposit more

🎊 Welcome to the ZAP ecosystem!`);

      } catch (error) {
        logger.error('Deposit execution failed:', error);
        
        // Log the failed deposit
        logUserAction(phone, 'usdc_deposit', { 
          usdcAmount: amount, 
          zapTokens: zapTokens,
          success: false,
          error: error.message 
        });

        await this.sendMessage(from, `❌ *Deposit Failed* 

The deposit transaction could not be completed.

**Possible reasons:**
• Network congestion
• Insufficient funds in vault contract
• Temporary technical issue

**Please try again or contact support.**

🔙 Type "deposit usdc" to try again`);
      }

    } catch (error) {
      logger.error('Error executing USDC deposit:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }

  // Execute USDC to WETH swap
  async executeUSDCSwap(from, phone, swapData) {
    try {
      const { amount, expectedOutput } = swapData;

      await this.sendMessage(from, `⏳ *Processing Swap...* 

🔄 Swapping ${amount} USDC for WETH...
🌊 Uniswap V3 execution in progress...

Please wait while we process your transaction...`);

      // Execute the actual swap using swapService.js
      try {
        const swapResult = await swapUSDCtoWETH(amount);
        
        if (!swapResult.success) {
          throw new Error(swapResult.error);
        }
        
        // Log the successful swap
        logUserAction(phone, 'usdc_swap', { 
          usdcAmount: amount, 
          wethReceived: swapResult.amountOut,
          transactionHash: swapResult.transactionHash,
          success: true 
        });

        // Send success message
        await this.sendMessage(from, `✅ *Swap Successful!* 🎉

🔄 **Swapped:** ${amount} USDC → ${swapResult.amountOut} WETH
💱 **Rate:** Market rate via Uniswap V3
🔗 **Transaction:** https://sepolia.arbiscan.io/tx/${swapResult.transactionHash}

📊 **Updated Balances:**
• USDC: ${swapResult.newUSDCBalance} USDC
• WETH: ${swapResult.newWETHBalance} WETH

🌊 **Next Steps:**
• Type "balance" to check updated balance
• Type "1" to swap more tokens
• Type "explore defi" for more DeFi options

🎊 Happy trading!`);

      } catch (error) {
        logger.error('Swap execution failed:', error);
        
        // Log the failed swap
        logUserAction(phone, 'usdc_swap', { 
          usdcAmount: amount, 
          expectedOutput: expectedOutput,
          success: false,
          error: error.message 
        });

        await this.sendMessage(from, `❌ *Swap Failed* 

The swap transaction could not be completed.

**Error:** ${error.message}

**Possible reasons:**
• Insufficient USDC balance
• Low liquidity in pool
• Network congestion
• Slippage too high

**Please try again with a smaller amount.**

🔙 Type "1" to try again`);
      }

    } catch (error) {
      logger.error('Error executing USDC swap:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle private key input for wallet import
  async handlePrivateKeyInput(from, phone, privateKey) {
    try {
      // Validate private key format
      if (!privateKey.match(/^0x[a-fA-F0-9]{64}$/)) {
        await this.sendMessage(from, 'That doesn’t look like a valid private key. Please send a 64‑character hex key starting with 0x.');
        return;
      }
      
      await this.sendMessage(from, 'Importing your wallet… this usually takes a moment.');
      
      const result = await walletHandler.importWallet(phone, privateKey);
      
      if (result.success) {
        this.userStates.delete(phone);
        await this.sendMessage(from, `Wallet imported successfully.

Address: \`${result.walletAddress}\`
Balance: ${result.balance} ETH

You’re all set. You can try:
- /balance to check your balance
- /history to view recent transactions
- /help to see all commands`);
      } else {
        await this.sendMessage(from, `Couldn’t import the wallet: ${result.error}`);
      }
      
    } catch (error) {
      logger.error('Error importing wallet:', error);
      this.userStates.delete(phone);
      await this.sendMessage(from, `We couldn’t complete the import: ${error.message}`);
    }
  }
  
  // Store pending transaction for confirmation
  storePendingTransaction(phone, transactionData) {
    this.pendingTransactions.set(phone, {
      ...transactionData,
      timestamp: Date.now()
    });
  }
  
  // Extract phone number from WhatsApp ID
  extractPhoneNumber(whatsappId) {
    // Remove @s.whatsapp.net suffix and country code if present
    return whatsappId.replace('@s.whatsapp.net', '').replace('@c.us', '');
  }
  
  // Send message helper
  async sendMessage(to, message) {
    try {
      // FIXED: Baileys expects message content as object, not string
      const messageContent = typeof message === 'string' 
        ? { text: message } 
        : message;

      // Normalize JID to ensure valid WhatsApp ID
      let jid = to || '';
      if (typeof jid === 'string') {
        if (!jid.includes('@')) {
          jid = `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
        } else if (jid.endsWith('@c.us')) {
          jid = jid.replace('@c.us', '@s.whatsapp.net');
        }
      }

      // Route through our WhatsApp service to leverage queueing & connection checks
      await whatsappService.sendMessage(jid, messageContent);
    } catch (error) {
      logger.error('Error sending message:', error);
    }
  }
  
  // Get beautiful welcome message for first-time users
  getWelcomeMessage() {
    return `🌟 *Welcome to ZAPPO!* 🌟

🎉 *Your Personal Arbitrum Wallet on WhatsApp*

I'm here to help you manage your funds right from your phone! 

💼 *What would you like to do?*

🆕 *Create a New Wallet*
• Type: "create wallet" or "new wallet"
• I'll generate a secure wallet for you
• Perfect for beginners

📥 *Import Existing Wallet*
• Type: "import wallet" 
• Use your private key to restore access
• Great if you already have a wallet

💸 *Send ETH to Contacts*
• Type: "send ETH" to start sending to your contacts
• Easy transfers via WhatsApp contacts!

❓ *Need Help?*
• Type: \`/help\` for all commands
• Ask me anything about crypto!

🚀 *Ready to get started?* Just let me know what you'd prefer!`;
  }

  // Get response for unknown commands
  getUnknownCommandResponse() {
    return `🤖 *ZAPPO - ETH Wallet Bot*

I didn't understand that command. Here are some things you can try:

• \`/help\` - Show all commands
• "create wallet" - Create a new wallet
• "import wallet" - Import existing wallet
• \`/balance\` - Check your balance
• "send ETH" - Start sending ETH to contacts
• "send 1 ETH to 0x..." - Send ETH to address

Need help? Type \`/help\` for a full list of commands!`;
  }

  // Check if command is admin-only
  isAdminCommand(text) {
    const command = text.toLowerCase().trim();
    return command === '/status' || command === '/reset' || command.startsWith('/admin');
  }

  // Handle admin commands with authorization
  async handleAdminCommand(from, phone, text) {
    // Define admin phone numbers (replace with actual admin numbers)
    const adminNumbers = [
      '919489042245', // Replace with actual admin phone numbers
      // Add more admin numbers as needed
    ];
    
    if (!adminNumbers.includes(phone)) {
      await this.sendMessage(from, '❌ Access denied. This command is restricted to administrators only.');
      logger.warn(`Unauthorized admin command attempt from ${phone}: ${text}`);
      return;
    }
    
    const command = text.toLowerCase().trim();
    
    try {
      switch (command) {
        case '/status':
          await this.handleStatusCommand(from, phone);
          break;
        case '/reset':
          await this.handleResetCommand(from, phone);
          break;
        default:
          await this.sendMessage(from, '❌ Unknown admin command. Available: /status, /reset');
      }
      
      logger.info(`Admin command executed by ${phone}: ${command}`);
      
    } catch (error) {
      logger.error(`Error executing admin command ${command}:`, error);
      await this.sendMessage(from, `❌ Error executing admin command: ${error.message}`);
    }
  }

  // Handle status command for admins
  async handleStatusCommand(from, phone) {
    try {
      const stats = {
        userStates: this.userStates.size,
        pendingTransactions: this.pendingTransactions.size,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
      
      const response = `🔧 *ZAPPO Admin Status*

👥 *Active User States:* ${stats.userStates}
⏳ *Pending Transactions:* ${stats.pendingTransactions}
⏱️ *Uptime:* ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m
💾 *Memory Usage:* ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB / ${Math.round(stats.memory.heapTotal / 1024 / 1024)}MB

🕐 *Timestamp:* ${new Date().toISOString()}`;

      await this.sendMessage(from, response);
      
    } catch (error) {
      logger.error('Error in status command:', error);
      await this.sendMessage(from, `❌ Error retrieving status: ${error.message}`);
    }
  }

  // Handle reset command for admins
  async handleResetCommand(from, phone) {
    try {
      const beforeStates = this.userStates.size;
      const beforeTransactions = this.pendingTransactions.size;
      
      this.userStates.clear();
      this.pendingTransactions.clear();
      
      const response = `🔄 *ZAPPO Admin Reset Complete*

✅ *Cleared:*
• User States: ${beforeStates} → 0
• Pending Transactions: ${beforeTransactions} → 0

🕐 *Reset at:* ${new Date().toISOString()}`;

      await this.sendMessage(from, response);
      logger.info(`Admin reset executed by ${phone}`);
      
    } catch (error) {
      logger.error('Error in reset command:', error);
      await this.sendMessage(from, `❌ Error executing reset: ${error.message}`);
    }
  }

  // Handle mainnet status check for existing users
  async handleMainnetStatus(from, phone) {
    try {
      const currentUser = await users.findUserByPhone(phone);
      const isMainnetUser = await testnetMigration.isMainnetUser(phone);
      
      if (!isMainnetUser) {
        await this.sendMessage(from, `ℹ️ *Testnet User*

You don't have a mainnet wallet with ZAPPO. This testnet wallet is your primary wallet.

🧪 *Current Status:* Testnet Only - Test without real money!

🔗 [Get Free Testnet ETH](https://arbitrum.faucet.dev/ArbSepolia)`);
        return;
      }

      const mainnetUserData = await testnetMigration.getMainnetUser(phone);
      
      const statusMessage = `🏦 *Mainnet Wallet Status*

✅ *Your mainnet wallet is safe and preserved*

📊 *Mainnet Wallet Details:*
• Address: \`${mainnetUserData?.wallet_address || 'Unknown'}\`
• Status: Preserved & Secure
• Network: arbitrum C-Chain (Mainnet)

🧪 *Current Testnet Wallet:*
• Address: \`${currentUser?.wallet_address || 'Not created'}\`
• Network: arbitrum Fuji (Testnet)
• Status: ${currentUser ? 'Active' : 'Not created'}

🔄 *Migration Info:*
• Migrated: ${currentUser?.migration_date ? new Date(currentUser.migration_date).toLocaleDateString() : 'N/A'}
• Your mainnet funds will be restored when ZAPPO returns to mainnet

💡 *For now, enjoy testing on Fuji testnet!*
🔗 [Get Free Testnet ETH](https://arbitrum.faucet.dev/ArbSepolia)`;

      await this.sendMessage(from, statusMessage);
      
    } catch (error) {
      logger.error('Error checking mainnet status:', error);
      await this.sendMessage(from, `❌ Error checking mainnet status: ${error.message}`);
    }
  }

  async executeUSDCDeposit(from, phone, pendingDeposit) {
    try {
      const { amount, zapTokens } = pendingDeposit;
      
      await this.sendMessage(from, '⏳ Processing your USDC deposit...');
      
      // Call the smart contract deposit function
      const result = await deposit(amount);
      
      if (result.success) {
        // Get updated balances
        const zapBalance = await getZAPBalance();
        const formattedZapBalance = (parseFloat(zapBalance) * 1e18).toFixed(0);
        
        // Get current USDC balance
        let currentUSDCBalance = 0;
        try {
          const balances = await checkBalances();
          if (balances && balances.usdc) {
            currentUSDCBalance = parseFloat(balances.usdc);
          }
        } catch (error) {
          logger.warn('Could not fetch updated USDC balance:', error.message);
        }
        
        const successMessage = `✅ *Deposit Successful!* 🎉

🎯 *Transaction Summary:*
• Deposited: ${amount} USDC
• ZAP Tokens Earned: ${zapTokens} ZAP
• Rate Applied: 1:1 conversion

📊 *Updated Balances:*
• Current USDC: ${currentUSDCBalance.toFixed(4)} USDC
• Total ZAP Tokens: ${parseInt(formattedZapBalance).toLocaleString()} ZAP

� *Transaction Details:*
• Hash: ${result.hash}
• Network: Arbitrum Sepolia
• Status: Confirmed

🌐 *View on Explorer:*
https://sepolia.arbiscan.io/tx/${result.hash}

🎊 *Welcome to the ZAP ecosystem!*

*Next Steps:*
• Type "balance" to check all balances
• Type "deposit usdc" to deposit more
• Type "explore defi" for more options`;

        await this.sendMessage(from, successMessage);
        
        logger.info(`USDC deposit successful for ${phone}: ${amount} USDC`);
      } else {
        await this.sendMessage(from, `❌ Deposit failed: ${result.error}`);
        logger.error(`USDC deposit failed for ${phone}: ${result.error}`);
      }
      
    } catch (error) {
      logger.error('Error executing USDC deposit:', error);
      await this.sendMessage(from, `❌ Deposit failed: ${error.message}`);
    }
  }
}

module.exports = {
  initializeCommandHandler: (whatsapp) => {
    const handler = new CommandHandler(whatsapp);
    handler.initialize();
    return handler;
  }
};
