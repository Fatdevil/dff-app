// ============================================
// DFF! – Don't Freaking Forget
// Backend Server (Node.js + Socket.io)
// Dynamic users + chat pairing
// ============================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ========== In-Memory Store ==========
const users = new Map();     // userId -> { id, name, emoji, avatarClass }
const chats = new Map();     // chatId -> { id, participants: [userId, userId] }
const messages = [];         // Array of message objects

// Timer maps
const scheduleTimers = new Map();
const snoozeTimers = new Map();

// Track connected users: userId -> Set<socketId>
const connectedUsers = new Map();

// ========== Helper Functions ==========
function getSocketsForUser(userId) {
  return connectedUsers.get(userId) || new Set();
}

function emitToUser(userId, event, data) {
  const sockets = getSocketsForUser(userId);
  sockets.forEach(socketId => {
    io.to(socketId).emit(event, data);
  });
}

function emitToChatParticipants(chatId, event, data, excludeUserId = null) {
  const chat = chats.get(chatId);
  if (!chat) return;
  chat.participants.forEach(userId => {
    if (userId !== excludeUserId) {
      emitToUser(userId, event, data);
    }
  });
}

function generateId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getChatIdForPair(userId1, userId2) {
  const sorted = [userId1, userId2].sort();
  return `chat-${sorted[0]}-${sorted[1]}`;
}

