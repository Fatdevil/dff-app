// ============================================
// DFF! – Don't Freaking Forget
// Backend Server (Node.js + Socket.io)
// Email OTP + JWT + SQLite persistence
// ============================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  generateOtp, storeOtp, verifyOtp, sendOtpEmail,
  createToken, verifyToken, normalizeEmail, emailToUserId,
} from './auth.js';

import {
  upsertUser, getUserById, getAllUsers, rowToUser, rowToMessage,
  createChat, chatExists, getChatsByUser, getChatParticipants,
  insertMessage, getMessagesByChat, updateMessageStatus,
  updateMessageSnooze, updateMessageScheduled, deleteMessage, getMessageById,
} from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ========== In-memory (timers only – ej persistent data) ==========
const scheduleTimers = new Map();   // messageId -> timeoutId
const snoozeTimers = new Map();     // messageId -> timeoutId
const connectedUsers = new Map();   // userId -> Set<socketId>

// ========== Helper Functions ==========
function getAvatarClass(userId) {
  const colors = ['gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5'];
  const hash = String(userId).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function generateId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getChatIdForPair(userId1, userId2) {
  return `chat-${[userId1, userId2].sort().join('-')}`;
}

function emitToUser(userId, event, data) {
  const sockets = connectedUsers.get(userId) || new Set();
  sockets.forEach(sid => io.to(sid).emit(event, data));
}

function getParticipantIds(chatId) {
  return getChatParticipants.all(chatId).map(r => r.user_id);
}

function emitToChatParticipants(chatId, event, data, excludeUserId = null) {
  getParticipantIds(chatId).forEach(uid => {
    if (uid !== excludeUserId) emitToUser(uid, event, data);
  });
}

function getMessagesForUser(chatId, requestingUserId) {
  const rows = getMessagesByChat.all(chatId);
  return rows
    .map(rowToMessage)
    .filter(m => {
      if (m.scheduledFor && m.scheduledFor > Date.now() && m.senderId !== requestingUserId) return false;
      return true;
    });
}

function buildChatData(chatId, userId) {
  const participants = getParticipantIds(chatId);
  if (!participants.includes(userId)) return null;
  const msgs = getMessagesForUser(chatId, userId);
  const lastMsg = msgs[msgs.length - 1] || null;
  const unread = msgs.filter(m =>
    m.senderId !== userId && (m.status === 'sent' || m.status === 'delivered')
  ).length;
  const otherId = participants.find(p => p !== userId);
  const otherRow = otherId ? getUserById.get(otherId) : null;
  const otherUser = otherRow ? rowToUser(otherRow) : { id: otherId, name: otherId, emoji: '👤' };
  const snoozedMessage = msgs.find(m => m.status === 'snoozed' && m.snoozedBy === userId) || null;
  return { id: chatId, participants, lastMessage: lastMsg, unreadCount: unread, otherUser, snoozedMessage };
}

// ========== REST API – Auth ==========

app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Ange en giltig e-postadress' });
  }
  const normalizedEmail = normalizeEmail(email);
  const code = generateOtp();
  const stored = storeOtp(normalizedEmail, code);
  if (!stored.ok) return res.status(429).json({ ok: false, error: stored.error });
  const sent = await sendOtpEmail(normalizedEmail, code);
  if (!sent.ok) return res.status(500).json({ ok: false, error: sent.error });
  console.log(`📧 OTP skickad till ${normalizedEmail}${sent.dev ? ' (dev)' : ''}`);
  res.json({ ok: true, dev: sent.dev || false });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code, displayName } = req.body;
  if (!email || !code) return res.status(400).json({ ok: false, error: 'E-post och kod krävs' });
  const normalizedEmail = normalizeEmail(email);
  const result = verifyOtp(normalizedEmail, code);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error });

  const userId = emailToUserId(normalizedEmail);
  const name = (displayName || '').trim() || normalizedEmail.split('@')[0];

  upsertUser.run({
    id: userId,
    email: normalizedEmail,
    name,
    emoji: '👤',
    avatarClass: getAvatarClass(userId),
  });

  const token = createToken({ userId, email: normalizedEmail, displayName: name });
  const user = rowToUser(getUserById.get(userId));
  console.log(`🔑 Inloggad: ${name} (${normalizedEmail})`);
  res.json({ ok: true, token, user });
});

app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false });
  const result = verifyToken(token);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error });
  const user = rowToUser(getUserById.get(result.payload.userId));
  res.json({ ok: true, user, payload: result.payload });
});

