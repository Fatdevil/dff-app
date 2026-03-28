// ============================================
// DFF! – Don't Freaking Forget
// Data Store (Socket.io powered)
// ============================================

import { io } from 'socket.io-client';

// ========== Socket Connection ==========
const socket = io(window.location.origin, {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
});

class Store {
  constructor() {
    this.users = [];
    this.chats = [];
    this.messages = [];
    this.currentUserId = null;
    this.currentUserName = null;
    this.listeners = {};
    this.reminders = [];
    this.reminderTimers = new Map();
    this.pendingAlarms = [];
    this.connected = false;
    this.settings = {
      soundEnabled: true,
      vibrationEnabled: true,
      alarmEnabled: true,
      theme: 'light',
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
        name: 'Ljust', icon: '☀️',
        bgPrimary: '#f5f5f7', bgSecondary: '#e8e8ed', bgCard: '#ffffff', bgCardHover: '#fafafa',
        sentBubble: '#3478f6', receivedBubble: '#ffffff', accent: '#5856d6',
        textPrimary: '#1c1c1e', textSecondary: '#8e8e93', textInverse: '#ffffff',
        borderColor: '#d1d1d6', borderLight: '#e5e5ea',
      },
      dark: {
        name: 'Mörkt', icon: '🌙',
        bgPrimary: '#1c1c1e', bgSecondary: '#2c2c2e', bgCard: '#2c2c2e', bgCardHover: '#3a3a3c',
        sentBubble: '#0a84ff', receivedBubble: '#3a3a3c', accent: '#bf5af2',
        textPrimary: '#ffffff', textSecondary: '#8e8e93', textInverse: '#ffffff',
        borderColor: '#48484a', borderLight: '#38383a',
      },
      ocean: {
        name: 'Ocean', icon: '🌊',
        bgPrimary: '#e8f4f8', bgSecondary: '#cfe9f0', bgCard: '#ffffff', bgCardHover: '#f0f9fc',
        sentBubble: '#0077b6', receivedBubble: '#ffffff', accent: '#00b4d8',
        textPrimary: '#023e58', textSecondary: '#5a8a9e', textInverse: '#ffffff',
        borderColor: '#b8d8e4', borderLight: '#d4e9f0',
      },
      sunset: {
        name: 'Sunset', icon: '🌅',
        bgPrimary: '#fff5f0', bgSecondary: '#ffe8dd', bgCard: '#ffffff', bgCardHover: '#fff9f6',
        sentBubble: '#e85d04', receivedBubble: '#ffffff', accent: '#dc2f02',
        textPrimary: '#370617', textSecondary: '#9e6b5a', textInverse: '#ffffff',
        borderColor: '#f0c4b0', borderLight: '#f5ddd0',
      },
      forest: {
        name: 'Skog', icon: '🌲',
        bgPrimary: '#f0f5f0', bgSecondary: '#dce8dc', bgCard: '#ffffff', bgCardHover: '#f5faf5',
        sentBubble: '#2d6a4f', receivedBubble: '#ffffff', accent: '#40916c',
        textPrimary: '#1b4332', textSecondary: '#6b8f7e', textInverse: '#ffffff',
        borderColor: '#b7d4c2', borderLight: '#d0e4d8',
      },
    };

    this._setupSocketListeners();
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

