const nebulaService = require('../services/nebula');
const walletHandler = require('./walletHandler');
const claimsService = require('../services/claims');
const { users, transactions } = require('../services/database');
const { logger, logUserAction, logTransaction } = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const errorRecovery = require('../utils/errorRecovery');
const config = require('../config');

/**
 * Handles all transaction-related operations including balance checks,
 * sending transactions, and managing transaction history
 * @class
 */
class TransactionHandler {
  /**
   * Creates a new TransactionHandler instance
   * Initializes the pending transactions map for storing transaction confirmations
   */
  constructor() {
    /** @private */
    this.pendingTransactions = new Map();
  }

  //#region Balance and History Operations
  
  /**
   * Handles user balance check requests
   * Gets the current balance from the blockchain and updates the database
   * @param {string} from - Message sender identifier
   * @param {string} phone - User's phone number
   * @returns {Promise<void>}
   * @throws {Error} If wallet is not found or balance check fails
   */
  async handleGetBalance(from, phone) {
    try {
      // Use retry mechanism for critical operations
      const result = await errorHandler.withRetry(async () => {
        // Get user wallet
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found. Please create a wallet first.');
        }

        // Get fresh balance from blockchain
        const currentBalance = await nebulaService.getBalance(wallet.address);
        
        // Update wallet balance in database
        await users.updateUser(phone, { balance: currentBalance.toString() });
        
        return { wallet, currentBalance };
      }, 3, 1000);
      
      // Log the balance check
      logUserAction(phone, 'balance_check', { balance: result.currentBalance });
      
      // Extract the balance value from the ETH provider response
      const balanceValue = parseFloat(result.currentBalance.balance);
      
      await this.sendMessage(from, `💰 *Testnet Balance* 🧪

${balanceValue.toFixed(6)} ETH (Testnet)

📍 *Testnet Wallet:* \`${result.wallet.address}\`

💡 *Note:* This is testnet ETH - not real money
🔗 *Get more:* [Free Faucet](${config.urls.faucet})`);
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, { 
        action: 'get_balance', 
        phone,
        from 
      });
      
      const userMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      await this.sendMessage(from, userMessage);
    }
  }
  
  /**
   * Handles request to view transaction history
   * Retrieves recent transactions for the user and formats them for display
   * @param {string} from - Message sender identifier
   * @param {string} phone - User's phone number
   * @param {number} [limit=10] - Maximum number of transactions to retrieve
   * @returns {Promise<void>}
   * @throws {Error} If wallet is not found or transaction retrieval fails
   */
  async handleGetTransactions(from, phone, limit = 10) {
    try {
      // Ensure limit is an integer
      const txLimit = parseInt(limit) || 10;
      
      const result = await errorHandler.withRetry(async () => {
        // Get user wallet
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found. Please create a wallet first.');
        }

        // Get recent transactions
        const recentTxs = await transactions.getRecentTransactions(phone, txLimit);
        return { wallet, recentTxs };
      }, 2, 500);
      
      if (result.recentTxs.length === 0) {
        await this.sendMessage(from, '📊 *Transaction History*\n\nNo transactions found yet.\n\nStart by sending some ETH or receiving payments!');
        return;
      }

      let historyMessage = `📊 *Recent Transactions*\n\n`;
      
      for (const tx of result.recentTxs) {
        const date = new Date(tx.timestamp).toLocaleDateString();
        const type = tx.from_address?.toLowerCase() === result.wallet.address.toLowerCase() ? '📤 Sent' : '📥 Received';
        const amount = parseFloat(tx.amount_arb || 0).toFixed(4);
        
        historyMessage += `${type}: ${amount} ETH\n`;
        historyMessage += `📅 ${date}\n`;
        if (tx.tx_hash) {
          historyMessage += `🔗 [View](https://testnet.arbiscan.io/tx/${tx.tx_hash})\n`;
        }
        historyMessage += `\n`;
      }
      
      // Log the transaction history request
      logUserAction(phone, 'transaction_history', { count: result.recentTxs.length });
      
      await this.sendMessage(from, historyMessage);
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, { 
        action: 'get_transactions', 
        phone,
        from,
        limit 
      });
      
      const userMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      await this.sendMessage(from, userMessage);
    }
  }

  /**
   * Alias for handleGetTransactions - maintained for backward compatibility
   * @param {string} from - Message sender identifier
   * @param {string} phone - User's phone number
   * @param {number} [limit=10] - Maximum number of transactions to retrieve
   * @returns {Promise<void>}
   * @deprecated Use handleGetTransactions instead
   */
  async handleGetHistory(from, phone, limit = 10) {
    return await this.handleGetTransactions(from, phone, limit);
  }
  //#endregion

  //#region Transaction Management

  /**
   * Handles request to send a transaction
   * Validates parameters, checks balance, estimates gas, and prepares transaction for confirmation
   * @param {string} from - Message sender identifier
   * @param {string} phone - Sender's phone number
   * @param {Object} sendParams - Transaction parameters
   * @param {number} sendParams.amount - Amount to send in ETH
   * @param {string} [sendParams.recipientAddress] - Recipient's blockchain address
   * @param {string} [sendParams.recipientPhone] - Recipient's phone number
   * @param {string} [sendParams.name] - Recipient's name
   * @returns {Promise<void>}
   * @throws {Error} If parameters are invalid, balance insufficient, or transaction preparation fails
   */
  // Handle sending transaction: prepare and confirm
