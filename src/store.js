// ============================================
// DFF! – Don't Freaking Forget
// Data Store
// ============================================

const DEMO_USERS = [
  { id: 'alex', name: 'Alex', emoji: '👤', avatarClass: 'gradient-2' },
  { id: 'sam', name: 'Sam', emoji: '👤', avatarClass: 'gradient-1' },
];

const DEMO_CHATS = [
  {
    id: 'chat-alex-sam',
    participants: ['alex', 'sam'],
  },
];

// Seed some demo messages
const SEED_MESSAGES = [
  {
    id: 'msg-1',
    chatId: 'chat-alex-sam',
    senderId: 'sam',
    text: 'Hej! Glöm inte att vi ska äta middag ikväll 🍕',
    priority: 'normal',
    timestamp: Date.now() - 3600000 * 3,
    status: 'seen',
    snoozeUntil: null,
    snoozedBy: null,
  },
  {
    id: 'msg-2',
    chatId: 'chat-alex-sam',
    senderId: 'alex',
    text: 'Absolut! Vilken tid?',
    priority: 'normal',
    timestamp: Date.now() - 3600000 * 2.5,
    status: 'seen',
    snoozeUntil: null,
    snoozedBy: null,
  },
  {
    id: 'msg-3',
    chatId: 'chat-alex-sam',
    senderId: 'sam',
    text: 'Kl 18:00 passar bra',
    priority: 'normal',
    timestamp: Date.now() - 3600000 * 2,
    status: 'seen',
    snoozeUntil: null,
    snoozedBy: null,
  },
];

class Store {
  constructor() {
    this.users = [...DEMO_USERS];
    this.chats = [...DEMO_CHATS];
    this.messages = [...SEED_MESSAGES];
    this.currentUserId = null;
    this.listeners = {};
    this.snoozeTimers = new Map();
    this.scheduleTimers = new Map();
    this.reminders = [];
    this.reminderTimers = new Map();
    this.pendingAlarms = [];
    this.settings = {
      soundEnabled: true,
      vibrationEnabled: true,
      alarmEnabled: true,
      theme: 'light', // preset name or 'custom'
      customColors: {
        bgPrimary: '#f5f5f7',
        bgCard: '#ffffff',
        sentBubble: '#3478f6',
        receivedBubble: '#ffffff',
        accent: '#5856d6',
        textPrimary: '#1c1c1e',
      },
    };

    // Theme presets
    this.themePresets = {
      light: {
        name: 'Ljust',
        icon: '☀️',
        bgPrimary: '#f5f5f7',
        bgSecondary: '#e8e8ed',
        bgCard: '#ffffff',
        bgCardHover: '#fafafa',
        sentBubble: '#3478f6',
        receivedBubble: '#ffffff',
        accent: '#5856d6',
        textPrimary: '#1c1c1e',
        textSecondary: '#8e8e93',
        textInverse: '#ffffff',
        borderColor: '#d1d1d6',
        borderLight: '#e5e5ea',
      },
      dark: {
        name: 'Mörkt',
        icon: '🌙',
        bgPrimary: '#1c1c1e',
        bgSecondary: '#2c2c2e',
        bgCard: '#2c2c2e',
        bgCardHover: '#3a3a3c',
        sentBubble: '#0a84ff',
        receivedBubble: '#3a3a3c',
        accent: '#bf5af2',
        textPrimary: '#ffffff',
        textSecondary: '#8e8e93',
        textInverse: '#ffffff',
        borderColor: '#48484a',
        borderLight: '#38383a',
      },
      ocean: {
        name: 'Ocean',
        icon: '🌊',
        bgPrimary: '#e8f4f8',
        bgSecondary: '#cfe9f0',
        bgCard: '#ffffff',
        bgCardHover: '#f0f9fc',
        sentBubble: '#0077b6',
        receivedBubble: '#ffffff',
        accent: '#00b4d8',
        textPrimary: '#023e58',
        textSecondary: '#5a8a9e',
        textInverse: '#ffffff',
        borderColor: '#b8d8e4',
        borderLight: '#d4e9f0',
      },
      sunset: {
        name: 'Sunset',
        icon: '🌅',
        bgPrimary: '#fff5f0',
        bgSecondary: '#ffe8dd',
        bgCard: '#ffffff',
        bgCardHover: '#fff9f6',
        sentBubble: '#e85d04',
        receivedBubble: '#ffffff',
        accent: '#dc2f02',
        textPrimary: '#370617',
        textSecondary: '#9e6b5a',
        textInverse: '#ffffff',
        borderColor: '#f0c4b0',
        borderLight: '#f5ddd0',
      },
      forest: {
        name: 'Skog',
        icon: '🌲',
        bgPrimary: '#f0f5f0',
        bgSecondary: '#dce8dc',
        bgCard: '#ffffff',
        bgCardHover: '#f5faf5',
        sentBubble: '#2d6a4f',
        receivedBubble: '#ffffff',
        accent: '#40916c',
        textPrimary: '#1b4332',
        textSecondary: '#6b8f7e',
        textInverse: '#ffffff',
        borderColor: '#b7d4c2',
        borderLight: '#d0e4d8',
      },
    };
  }