  // --- Socket.io Listeners ---
  _setupSocketListeners() {
    socket.on('connect', () => {
      this.connected = true;
      this.emit('connectionChanged', true);
      console.log('🟢 Connected to server');

      // Re-login if we have a userId
      if (this.currentUserId) {
        socket.emit('login', { userId: this.currentUserId, displayName: this.currentUserName || this.currentUserId });
      }
    });

    socket.on('disconnect', () => {
      this.connected = false;
      this.emit('connectionChanged', false);
      console.log('🔴 Disconnected from server');
    });

    socket.on('loginSuccess', (data) => {
      this.users = data.users;
      this.chats = data.chats || [];
      this.pendingAlarms = data.pendingAlarms || [];
      this.emit('userChanged', {
        userId: this.currentUserId,
        pendingAlarms: this.pendingAlarms,
      });
    });

    socket.on('chatCreated', (chatData) => {
      // Add new chat if not already present
      if (!this.chats.find(c => c.id === chatData.id)) {
        this.chats.push(chatData);
      }
      this.emit('chatsUpdated', {});
    });

    socket.on('chatMessages', ({ chatId, messages }) => {
      // Replace messages for this chat
      this.messages = this.messages.filter(m => m.chatId !== chatId);
      this.messages.push(...messages);
      this.emit('messagesChanged', { chatId });
    });

    socket.on('newMessage', (msg) => {
      // Avoid duplicates
      if (!this.messages.find(m => m.id === msg.id)) {
        this.messages.push(msg);
      }
      this.emit('messagesChanged', { chatId: msg.chatId });

      // Trigger alarm for incoming alarm messages
      if (msg.senderId !== this.currentUserId && msg.priority === 'alarm') {
        this.emit('messageDelivered', { message: msg, isIncoming: true });
      } else if (msg.senderId !== this.currentUserId) {
        this.emit('messageDelivered', { message: msg, isIncoming: true });
      }
    });

    socket.on('messageUpdate', (updatedMsg) => {
      const idx = this.messages.findIndex(m => m.id === updatedMsg.id);
      if (idx >= 0) {
        this.messages[idx] = updatedMsg;
      }
    });

    socket.on('messageScheduled', (msg) => {
      if (!this.messages.find(m => m.id === msg.id)) {
        this.messages.push(msg);
      }
      this.emit('messageScheduled', msg);
    });

    socket.on('messageDelivered', ({ message }) => {
      const idx = this.messages.findIndex(m => m.id === message.id);
      if (idx >= 0) {
        this.messages[idx] = message;
      } else {
        this.messages.push(message);
      }
      this.emit('messageDelivered', { message });
    });

    socket.on('messageCancelled', ({ message }) => {
      this.messages = this.messages.filter(m => m.id !== message.id);
      this.emit('messageCancelled', { message });
    });

    socket.on('messageRescheduled', ({ message, newScheduledFor }) => {
      const idx = this.messages.findIndex(m => m.id === message.id);
      if (idx >= 0) this.messages[idx] = message;
      this.emit('messageRescheduled', { message, newScheduledFor });
    });

    socket.on('messageSnoozed', ({ message, snoozeUntil }) => {
      const idx = this.messages.findIndex(m => m.id === message.id);
      if (idx >= 0) this.messages[idx] = message;
      this.emit('messageSnoozed', { message, snoozeUntil });
    });

    socket.on('snoozeReminder', ({ message }) => {
      const idx = this.messages.findIndex(m => m.id === message.id);
      if (idx >= 0) this.messages[idx] = message;
      this.emit('snoozeReminder', { message });
    });

    socket.on('messagesChanged', ({ chatId }) => {
      // Reload messages from server
      socket.emit('loadMessages', chatId);
    });
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
        bgPrimary: cc.bgPrimary, bgSecondary: this._darken(cc.bgPrimary, 8),
        bgCard: cc.bgCard, bgCardHover: this._lighten(cc.bgCard, 3),
        sentBubble: cc.sentBubble, receivedBubble: cc.receivedBubble,
        accent: cc.accent, textPrimary: cc.textPrimary,
        textSecondary: this._lighten(cc.textPrimary, 40), textInverse: '#ffffff',
        borderColor: this._lighten(cc.textPrimary, 65), borderLight: this._lighten(cc.textPrimary, 75),
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
    root.style.setProperty('--bg-received', colors.receivedBubble);
  }

  _darken(hex, amt) {
    const n = parseInt(hex.replace('#',''),16);
    return `#${((1<<24)+((Math.max(0,(n>>16)-amt))<<16)+((Math.max(0,((n>>8)&0xff)-amt))<<8)+Math.max(0,(n&0xff)-amt)).toString(16).slice(1)}`;
  }
  _lighten(hex, amt) {
    const n = parseInt(hex.replace('#',''),16);
    return `#${((1<<24)+((Math.min(255,(n>>16)+amt))<<16)+((Math.min(255,((n>>8)&0xff)+amt))<<8)+Math.min(255,(n&0xff)+amt)).toString(16).slice(1)}`;
  }

