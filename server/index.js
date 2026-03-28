// ============================================
// DFF! – Don't Freaking Forget
// Backend Server (Node.js + Socket.io)
// ============================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ========== In-Memory Store ==========
const users = [
  { id: 'alex', name: 'Alex', emoji: '👤', avatarClass: 'gradient-2' },
  { id: 'sam', name: 'Sam', emoji: '👤', avatarClass: 'gradient-1' },
];

const chats = [
  { id: 'chat-alex-sam', participants: ['alex', 'sam'] },
];

const messages = [
  {
    id: 'msg-1', chatId: 'chat-alex-sam', senderId: 'sam',
    text: 'Hej! Glöm inte att vi ska äta middag ikväll 🍕',
    priority: 'normal', timestamp: Date.now() - 3600000 * 3,
    status: 'seen', snoozeUntil: null, snoozedBy: null, scheduledFor: null,
  },
  {
    id: 'msg-2', chatId: 'chat-alex-sam', senderId: 'alex',
    text: 'Absolut! Vilken tid?',
    priority: 'normal', timestamp: Date.now() - 3600000 * 2.5,
    status: 'seen', snoozeUntil: null, snoozedBy: null, scheduledFor: null,
  },
  {
    id: 'msg-3', chatId: 'chat-alex-sam', senderId: 'sam',
    text: 'Kl 18:00 passar bra',
    priority: 'normal', timestamp: Date.now() - 3600000 * 2,
    status: 'seen', snoozeUntil: null, snoozedBy: null, scheduledFor: null,
  },
];

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
  const chat = chats.find(c => c.id === chatId);
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

function getMessagesForChat(chatId, userId) {
  return messages
    .filter(m => {
      if (m.chatId !== chatId) return false;
      // Hide scheduled messages from receiver until delivery time
      if (m.scheduledFor && m.scheduledFor > Date.now() && m.senderId !== userId) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ========== Socket.io Connection ==========
io.on('connection', (socket) => {
  let currentUserId = null;

  console.log(`🔌 Socket connected: ${socket.id}`);

  // --- Login ---
  socket.on('login', (userId) => {
    currentUserId = userId;

    // Track user's socket
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    // Send initial data
    const userChats = chats
      .filter(c => c.participants.includes(userId))
      .map(chat => {
        const msgs = getMessagesForChat(chat.id, userId);
        const lastMsg = msgs[msgs.length - 1] || null;
        const unread = msgs.filter(m =>
          m.senderId !== userId && (m.status === 'sent' || m.status === 'delivered')
        ).length;
        const otherId = chat.participants.find(p => p !== userId);
        const otherUser = users.find(u => u.id === otherId);
        const snoozedMsg = msgs.find(m =>
          m.status === 'snoozed' && m.snoozedBy === userId
        );

        return { ...chat, lastMessage: lastMsg, unreadCount: unread, otherUser, snoozedMessage: snoozedMsg };
      });

    // Check for pending alarm messages  
    const pendingAlarms = messages.filter(m =>
      m.chatId &&
      chats.find(c => c.id === m.chatId && c.participants.includes(userId)) &&
      m.senderId !== userId &&
      m.priority === 'alarm' &&
      m.status === 'sent' &&
      !m.scheduledFor
    );

    socket.emit('loginSuccess', {
      user: users.find(u => u.id === userId),
      users,
      chats: userChats,
      pendingAlarms,
    });

    console.log(`👤 ${userId} logged in (${connectedUsers.get(userId).size} sessions)`);
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
      location: location || null, // { lat, lng, radius, address }
    };
    messages.push(msg);

    if (isScheduled) {
      const delay = scheduledFor - Date.now();
      const timerId = setTimeout(() => {
        deliverScheduledMessage(msg.id);
      }, delay);
      scheduleTimers.set(msg.id, timerId);

      emitToUser(currentUserId, 'messageScheduled', msg);
      emitToUser(currentUserId, 'messagesChanged', { chatId });
    } else {
      const chat = chats.find(c => c.id === chatId);
      if (chat) {
        chat.participants.forEach(userId => {
          emitToUser(userId, 'newMessage', msg);
          emitToUser(userId, 'messagesChanged', { chatId });
        });
      }
    }

    const locInfo = location ? ` 📍 ${location.address || `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`} (${location.radius}m)` : '';
    console.log(`💬 ${currentUserId} → "${text.slice(0, 30)}..." [${priority}]${locInfo}`);
  });

  // --- Scheduled Message Delivery ---
  function deliverScheduledMessage(messageId) {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.status !== 'scheduled') return;

    msg.status = 'sent';
    msg.scheduledFor = null;
    scheduleTimers.delete(messageId);

    // Notify all participants
    const chat = chats.find(c => c.id === msg.chatId);
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

    if (scheduleTimers.has(messageId)) {
      clearTimeout(scheduleTimers.get(messageId));
    }

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

    if (snoozeTimers.has(messageId)) {
      clearTimeout(snoozeTimers.get(messageId));
    }

    const timerId = setTimeout(() => {
      triggerSnoozeReminder(messageId);
    }, durationMs);
    snoozeTimers.set(messageId, timerId);

    // Notify all in chat
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

    // Re-trigger alarm for the user who snoozed
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
      console.log(`👋 ${currentUserId} disconnected`);
    }
  });
});

// ========== Static Files (Production) ==========
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, '..', 'dist');

// Serve Vite-built frontend
app.use(express.static(distPath));

// ========== REST API (Health check) ==========
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'DFF! Server',
    users: connectedUsers.size,
    messages: messages.length,
    uptime: process.uptime(),
  });
});

// SPA fallback – serve index.html for all non-API routes
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