function getMessagesForChat(chatId, userId) {
  return messages
    .filter(m => {
      if (m.chatId !== chatId) return false;
      if (m.scheduledFor && m.scheduledFor > Date.now() && m.senderId !== userId) return false;
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildChatData(chatId, userId) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const msgs = getMessagesForChat(chatId, userId);
  const lastMsg = msgs[msgs.length - 1] || null;
  const unread = msgs.filter(m =>
    m.senderId !== userId && (m.status === 'sent' || m.status === 'delivered')
  ).length;
  const otherId = chat.participants.find(p => p !== userId);
  const otherUser = users.get(otherId) || { id: otherId, name: otherId, emoji: '👤' };
  const snoozedMsg = msgs.find(m => m.status === 'snoozed' && m.snoozedBy === userId);

  return {
    ...chat,
    lastMessage: lastMsg,
    unreadCount: unread,
    otherUser,
    snoozedMessage: snoozedMsg,
  };
}

// Generate avatar color from username
function getAvatarClass(userId) {
  const colors = ['gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5'];
  const hash = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// ========== Socket.io Connection ==========
io.on('connection', (socket) => {
  let currentUserId = null;

  console.log(`🔌 Socket connected: ${socket.id}`);

  // --- Login (with dynamic user creation) ---
  socket.on('login', ({ userId, displayName }) => {
    currentUserId = userId;

    // Create or update user
    if (!users.has(userId)) {
      users.set(userId, {
        id: userId,
        name: displayName || userId,
        emoji: '👤',
        avatarClass: getAvatarClass(userId),
      });
      console.log(`✨ New user registered: ${displayName} (${userId})`);
    } else {
      // Update display name if changed
      users.get(userId).name = displayName || users.get(userId).name;
    }

    // Track socket
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    // Build chat list for this user
    const userChats = [];
    for (const [chatId, chat] of chats) {
      if (chat.participants.includes(userId)) {
        const chatData = buildChatData(chatId, userId);
        if (chatData) userChats.push(chatData);
      }
    }

    // Check for pending alarm messages
    const pendingAlarms = messages.filter(m =>
      m.chatId &&
      chats.has(m.chatId) &&
      chats.get(m.chatId).participants.includes(userId) &&
      m.senderId !== userId &&
      m.priority === 'alarm' &&
      m.status === 'sent' &&
      !m.scheduledFor
    );

    socket.emit('loginSuccess', {
      user: users.get(userId),
      users: Array.from(users.values()),
      chats: userChats,
      pendingAlarms,
    });

    console.log(`👤 ${displayName || userId} logged in (${connectedUsers.get(userId).size} sessions)`);
  });

  // --- Pair with another user ---
  socket.on('pairWith', (partnerId) => {
    if (!currentUserId) return;

    const chatId = getChatIdForPair(currentUserId, partnerId);

    // Create partner user if they haven't logged in yet
    if (!users.has(partnerId)) {
      users.set(partnerId, {
        id: partnerId,
        name: partnerId,
        emoji: '👤',
        avatarClass: getAvatarClass(partnerId),
      });
    }

    // Create chat if not exists
    if (!chats.has(chatId)) {
      chats.set(chatId, {
        id: chatId,
        participants: [currentUserId, partnerId],
      });
      console.log(`💬 New chat created: ${currentUserId} ↔ ${partnerId}`);
    }

    // Send chat data to current user
    const chatData = buildChatData(chatId, currentUserId);
    socket.emit('chatCreated', chatData);

    // Also notify partner if online
    const partnerChatData = buildChatData(chatId, partnerId);
    emitToUser(partnerId, 'chatCreated', partnerChatData);
  });

  // --- Load Chat Messages ---
  socket.on('loadMessages', (chatId) => {
    if (!currentUserId) return;
    const msgs = getMessagesForChat(chatId, currentUserId);
    socket.emit('chatMessages', { chatId, messages: msgs });
  });

  // --- Send Message ---
  socket.on('sendMessage', ({ chatId, text, priority, scheduledFor, location }) => {
    if (!currentUserId) return;

    const isScheduled = scheduledFor && scheduledFor > Date.now();
    const msg = {
      id: generateId(),
      chatId,
      senderId: currentUserId,
      text,
      priority: priority || 'normal',
      timestamp: Date.now(),
      status: isScheduled ? 'scheduled' : 'sent',
      scheduledFor: isScheduled ? scheduledFor : null,
      snoozeUntil: null,
      snoozedBy: null,
      location: location || null,
    };
    messages.push(msg);

    if (isScheduled) {
      const delay = scheduledFor - Date.now();
      const timerId = setTimeout(() => deliverScheduledMessage(msg.id), delay);
      scheduleTimers.set(msg.id, timerId);
      emitToUser(currentUserId, 'messageScheduled', msg);
      emitToUser(currentUserId, 'messagesChanged', { chatId });
    } else {
      const chat = chats.get(chatId);
      if (chat) {
        chat.participants.forEach(userId => {
          emitToUser(userId, 'newMessage', msg);
          emitToUser(userId, 'messagesChanged', { chatId });
        });
      }
    }

    const senderName = users.get(currentUserId)?.name || currentUserId;
    const locInfo = location ? ` 📍 ${location.address || 'plats'}` : '';
    console.log(`💬 ${senderName} → "${text.slice(0, 30)}..." [${priority}]${locInfo}`);
  });

  // --- Scheduled Message Delivery ---
  function deliverScheduledMessage(messageId) {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled') return;
    msg.status = 'sent';
    msg.scheduledFor = null;
    scheduleTimers.delete(messageId);
    const chat = chats.get(msg.chatId);
    if (chat) {
      chat.participants.forEach(userId => {
        emitToUser(userId, 'messageDelivered', { message: msg });
        emitToUser(userId, 'messagesChanged', { chatId: msg.chatId });
      });
    }
    console.log(`📬 Scheduled message delivered: "${msg.text.slice(0, 30)}..."`);
  }

  // --- Cancel Scheduled Message ---
  socket.on('cancelScheduledMessage', (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled' || msg.senderId !== currentUserId) return;
    if (scheduleTimers.has(messageId)) {
      clearTimeout(scheduleTimers.get(messageId));
      scheduleTimers.delete(messageId);
    }
    const idx = messages.indexOf(msg);
    if (idx > -1) messages.splice(idx, 1);
    emitToUser(currentUserId, 'messageCancelled', { message: msg });
    emitToUser(currentUserId, 'messagesChanged', { chatId: msg.chatId });
  });

  // --- Reschedule Message ---
  socket.on('rescheduleMessage', ({ messageId, newScheduledFor }) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled' || msg.senderId !== currentUserId) return;
    if (scheduleTimers.has(messageId)) clearTimeout(scheduleTimers.get(messageId));
    msg.scheduledFor = newScheduledFor;
    const delay = newScheduledFor - Date.now();
    const timerId = setTimeout(() => deliverScheduledMessage(msg.id), delay);
    scheduleTimers.set(messageId, timerId);
    emitToUser(currentUserId, 'messageRescheduled', { message: msg, newScheduledFor });
    emitToUser(currentUserId, 'messagesChanged', { chatId: msg.chatId });
  });

  // --- Snooze Message ---
  socket.on('snoozeMessage', ({ messageId, durationMs }) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    const snoozeUntil = Date.now() + durationMs;
    msg.status = 'snoozed';
    msg.snoozeUntil = snoozeUntil;
    msg.snoozedBy = currentUserId;
    if (snoozeTimers.has(messageId)) clearTimeout(snoozeTimers.get(messageId));
    const timerId = setTimeout(() => triggerSnoozeReminder(messageId), durationMs);
    snoozeTimers.set(messageId, timerId);
    emitToChatParticipants(msg.chatId, 'messageUpdate', msg);
    emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  });

  function triggerSnoozeReminder(messageId) {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'snoozed') return;
    msg.status = 'sent';
    msg.snoozeUntil = null;
    const snoozedBy = msg.snoozedBy;
    msg.snoozedBy = null;
    snoozeTimers.delete(messageId);
    emitToUser(snoozedBy, 'snoozeReminder', { message: msg });
    emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
    console.log(`⏰ Snooze reminder triggered for "${msg.text.slice(0, 30)}..."`);
  }

  // --- Mark Seen ---
  socket.on('markSeen', (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (msg && msg.status === 'sent') {
      msg.status = 'seen';
      emitToChatParticipants(msg.chatId, 'messageUpdate', msg);
      emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
    }
  });

  // --- Mark Done ---
  socket.on('markDone', (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    if (snoozeTimers.has(messageId)) {
      clearTimeout(snoozeTimers.get(messageId));
      snoozeTimers.delete(messageId);
    }
    msg.status = 'done';
    msg.snoozeUntil = null;
    emitToChatParticipants(msg.chatId, 'messageUpdate', msg);
    emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    if (currentUserId && connectedUsers.has(currentUserId)) {
      connectedUsers.get(currentUserId).delete(socket.id);
      if (connectedUsers.get(currentUserId).size === 0) {
        connectedUsers.delete(currentUserId);
      }
      console.log(`👋 ${users.get(currentUserId)?.name || currentUserId} disconnected`);
    }
  });
});

// ========== Static Files (Production) ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// ========== REST API ==========
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'DFF! Server',
    users: users.size,
    chats: chats.size,
    messages: messages.length,
    online: connectedUsers.size,
    uptime: process.uptime(),
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

// ========== Start Server ==========
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔔 DFF! Server running on port ${PORT}`);
  console.log(`📡 WebSocket ready for connections`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health\n`);
});
