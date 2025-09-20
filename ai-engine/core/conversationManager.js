class ConversationManager {
  constructor() {
    this.sessions = new Map();
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
  }

  // Get or create conversation session for a user
  getSession(userPhone) {
    if (!this.sessions.has(userPhone)) {
      this.sessions.set(userPhone, {
        history: [],
        state: 'idle',
        pendingAction: null,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    }
    
    const session = this.sessions.get(userPhone);
    session.lastActivity = Date.now();
    
    return session;
  }

  // Update conversation history
  addToHistory(userPhone, userMessage, aiResponse) {
    const session = this.getSession(userPhone);
    
    session.history.push({
      user: userMessage,
      ai: aiResponse,
      timestamp: Date.now()
    });
    
    // Keep only last 10 exchanges
    if (session.history.length > 10) {
      session.history = session.history.slice(-10);
    }
  }

  // Set pending action (for multi-step flows)
  setPendingAction(userPhone, action) {
    const session = this.getSession(userPhone);
    session.pendingAction = action;
    session.state = 'waiting_for_input';
  }

  // Get and clear pending action
  getPendingAction(userPhone) {
    const session = this.getSession(userPhone);
    const action = session.pendingAction;
    
    if (action) {
      session.pendingAction = null;
      session.state = 'idle';
    }
    
    return action;
  }

  // Set conversation state
  setState(userPhone, state) {
    const session = this.getSession(userPhone);
    session.state = state;
  }

  // Get conversation context for AI
  getContext(userPhone) {
    const session = this.getSession(userPhone);
    
    // Return recent conversation history in AI-friendly format
    return session.history.slice(-5).map(exchange => [
      { role: 'user', content: exchange.user },
      { role: 'assistant', content: exchange.ai }
    ]).flat();
  }

  // Check if user is in middle of a flow
  isInFlow(userPhone) {
    const session = this.getSession(userPhone);
    return session.state !== 'idle' || session.pendingAction !== null;
  }

  // Clear session (logout, restart, etc.)
  clearSession(userPhone) {
    this.sessions.delete(userPhone);
  }

  // Clean up expired sessions (run periodically)
  cleanupSessions() {
    const now = Date.now();
    
    for (const [userPhone, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.sessions.delete(userPhone);
        console.log(`🧹 Cleaned up expired session for ${userPhone}`);
      }
    }
  }

  // Get session statistics
  getSessionStats() {
    const now = Date.now();
    let activeCount = 0;
    let idleCount = 0;
    
    for (const session of this.sessions.values()) {
      if (now - session.lastActivity < 5 * 60 * 1000) { // Active in last 5 minutes
        activeCount++;
      } else {
        idleCount++;
      }
    }
    
    return {
      total: this.sessions.size,
      active: activeCount,
      idle: idleCount
    };
  }
}

module.exports = ConversationManager;