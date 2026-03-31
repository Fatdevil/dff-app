// ============================================
// DFF! – Don't Freaking Forget
// Server (Node.js + Socket.io)
// SQLite lokalt / PostgreSQL på Railway
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
  insertMessage, getMessagesByChat, getMessageById,
  updateMessageStatus, updateMessageSnooze, deliverScheduled, deleteMessage,
} from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Timers – hålls i minnet (är transient, behöver ej persisteras)
const scheduleTimers = new Map();
const snoozeTimers = new Map();
const connectedUsers = new Map(); // userId -> Set<socketId>

// ========== Helpers ==========
function getAvatarClass(userId) {
  const colors = ['gradient-1','gradient-2','gradient-3','gradient-4','gradient-5'];
  const hash = String(userId).split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}
function generateId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
}
function getChatIdForPair(a, b) {
  return `chat-${[a, b].sort().join('-')}`;
}
function emitToUser(userId, event, data) {
  (connectedUsers.get(userId) || new Set()).forEach(sid => io.to(sid).emit(event, data));
}
async function emitToChatParticipants(chatId, event, data, exclude = null) {
  const participants = await getChatParticipants(chatId);
  participants.forEach(uid => { if (uid !== exclude) emitToUser(uid, event, data); });
}

async function getMessagesForUser(chatId, userId) {
  const msgs = await getMessagesByChat(chatId);
  return msgs.filter(m => !(m.scheduledFor && m.scheduledFor > Date.now() && m.senderId !== userId));
}

async function buildChatData(chatId, userId) {
  const participants = await getChatParticipants(chatId);
  if (!participants.includes(userId)) return null;
  const msgs = await getMessagesForUser(chatId, userId);
  const lastMsg = msgs[msgs.length - 1] || null;
  const unread = msgs.filter(m => m.senderId !== userId && ['sent','delivered'].includes(m.status)).length;
  const otherId = participants.find(p => p !== userId);
  const otherRow = otherId ? await getUserById(otherId) : null;
  const otherUser = otherRow ? rowToUser(otherRow) : { id: otherId, name: otherId, emoji: '👤' };
  const snoozedMessage = msgs.find(m => m.status === 'snoozed' && m.snoozedBy === userId) || null;
  return { id: chatId, participants, lastMessage: lastMsg, unreadCount: unread, otherUser, snoozedMessage };
}

// ========== REST – Auth ==========
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ange en giltig e-post' });
  const normalizedEmail = normalizeEmail(email);
  const code = generateOtp();
  const stored = storeOtp(normalizedEmail, code);
  if (!stored.ok) return res.status(429).json({ ok: false, error: stored.error });
  const sent = await sendOtpEmail(normalizedEmail, code);
  if (!sent.ok) return res.status(500).json({ ok: false, error: sent.error });
  res.json({ ok: true, dev: sent.dev || false });
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, code, displayName } = req.body;
  if (!email || !code) return res.status(400).json({ ok: false, error: 'E-post och kod krävs' });
  const normalizedEmail = normalizeEmail(email);
  const result = verifyOtp(normalizedEmail, code);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error });

  const userId = emailToUserId(normalizedEmail);
  const name = (displayName || '').trim() || normalizedEmail.split('@')[0];
  await upsertUser({ id: userId, email: normalizedEmail, name, emoji: '👤', avatarClass: getAvatarClass(userId) });

  const token = createToken({ userId, email: normalizedEmail, displayName: name });
  const user = rowToUser(await getUserById(userId));
  console.log(`🔑 Inloggad: ${name} (${normalizedEmail})`);
  res.json({ ok: true, token, user });
});

app.get('/api/auth/me', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false });
  const result = verifyToken(token);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error });
  const user = rowToUser(await getUserById(result.payload.userId));
  res.json({ ok: true, user, payload: result.payload });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', online: connectedUsers.size, uptime: process.uptime() });
});