async handleSendTransaction(from, phone, sendParams) {
  try {
    logger.info(`Processing send transaction for ${phone}:`, sendParams);

    if (!sendParams || !sendParams.amount) {
      throw new Error('Missing parameters: provide amount and recipient.');
    }

    const sendAmount = parseFloat(sendParams.amount);
    if (isNaN(sendAmount) || sendAmount <= 0) {
      throw new Error('Invalid amount. Must be greater than 0.');
    }

    // Get user wallet
    const wallet = await walletHandler.getUserWallet(phone);
    if (!wallet || !wallet.balance) {
      throw new Error('Wallet not found or balance unavailable.');
    }

    // Determine recipient
    let finalRecipientAddress = sendParams.recipientAddress;
    let shouldCreateClaimLink = false;

    if (sendParams.recipientPhone && !sendParams.recipientAddress) {
      const recipientWallet = await walletHandler.getUserWallet(sendParams.recipientPhone);
      if (recipientWallet) {
        finalRecipientAddress = recipientWallet.address;
      } else {
        shouldCreateClaimLink = true;
      }
    }

    // Check balance
    const currentBalance = parseFloat(wallet.balance);
    if (sendAmount > currentBalance) {
      throw new Error(`Insufficient balance. You have ${currentBalance} ETH, tried to send ${sendAmount} ETH.`);
    }

    // Estimate gas
    const gasEstimate = await nebulaService.estimateGas(
      wallet.address,
      shouldCreateClaimLink ? '0x0000000000000000000000000000000000000001' : finalRecipientAddress,
      sendAmount
    );
    const totalCost = sendAmount + parseFloat(gasEstimate.estimatedCost);
    if (totalCost > currentBalance) {
      throw new Error(`Insufficient balance for amount + gas. Need ${totalCost.toFixed(6)} ETH, have ${currentBalance.toFixed(6)} ETH.`);
    }

    // Prepare transaction data
    const transactionData = {
      from: wallet.address,
      to: finalRecipientAddress,
      amount: sendAmount,
      gasEstimate,
      totalCost,
      phone,
      recipientPhone: shouldCreateClaimLink ? sendParams.recipientPhone : null,
      shouldCreateClaimLink
    };

    // Show confirmation to user
    const recipientDisplay = sendParams.name || finalRecipientAddress || sendParams.recipientPhone;
    const feeDisplay = `${parseFloat(gasEstimate.estimatedCost).toFixed(6)} ETH`;

    const confirmMessage = `🔄 *Testnet Transaction Confirmation* 🧪
💸 Sending: ${sendAmount} ETH
👤 To: ${recipientDisplay}
⛽ Gas Fee: ${feeDisplay}
💰 Total Cost: ${totalCost.toFixed(6)} ETH
${shouldCreateClaimLink ? '📱 Recipient will receive a claim link.' : ''}
🧪 Testnet only`;

    await this.sendMessage(from, confirmMessage);

    this.pendingTransactions.set(phone, {
      type: 'send_transaction',
      data: transactionData,
      originalParams: sendParams,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error in handleSendTransaction:', error);
    await this.sendMessage(from, `❌ Transaction preparation failed: ${error.message}`);
  }
}

// Execute confirmed transaction
async executePendingTransaction(from, phone, pendingTx) {
  try {
    const { data, originalParams } = pendingTx;

    const wallet = await walletHandler.getUserWallet(phone);
    if (!wallet || !wallet.balance) {
      throw new Error('Wallet not found or balance unavailable.');
    }

    if (data.totalCost > parseFloat(wallet.balance)) {
      throw new Error('Insufficient balance. Your balance may have changed.');
    }

    let txResult;
    if (data.shouldCreateClaimLink) {
      txResult = await claimsService.createClaimLink(
        phone,
        data.recipientPhone,
        data.amount,
        originalParams.name || 'Unknown'
      );

      if (!txResult.success) throw new Error(`Failed to create claim link: ${txResult.error}`);

      await this.sendMessage(from, `✅ Claim link created! Amount: ${data.amount} ETH, Recipient: ${data.recipientPhone}, Link: ${txResult.claimLink}`);

    } else {
      // Non-Privy wallet execution
      const walletProvider = await walletHandler.getWalletProvider(phone);

      try {
        txResult = await nebulaService.sendTransaction(walletProvider, data.to, data.amount);
      } catch (txError) {
        console.error('Transaction error:', txError);
        throw new Error('Transaction failed. See logs for details.');
      }

      await this.sendMessage(from, `✅ Transaction successful! Amount: ${data.amount} ETH, To: ${data.to}, TxHash: ${txResult.hash}`);
    }

    // Update balance & log
    await this.updateUserBalance(phone);
    logTransaction(phone, data.to || data.recipientPhone, data.amount, data.shouldCreateClaimLink ? 'claim_link' : 'sent', txResult.hash || txResult.ephemeralAddress);

  } catch (error) {
    console.error('Error in executePendingTransaction:', error);
    await this.sendMessage(from, `❌ Transaction execution failed: ${error.message}`);
  }
}


  /**
   * Updates user's balance in the database with fresh data from blockchain
   * @param {string} phone - User's phone number
   * @returns {Promise<void>}
   * @private
   */
  //#endregion

  //#region Internal Helpers
  
  async updateUserBalance(phone) {
    try {
      await errorHandler.withRetry(async () => {
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found');
        }

        const currentBalance = await nebulaService.getBalance(wallet.address);
        await users.updateUser(phone, { balance: currentBalance.toString() });
        
        return currentBalance;
      }, 3, 1000);
      
    } catch (error) {
      // Silent fail for balance updates - don't interrupt user flow
      logger.error('Failed to update user balance:', {
        phone,
        error: error.message
      });
    }
  }

  /**
   * Helper method to send messages to users
   * @param {string} from - Message recipient identifier
   * @param {string} message - Message content to send
   * @returns {Promise<void>}
   * @private
   */
  async sendMessage(from, message) {
    try {
      if (this.messageHandler) {
        await this.messageHandler(from, message);
      }
    } catch (error) {
      logger.error('Failed to send message:', {
        from,
        message: message.substring(0, 100),
        error: error.message
      });
      
      // Don't throw - message sending failures shouldn't break the flow
    }
  }

  /**
   * Sets the message handler function for sending messages
   * @param {Function} handler - Function to handle message sending
   * @public
   */
  setMessageHandler(handler) {
    this.messageHandler = handler;
  }
}

module.exports = new TransactionHandler();
