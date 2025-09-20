require('dotenv').config();
const MessageRouter = require('./bridge/messageRouter');
const express = require('express');
const { getCurrentQRCode } = require('./src/services/whatsapp');
const KeepAlive = require('./src/services/keepAlive');

class ZappoService {
  constructor() {
    this.messageRouter = new MessageRouter();
    this.sock = null;
    this.isInitialized = false;
    this.app = express();
    this.setupExpressServer();
  }

  setupExpressServer() {
    // Health check endpoint for keep-alive
    this.app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'ZAPPO AI-Powered WhatsApp Bot'
      });
    });

    // Basic info endpoint
    this.app.get('/', (req, res) => {
      res.json({ 
        message: 'ZAPPO AI-Powered WhatsApp ETH Wallet Bot',
        status: 'Running',
        version: '2.0.0',
        ai_enabled: process.env.AI_ENABLED === 'true'
      });
    });

    // QR Code endpoint
    this.app.get('/qr', (req, res) => {
      try {
        const qrData = getCurrentQRCode();
        
        if (!qrData.isAvailable) {
          return res.status(404).json({
            error: 'No QR code available',
            message: 'WhatsApp is either already connected or not generating QR code',
            status: 'not_available'
          });
        }
        
        // Return QR code as image data URL
        if (qrData.dataURL) {
          const base64Data = qrData.dataURL.replace(/^data:image\/png;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');
          
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Content-Length', imageBuffer.length);
          res.send(imageBuffer);
        } else {
          res.status(500).json({
            error: 'QR code data not available',
            message: 'QR code is being generated, please try again in a moment'
          });
        }
      } catch (error) {
        console.error('Error serving QR code:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to generate QR code'
        });
      }
    });
  }

  async start() {
    try {
      console.log('🚀 Starting ZAPPO AI-Powered Arbitrum ETH Wallet Bot...');
      
      // Initialize message router (which initializes AI if enabled)
      await this.messageRouter.initialize();
      
      // Initialize the existing wallet bot
      await this.initializeWalletBot();
      
      // Set up message handling with AI routing
      this.setupMessageHandling();
      
      const routerStatus = this.messageRouter.getStatus();
      console.log('✅ ZAPPO initialization complete!');
      console.log('🤖 AI Features:', routerStatus.aiEnabled ? 'Enabled' : 'Disabled');
      console.log('🏦 Wallet Functions: All operational');
      console.log('💬 Message Routing: Active');
      
      if (routerStatus.aiEnabled && routerStatus.aiEngineReady) {
        console.log('🎉 Conversational Mode: Active - Users can chat naturally!');
      } else {
        console.log('📟 Traditional Mode: Active - Using standard commands');
      }
      
      // Start Express server to keep the process running
      await this.startExpressServer();
      
      this.isInitialized = true;
      
    } catch (error) {
      console.error('❌ ZAPPO startup error:', error);
      console.log('🔄 Attempting to start in traditional mode...');
      
      // Fallback: start without AI
      try {
        await this.startTraditionalMode();
      } catch (fallbackError) {
        console.error('💥 Complete startup failure:', fallbackError);
        process.exit(1);
      }
    }
  }

  async initializeWalletBot() {
    try {
      // Initialize database first
      const { initializeDatabase } = require('./src/services/database');
      await initializeDatabase();
      
      // Initialize WhatsApp using existing service
      const { initializeWhatsApp } = require('./src/services/whatsapp');
      console.log('� Initializing WhatsApp connection...');
      this.sock = await initializeWhatsApp();
      
      console.log('✅ WhatsApp service initialized successfully!');
      
    } catch (error) {
      console.error('❌ Failed to initialize wallet bot:', error);
      throw error;
    }
  }

  setupMessageHandling() {
    // Initialize command handler with AI routing
    const { initializeCommandHandler } = require('./src/handlers/commandHandler');
    
    // Initialize the command handler but with our AI message router
    const originalHandler = initializeCommandHandler(this.sock);
    
    // Override the message handling to use our AI router instead
    this.sock.ev.removeAllListeners('messages.upsert');
    
    this.sock.ev.on('messages.upsert', async (m) => {
      try {
        const message = m.messages[0];
        
        // Skip if no message content or from status broadcast
        if (!message.message || message.key.remoteJid === 'status@broadcast') {
          return;
        }

        // Skip own messages
        if (message.key.fromMe) {
          return;
        }

        console.log(`📨 Received message from ${message.key.remoteJid}`);

        // Route through AI-enabled message router
        await this.messageRouter.routeMessage(this.sock, message);
        
      } catch (error) {
        console.error('❌ Message handling error:', error);
        
        // Send generic error message to user
        try {
          await this.sock.sendMessage(message.key.remoteJid, {
            text: "Sorry, I encountered an error processing your message. Please try again or type 'help' for assistance."
          });
        } catch (sendError) {
          console.error('❌ Failed to send error message:', sendError);
        }
      }
    });
  }

  async startExpressServer() {
    return new Promise((resolve, reject) => {
      const PORT = process.env.PORT || process.env.LOCAL_PORT || 3001;
      
      this.server = this.app.listen(PORT, "0.0.0.0", (err) => {
        if (err) {
          console.error('❌ Failed to start Express server:', err);
          reject(err);
          return;
        }
        
        console.log(`🌐 Express server running on port ${PORT}`);
        
        // Start keep-alive if on Render or production
        if (process.env.RENDER || process.env.NODE_ENV === 'production') {
          const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
          const keepAlive = new KeepAlive(appUrl);
          keepAlive.start();
          console.log('🔄 Keep-alive service started');
        }
        
        console.log('✅ ZAPPO is ready! Listening for messages...');
        resolve();
      });
    });
  }

  async startTraditionalMode() {
    console.log('🔄 Starting in traditional mode (no AI)...');
    
    // Disable AI in router
    this.messageRouter.setAIEnabled(false);
    
    // Initialize basic wallet bot
    await this.initializeWalletBot();
    this.setupMessageHandling();
    
    console.log('✅ Traditional mode active - using standard commands');
    this.isInitialized = true;
  }

  // Graceful shutdown
  async stop() {
    console.log('🛑 Shutting down ZAPPO service...');
    
    if (this.server) {
      try {
        this.server.close();
        console.log('✅ Express server closed gracefully');
      } catch (error) {
        console.error('❌ Error closing Express server:', error);
      }
    }
    
    if (this.sock) {
      try {
        await this.sock.end();
        console.log('✅ WhatsApp connection closed gracefully');
      } catch (error) {
        console.error('❌ Error closing WhatsApp connection:', error);
      }
    }
    
    console.log('👋 ZAPPO service stopped');
  }

  // Get service status
  getStatus() {
    return {
      initialized: this.isInitialized,
      whatsappConnected: this.sock?.user ? true : false,
      router: this.messageRouter.getStatus()
    };
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\\n🛑 Received SIGINT, shutting down gracefully...');
  if (global.zappoService) {
    await global.zappoService.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\\n🛑 Received SIGTERM, shutting down gracefully...');
  if (global.zappoService) {
    await global.zappoService.stop();
  }
  process.exit(0);
});

// Start the service
const zappo = new ZappoService();
global.zappoService = zappo;

zappo.start().catch(error => {
  console.error('💥 Fatal startup error:', error);
  process.exit(1);
});

module.exports = ZappoService;