// ========== Socket.io ==========
io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('login', async (data) => {
    const token = typeof data === 'string' ? data : data?.token;
    const displayName = data?.displayName;
    if (!token) { socket.emit('loginError', { error: 'Token saknas' }); return; }
    const result = verifyToken(token);
    if (!result.ok) { socket.emit('loginError', { error: 'Sessionen har gått ut' }); return; }

    const { userId, email, displayName: tokenName } = result.payload;
    const name = displayName || tokenName || email;
    currentUserId = userId;

    await upsertUser({ id: userId, email: email || '', name, emoji: '👤', avatarClass: getAvatarClass(userId) });
    if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
    connectedUsers.get(userId).add(socket.id);

    const chatRows = await getChatsByUser(userId);
    const userChats = (await Promise.all(chatRows.map(r => buildChatData(r.id, userId)))).filter(Boolean);

    const pendingAlarms = userChats
      .flatMap(c => c.lastMessage ? [c.lastMessage] : [])
      .filter(m => m.senderId !== userId && m.priority === 'alarm' && m.status === 'sent' && !m.scheduledFor);

    socket.emit('loginSuccess', {
      user: rowToUser(await getUserById(userId)),
      users: (await getAllUsers()).map(rowToUser),
      chats: userChats,
      pendingAlarms,
    });
    console.log(`👤 ${name} inloggad`);
  });

  socket.on('pairWith', async (partnerId) => {
    if (!currentUserId || !partnerId || typeof partnerId !== 'string' || partnerId.length > 100) return;
    const chatId = getChatIdForPair(currentUserId, partnerId);
    if (!await chatExists(chatId)) {
      if (!await getUserById(partnerId)) {
        await upsertUser({ id: partnerId, email: '', name: partnerId, emoji: '👤', avatarClass: getAvatarClass(partnerId) });
      }
      await createChat(chatId, currentUserId, partnerId);
      console.log(`💬 Ny chatt: ${currentUserId} ↔ ${partnerId}`);
    }
    socket.emit('chatCreated', await buildChatData(chatId, currentUserId));
    emitToUser(partnerId, 'chatCreated', await buildChatData(chatId, partnerId));
  });

  socket.on('loadMessages', async (chatId) => {
    if (!currentUserId) return;
    const participants = await getChatParticipants(chatId);
    if (!participants.includes(currentUserId)) return;
    socket.emit('chatMessages', { chatId, messages: await getMessagesForUser(chatId, currentUserId) });
  });

  socket.on('sendMessage', async ({ chatId, text, priority, scheduledFor, location }) => {
    if (!currentUserId || !text || typeof text !== 'string' || !text.trim() || text.length > 2000) return;
    const participants = await getChatParticipants(chatId);
    if (!participants.includes(currentUserId)) return;

    const safePriority = ['normal','important','alarm'].includes(priority) ? priority : 'normal';
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

    await insertMessage(msg);

    if (isScheduled) {
      const delay = Math.max(0, scheduledFor - Date.now());
      scheduleTimers.set(msg.id, setTimeout(() => deliverScheduledMessage(msg.id), delay));
      emitToUser(currentUserId, 'messageScheduled', msg);
      emitToUser(currentUserId, 'messagesChanged', { chatId });
    } else {
      participants.forEach(uid => {
        emitToUser(uid, 'newMessage', msg);
        emitToUser(uid, 'messagesChanged', { chatId });
      });
    }
  });

  async function deliverScheduledMessage(messageId) {
    await deliverScheduled(messageId);
    scheduleTimers.delete(messageId);
    const msg = await getMessageById(messageId);
    if (!msg) return;
    const participants = await getChatParticipants(msg.chatId);
    participants.forEach(uid => {
      emitToUser(uid, 'messageDelivered', { message: msg });
      emitToUser(uid, 'messagesChanged', { chatId: msg.chatId });
    });
  }

  socket.on('cancelScheduledMessage', async (messageId) => {
    const msg = await getMessageById(messageId);
    if (!msg || msg.status !== 'scheduled' || msg.senderId !== currentUserId) return;
    if (scheduleTimers.has(messageId)) { clearTimeout(scheduleTimers.get(messageId)); scheduleTimers.delete(messageId); }
    await deleteMessage(messageId);
    emitToUser(currentUserId, 'messageCancelled', { message: msg });
    emitToUser(currentUserId, 'messagesChanged', { chatId: msg.chatId });
  });

  socket.on('snoozeMessage', async ({ messageId, durationMs }) => {
    const msg = await getMessageById(messageId);
    if (!msg) return;
    const participants = await getChatParticipants(msg.chatId);
    if (!participants.includes(currentUserId)) return;
    const snoozeUntil = Date.now() + durationMs;
    await updateMessageSnooze(messageId, 'snoozed', snoozeUntil, currentUserId);
    if (snoozeTimers.has(messageId)) clearTimeout(snoozeTimers.get(messageId));
    snoozeTimers.set(messageId, setTimeout(() => triggerSnoozeReminder(messageId), durationMs));
    const updated = await getMessageById(messageId);
    await emitToChatParticipants(msg.chatId, 'messageUpdate', updated);
    await emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  });

  async function triggerSnoozeReminder(messageId) {
    const msg = await getMessageById(messageId);
    if (!msg || msg.status !== 'snoozed') return;
    const snoozedBy = msg.snoozedBy;
    await updateMessageSnooze(messageId, 'sent', null, null);
    snoozeTimers.delete(messageId);
    const updated = await getMessageById(messageId);
    emitToUser(snoozedBy, 'snoozeReminder', { message: updated });
    await emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  }

  socket.on('markSeen', async (messageId) => {
    const msg = await getMessageById(messageId);
    if (!msg || msg.status !== 'sent') return;
    const participants = await getChatParticipants(msg.chatId);
    if (!participants.includes(currentUserId)) return;
    await updateMessageStatus(messageId, 'seen');
    const updated = await getMessageById(messageId);
    await emitToChatParticipants(msg.chatId, 'messageUpdate', updated);
    await emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  });

  socket.on('markDone', async (messageId) => {
    const msg = await getMessageById(messageId);
    if (!msg) return;
    const participants = await getChatParticipants(msg.chatId);
    if (!participants.includes(currentUserId)) return;
    if (snoozeTimers.has(messageId)) { clearTimeout(snoozeTimers.get(messageId)); snoozeTimers.delete(messageId); }
    await updateMessageSnooze(messageId, 'done', null, null);
    const updated = await getMessageById(messageId);
    await emitToChatParticipants(msg.chatId, 'messageUpdate', updated);
    await emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  });

  socket.on('disconnect', async () => {
    if (currentUserId && connectedUsers.has(currentUserId)) {
      connectedUsers.get(currentUserId).delete(socket.id);
      if (connectedUsers.get(currentUserId).size === 0) connectedUsers.delete(currentUserId);
      const u = await getUserById(currentUserId);
      console.log(`👋 ${u?.name || currentUserId} frånkopplad`);
    }
  });
});

// ========== Statiska filer ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')));

// ========== Start ==========
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  const gmailReady = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD &&
    process.env.GMAIL_APP_PASSWORD !== 'xxxx-xxxx-xxxx-xxxx';
  console.log(`\n🔔 DFF! Server på port ${PORT}`);
  console.log(gmailReady ? `📧 Gmail: ${process.env.GMAIL_USER}` : `⚠️  DEV-LÄGE: OTP loggas i terminalen`);
  console.log('');
});