  // --- Event System ---
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data));
  }

  // --- Theme Management ---
  setTheme(themeName) {
    this.settings.theme = themeName;
    this.applyTheme();
    this.emit('themeChanged', themeName);
  }

  setCustomColor(key, value) {
    this.settings.customColors[key] = value;
    if (this.settings.theme === 'custom') {
      this.applyTheme();
    }
  }

  applyTheme() {
    const root = document.documentElement;
    let colors;

    if (this.settings.theme === 'custom') {
      const cc = this.settings.customColors;
      colors = {
        bgPrimary: cc.bgPrimary,
        bgSecondary: this._darken(cc.bgPrimary, 8),
        bgCard: cc.bgCard,
        bgCardHover: this._lighten(cc.bgCard, 3),
        sentBubble: cc.sentBubble,
        receivedBubble: cc.receivedBubble,
        accent: cc.accent,
        textPrimary: cc.textPrimary,
        textSecondary: this._lighten(cc.textPrimary, 40),
        textInverse: '#ffffff',
        borderColor: this._lighten(cc.textPrimary, 65),
        borderLight: this._lighten(cc.textPrimary, 75),
      };
    } else {
      colors = this.themePresets[this.settings.theme] || this.themePresets.light;
    }

    root.style.setProperty('--bg-primary', colors.bgPrimary);
    root.style.setProperty('--bg-secondary', colors.bgSecondary);
    root.style.setProperty('--bg-card', colors.bgCard);
    root.style.setProperty('--bg-card-hover', colors.bgCardHover);
    root.style.setProperty('--color-normal', colors.sentBubble);
    root.style.setProperty('--color-accent', colors.accent);
    root.style.setProperty('--text-primary', colors.textPrimary);
    root.style.setProperty('--text-secondary', colors.textSecondary);
    root.style.setProperty('--text-inverse', colors.textInverse);
    root.style.setProperty('--border-color', colors.borderColor);
    root.style.setProperty('--border-light', colors.borderLight);

    // Received bubble uses different selector
    root.style.setProperty('--bg-received', colors.receivedBubble);
  }

  _darken(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  _lighten(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  // --- Reminders ---
  addReminder(text, scheduledFor) {
    const reminder = {
      id: `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      scheduledFor,
      createdAt: Date.now(),
      userId: this.currentUserId,
      status: 'pending',
    };
    this.reminders.push(reminder);

    const delay = scheduledFor - Date.now();
    const timerId = setTimeout(() => {
      this.triggerReminder(reminder.id);
    }, Math.max(delay, 0));
    this.reminderTimers.set(reminder.id, timerId);

    this.emit('reminderAdded', reminder);
    return reminder;
  }

  triggerReminder(reminderId) {
    const reminder = this.reminders.find(r => r.id === reminderId);
    if (!reminder || reminder.status !== 'pending') return;

    reminder.status = 'triggered';
    this.reminderTimers.delete(reminderId);

    this.emit('reminderTriggered', reminder);
  }

  cancelReminder(reminderId) {
    const reminder = this.reminders.find(r => r.id === reminderId);
    if (!reminder) return;

    if (this.reminderTimers.has(reminderId)) {
      clearTimeout(this.reminderTimers.get(reminderId));
      this.reminderTimers.delete(reminderId);
    }

    this.reminders = this.reminders.filter(r => r.id !== reminderId);
    this.emit('reminderCancelled', reminder);
  }

  getReminders() {
    return this.reminders.filter(r => r.userId === this.currentUserId && r.status === 'pending');
  }

  // --- User Management ---
  getCurrentUser() {
    return this.users.find(u => u.id === this.currentUserId);
  }

  getOtherUser(chatId) {
    const chat = this.chats.find(c => c.id === chatId);
    if (!chat) return null;
    const otherId = chat.participants.find(p => p !== this.currentUserId);
    return this.users.find(u => u.id === otherId);
  }

  switchUser(userId) {
    this.currentUserId = userId;
    // Check for pending alarm messages (not scheduled ones)
    const pendingAlarms = this.messages.filter(m => 
      m.chatId && 
      this.getChatForUser(m.chatId) &&
      m.senderId !== userId && 
      m.priority === 'alarm' && 
      m.status === 'sent' &&
      !m.scheduledFor
    );
    this.emit('userChanged', { userId, pendingAlarms });
  }

  // --- Chat Management ---
  getChatForUser(chatId) {
    const chat = this.chats.find(c => c.id === chatId);
    if (!chat) return null;
    return chat.participants.includes(this.currentUserId) ? chat : null;
  }

  getChatsForCurrentUser() {
    return this.chats
      .filter(c => c.participants.includes(this.currentUserId))
      .map(chat => {
        const msgs = this.getMessagesForChat(chat.id);
        const lastMsg = msgs[msgs.length - 1] || null;
        const unread = msgs.filter(m => 
          m.senderId !== this.currentUserId && 
          (m.status === 'sent' || m.status === 'delivered')
        ).length;
        const otherUser = this.getOtherUser(chat.id);
        
        // Check for snoozed messages
        const snoozedMsg = msgs.find(m => 
          m.status === 'snoozed' && m.snoozedBy === this.currentUserId
        );

        return {
          ...chat,
          lastMessage: lastMsg,
          unreadCount: unread,
          otherUser,
          snoozedMessage: snoozedMsg,
        };
      });
  }

  // --- Message Management ---
  getMessagesForChat(chatId) {
    return this.messages
      .filter(m => {
        if (m.chatId !== chatId) return false;
        // Hide scheduled messages from receiver until delivery time
        if (m.scheduledFor && m.scheduledFor > Date.now() && m.senderId !== this.currentUserId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  sendMessage(chatId, text, priority = 'normal', scheduledFor = null) {
    const isScheduled = scheduledFor && scheduledFor > Date.now();
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      chatId,
      senderId: this.currentUserId,
      text,
      priority,
      timestamp: Date.now(),
      status: isScheduled ? 'scheduled' : 'sent',
      scheduledFor: isScheduled ? scheduledFor : null,
      snoozeUntil: null,
      snoozedBy: null,
    };
    this.messages.push(msg);

    if (isScheduled) {
      // Set timer to deliver at scheduled time
      const delay = scheduledFor - Date.now();
      const timerId = setTimeout(() => {
        this.deliverScheduledMessage(msg.id);
      }, delay);
      this.scheduleTimers.set(msg.id, timerId);
      this.emit('messageScheduled', msg);
    } else {
      this.emit('messageSent', msg);
    }

    this.emit('messagesChanged', { chatId });
    return msg;
  }

  deliverScheduledMessage(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled') return;

    msg.status = 'sent';
    msg.scheduledFor = null;
    this.scheduleTimers.delete(messageId);

    this.emit('messageDelivered', { message: msg });
    this.emit('messagesChanged', { chatId: msg.chatId });
  }

  cancelScheduledMessage(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled') return;

    // Clear timer
    if (this.scheduleTimers.has(messageId)) {
      clearTimeout(this.scheduleTimers.get(messageId));
      this.scheduleTimers.delete(messageId);
    }

    // Remove message
    this.messages = this.messages.filter(m => m.id !== messageId);
    this.emit('messageCancelled', { message: msg });
    this.emit('messagesChanged', { chatId: msg.chatId });
  }

  rescheduleMessage(messageId, newScheduledFor) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled') return;

    // Clear old timer
    if (this.scheduleTimers.has(messageId)) {
      clearTimeout(this.scheduleTimers.get(messageId));
    }

    msg.scheduledFor = newScheduledFor;

    // Set new timer
    const delay = newScheduledFor - Date.now();
    const timerId = setTimeout(() => {
      this.deliverScheduledMessage(msg.id);
    }, delay);
    this.scheduleTimers.set(messageId, timerId);

    this.emit('messageRescheduled', { message: msg, newScheduledFor });
    this.emit('messagesChanged', { chatId: msg.chatId });
  }

  markSeen(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg && msg.status === 'sent') {
      msg.status = 'seen';
      this.emit('messagesChanged', { chatId: msg.chatId });
    }
  }

  snoozeMessage(messageId, durationMs) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg) return;

    const snoozeUntil = Date.now() + durationMs;
    msg.status = 'snoozed';
    msg.snoozeUntil = snoozeUntil;
    msg.snoozedBy = this.currentUserId;

    // Clear existing timer if any
    if (this.snoozeTimers.has(messageId)) {
      clearTimeout(this.snoozeTimers.get(messageId));
    }

    // Set timer for snooze reminder
    const timerId = setTimeout(() => {
      this.triggerSnoozeReminder(messageId);
    }, durationMs);

    this.snoozeTimers.set(messageId, timerId);
    this.emit('messageSnoozed', { message: msg, snoozeUntil });
    this.emit('messagesChanged', { chatId: msg.chatId });
  }

  triggerSnoozeReminder(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'snoozed') return;

    // Reset to "sent" so it triggers alarm again
    msg.status = 'sent';
    msg.snoozeUntil = null;
    msg.snoozedBy = null;
    this.snoozeTimers.delete(messageId);

    this.emit('snoozeReminder', { message: msg });
    this.emit('messagesChanged', { chatId: msg.chatId });
  }

  markDone(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg) return;

    // Clear any snooze timer
    if (this.snoozeTimers.has(messageId)) {
      clearTimeout(this.snoozeTimers.get(messageId));
      this.snoozeTimers.delete(messageId);
    }

    msg.status = 'done';
    msg.snoozeUntil = null;
    this.emit('messageDone', { message: msg });
    this.emit('messagesChanged', { chatId: msg.chatId });
  }

  getSnoozedMessages() {
    return this.messages.filter(m => 
      m.status === 'snoozed' && m.snoozedBy === this.currentUserId
    );
  }
}

// Singleton
export const store = new Store();