  // --- Reminders (Client-Side) ---
  addReminder(text, scheduledFor) {
    const reminder = {
      id: `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text, scheduledFor, createdAt: Date.now(), userId: this.currentUserId, status: 'pending',
    };
    this.reminders.push(reminder);
    const delay = scheduledFor - Date.now();
    const timerId = setTimeout(() => this.triggerReminder(reminder.id), Math.max(delay, 0));
    this.reminderTimers.set(reminder.id, timerId);
    this.emit('reminderAdded', reminder);
    return reminder;
  }

  triggerReminder(reminderId) {
    const r = this.reminders.find(r => r.id === reminderId);
    if (!r || r.status !== 'pending') return;
    r.status = 'triggered';
    this.reminderTimers.delete(reminderId);
    this.emit('reminderTriggered', r);
  }

  cancelReminder(reminderId) {
    const r = this.reminders.find(r => r.id === reminderId);
    if (!r) return;
    if (this.reminderTimers.has(reminderId)) {
      clearTimeout(this.reminderTimers.get(reminderId));
      this.reminderTimers.delete(reminderId);
    }
    this.reminders = this.reminders.filter(r => r.id !== reminderId);
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

  switchUser(userId, displayName) {
    this.currentUserId = userId;
    this.currentUserName = displayName || userId;
    socket.connect();
    socket.emit('login', { userId, displayName: this.currentUserName });
  }

  pairWithUser(partnerName) {
    const partnerId = partnerName.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
    if (!partnerId || partnerId === this.currentUserId) return;
    socket.emit('pairWith', partnerId);
  }

  // --- Chat Management ---
  getChatForUser(chatId) {
    const chat = this.chats.find(c => c.id === chatId);
    if (!chat) return null;
    return chat.participants.includes(this.currentUserId) ? chat : null;
  }

  getChatsForCurrentUser() {
    // Use server-provided chat data if available, else compute locally
    return this.chats.map(chat => {
      const msgs = this.getMessagesForChat(chat.id);
      const lastMsg = msgs[msgs.length - 1] || chat.lastMessage || null;
      const unread = msgs.filter(m =>
        m.senderId !== this.currentUserId && (m.status === 'sent' || m.status === 'delivered')
      ).length;
      const otherUser = chat.otherUser || this.getOtherUser(chat.id);
      const snoozedMsg = msgs.find(m => m.status === 'snoozed' && m.snoozedBy === this.currentUserId);

      return { ...chat, lastMessage: lastMsg, unreadCount: unread, otherUser, snoozedMessage: snoozedMsg };
    });
  }

  // --- Message Management ---
  getMessagesForChat(chatId) {
    return this.messages
      .filter(m => {
        if (m.chatId !== chatId) return false;
        if (m.scheduledFor && m.scheduledFor > Date.now() && m.senderId !== this.currentUserId) return false;
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  sendMessage(chatId, text, priority = 'normal', scheduledFor = null, location = null) {
    socket.emit('sendMessage', { chatId, text, priority, scheduledFor, location });
  }

  cancelScheduledMessage(messageId) {
    socket.emit('cancelScheduledMessage', messageId);
  }

  rescheduleMessage(messageId, newScheduledFor) {
    socket.emit('rescheduleMessage', { messageId, newScheduledFor });
  }

  markSeen(messageId) {
    socket.emit('markSeen', messageId);
  }

  snoozeMessage(messageId, durationMs) {
    socket.emit('snoozeMessage', { messageId, durationMs });
  }

  markDone(messageId) {
    socket.emit('markDone', messageId);
  }

  getSnoozedMessages() {
    return this.messages.filter(m => m.status === 'snoozed' && m.snoozedBy === this.currentUserId);
  }

  loadChatMessages(chatId) {
    socket.emit('loadMessages', chatId);
  }
}

// Singleton
export const store = new Store();