// ========== Socket.io ==========
io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('login', (data) => {
    const token = typeof data === 'string' ? data : data?.token;
    const displayName = data?.displayName;
    if (!token) { socket.emit('loginError', { error: 'Token saknas' }); return; }

    const result = verifyToken(token);
    if (!result.ok) { socket.emit('loginError', { error: 'Sessionen har gått ut' }); return; }

    const { userId, email, displayName: tokenName } = result.payload;
    const name = displayName || tokenName || email;
    currentUserId = userId;

    // Säkerställ att användaren finns i DB
    upsertUser.run({ id: userId, email: email || '', name, emoji: '👤', avatarClass: getAvatarClass(userId) });

    if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
    connectedUsers.get(userId).add(socket.id);

    // Bygg chattlista från DB
    const chatRows = getChatsByUser.all(userId);
    const userChats = chatRows.map(r => buildChatData(r.id, userId)).filter(Boolean);

    // Väntande alarm
    const pendingAlarms = userChats
      .flatMap(c => getMessagesForUser(c.id, userId))
      .filter(m => m.senderId !== userId && m.priority === 'alarm' && m.status === 'sent' && !m.scheduledFor);

    socket.emit('loginSuccess', {
      user: rowToUser(getUserById.get(userId)),
      users: getAllUsers.all().map(rowToUser),
      chats: userChats,
      pendingAlarms,
    });

    console.log(`👤 ${name} inloggad (${userId})`);
  });

  // --- Para ihop med annan användare ---
  socket.on('pairWith', (partnerId) => {
    if (!currentUserId || !partnerId || typeof partnerId !== 'string' || partnerId.length > 100) return;
    const chatId = getChatIdForPair(currentUserId, partnerId);

    if (!chatExists.get(chatId)) {
      // Skapa partner-användare om de inte finns
      if (!getUserById.get(partnerId)) {
        upsertUser.run({ id: partnerId, email: '', name: partnerId, emoji: '👤', avatarClass: getAvatarClass(partnerId) });
      }
      createChat(chatId, currentUserId, partnerId);
      console.log(`💬 Ny chatt: ${currentUserId} ↔ ${partnerId}`);
    }

    socket.emit('chatCreated', buildChatData(chatId, currentUserId));
    emitToUser(partnerId, 'chatCreated', buildChatData(chatId, partnerId));
  });

  // --- Hämta meddelanden ---
  socket.on('loadMessages', (chatId) => {
    if (!currentUserId) return;
    if (!getParticipantIds(chatId).includes(currentUserId)) return;
    socket.emit('chatMessages', { chatId, messages: getMessagesForUser(chatId, currentUserId) });
  });

  // --- Skicka meddelande ---
  socket.on('sendMessage', ({ chatId, text, priority, scheduledFor, location }) => {
    if (!currentUserId) return;
    if (!text || typeof text !== 'string' || text.trim().length === 0 || text.length > 2000) return;
    if (!getParticipantIds(chatId).includes(currentUserId)) return;

    const safePriority = ['normal', 'important', 'alarm'].includes(priority) ? priority : 'normal';
    const isScheduled = scheduledFor && scheduledFor > Date.now();
    const safeLocation = location && typeof location.lat === 'number' ? location : null;

    const msg = {
      id: generateId(),
      chatId,
      senderId: currentUserId,
      text: text.trim(),
      priority: safePriority,
      status: isScheduled ? 'scheduled' : 'sent',
      timestamp: Date.now(),
      scheduledFor: isScheduled ? scheduledFor : null,
      snoozeUntil: null,
      snoozedBy: null,
      location: safeLocation,
    };

    insertMessage.run({
      id: msg.id,
      chatId: msg.chatId,
      senderId: msg.senderId,
      text: msg.text,
      priority: msg.priority,
      status: msg.status,
      timestamp: msg.timestamp,
      scheduledFor: msg.scheduledFor,
      locationLat: safeLocation?.lat ?? null,
      locationLng: safeLocation?.lng ?? null,
      locationRadius: safeLocation?.radius ?? null,
      locationAddress: safeLocation?.address ?? null,
    });

    if (isScheduled) {
      const delay = Math.max(0, scheduledFor - Date.now());
      scheduleTimers.set(msg.id, setTimeout(() => deliverScheduledMessage(msg.id), delay));
      emitToUser(currentUserId, 'messageScheduled', msg);
      emitToUser(currentUserId, 'messagesChanged', { chatId });
    } else {
      getParticipantIds(chatId).forEach(uid => {
        emitToUser(uid, 'newMessage', msg);
        emitToUser(uid, 'messagesChanged', { chatId });
      });
    }

    console.log(`💬 ${getUserById.get(currentUserId)?.name || currentUserId}: "${text.slice(0, 40)}"`);
  });

  // --- Schemalagd leverans ---
  function deliverScheduledMessage(messageId) {
    const row = getMessageById.get(messageId);
    if (!row || row.status !== 'scheduled') return;
    updateMessageScheduled.run({ status: 'sent', id: messageId });
    scheduleTimers.delete(messageId);
    const msg = rowToMessage(getMessageById.get(messageId));
    getParticipantIds(msg.chatId).forEach(uid => {
      emitToUser(uid, 'messageDelivered', { message: msg });
      emitToUser(uid, 'messagesChanged', { chatId: msg.chatId });
    });
  }

  // --- Avbryt schemalagd ---
  socket.on('cancelScheduledMessage', (messageId) => {
    const row = getMessageById.get(messageId);
    if (!row || row.status !== 'scheduled' || row.sender_id !== currentUserId) return;
    if (scheduleTimers.has(messageId)) { clearTimeout(scheduleTimers.get(messageId)); scheduleTimers.delete(messageId); }
    deleteMessage.run(messageId);
    emitToUser(currentUserId, 'messageCancelled', { message: rowToMessage(row) });
    emitToUser(currentUserId, 'messagesChanged', { chatId: row.chat_id });
  });

  // --- Snooze ---
  socket.on('snoozeMessage', ({ messageId, durationMs }) => {
    const row = getMessageById.get(messageId);
    if (!row) return;
    if (!getParticipantIds(row.chat_id).includes(currentUserId)) return;
    const snoozeUntil = Date.now() + durationMs;
    updateMessageSnooze.run({ status: 'snoozed', snoozeUntil, snoozedBy: currentUserId, id: messageId });
    if (snoozeTimers.has(messageId)) clearTimeout(snoozeTimers.get(messageId));
    snoozeTimers.set(messageId, setTimeout(() => triggerSnoozeReminder(messageId), durationMs));
    const updated = rowToMessage(getMessageById.get(messageId));
    emitToChatParticipants(row.chat_id, 'messageUpdate', updated);
    emitToChatParticipants(row.chat_id, 'messagesChanged', { chatId: row.chat_id });
  });

  function triggerSnoozeReminder(messageId) {
    const row = getMessageById.get(messageId);
    if (!row || row.status !== 'snoozed') return;
    const snoozedBy = row.snoozed_by;
    updateMessageSnooze.run({ status: 'sent', snoozeUntil: null, snoozedBy: null, id: messageId });
    snoozeTimers.delete(messageId);
    const msg = rowToMessage(getMessageById.get(messageId));
    emitToUser(snoozedBy, 'snoozeReminder', { message: msg });
    emitToChatParticipants(row.chat_id, 'messagesChanged', { chatId: row.chat_id });
  }

  // --- Markera sedd ---
  socket.on('markSeen', (messageId) => {
    const row = getMessageById.get(messageId);
    if (!row || row.status !== 'sent') return;
    if (!getParticipantIds(row.chat_id).includes(currentUserId)) return;
    updateMessageStatus.run({ status: 'seen', id: messageId });
    const msg = rowToMessage(getMessageById.get(messageId));
    emitToChatParticipants(row.chat_id, 'messageUpdate', msg);
    emitToChatParticipants(row.chat_id, 'messagesChanged', { chatId: row.chat_id });
  });

  // --- Markera klar ---
  socket.on('markDone', (messageId) => {
    const row = getMessageById.get(messageId);
    if (!row) return;
    if (!getParticipantIds(row.chat_id).includes(currentUserId)) return;
    if (snoozeTimers.has(messageId)) { clearTimeout(snoozeTimers.get(messageId)); snoozeTimers.delete(messageId); }
    updateMessageSnooze.run({ status: 'done', snoozeUntil: null, snoozedBy: null, id: messageId });
    const msg = rowToMessage(getMessageById.get(messageId));
    emitToChatParticipants(row.chat_id, 'messageUpdate', msg);
    emitToChatParticipants(row.chat_id, 'messagesChanged', { chatId: row.chat_id });
  });

  // --- Frånkoppling ---
  socket.on('disconnect', () => {
    if (currentUserId && connectedUsers.has(currentUserId)) {
      connectedUsers.get(currentUserId).delete(socket.id);
      if (connectedUsers.get(currentUserId).size === 0) connectedUsers.delete(currentUserId);
      console.log(`👋 ${getUserById.get(currentUserId)?.name || currentUserId} frånkopplad`);
    }
  });
});

// ========== Statiska filer ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'DFF!', online: connectedUsers.size, uptime: process.uptime() });
});

app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')));

// ========== Starta server ==========
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔔 DFF! Server på port ${PORT}`);
  const gmailReady = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD &&
    process.env.GMAIL_APP_PASSWORD !== 'xxxx-xxxx-xxxx-xxxx';
  if (!gmailReady) {
    console.log(`⚠️  DEV-LÄGE: OTP loggas i terminalen\n`);
  } else {
    console.log(`📧 Gmail SMTP: ${process.env.GMAIL_USER}\n`);
  }
});
