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
  insertMessage, getMessagesByChat, getMessageById, getMessagesByStatus,
  updateMessageStatus, updateMessageSnooze, deliverScheduled, deleteMessage,
  healthCheck,
} from './db.js';

// ========== P0 #1: Env-validering ==========
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dff-dev-secret-change-in-production')) {
  console.error('🛑 FATAL: JWT_SECRET saknas eller är default i produktion. Servern kan inte starta.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Timers – hålls i minnet, återskapas vid startup från DB
const scheduleTimers = new Map();
const snoozeTimers = new Map();
const connectedUsers = new Map(); // userId -> Set<socketId>

// ========== P0 #4: Rate Limiter ==========
const rateLimits = new Map(); // socketId -> { count, windowStart }
const RATE_LIMIT_WINDOW = 60_000; // 1 minut
const RATE_LIMIT_MAX = 60;        // max events per minut

function checkRateLimit(socketId) {
  const now = Date.now();
  let entry = rateLimits.get(socketId);
  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW) {
    entry = { count: 0, windowStart: now };
    rateLimits.set(socketId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Rensa rate-limit entries var 5:e minut
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW * 2;
  for (const [id, entry] of rateLimits) {
    if (entry.windowStart < cutoff) rateLimits.delete(id);
  }
}, 300_000);

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

// ========== P0 #5: Återskapa timers vid startup ==========
async function restoreTimers() {
  try {
    const scheduled = await getMessagesByStatus('scheduled');
    let restoredSchedule = 0;
    for (const msg of scheduled) {
      if (msg.scheduledFor && msg.scheduledFor > Date.now()) {
        const delay = msg.scheduledFor - Date.now();
        scheduleTimers.set(msg.id, setTimeout(() => deliverScheduledMessage(msg.id), delay));
        restoredSchedule++;
      } else if (msg.scheduledFor) {
        // Meddelande borde redan levererats – leverera nu
        await deliverScheduledMessage(msg.id);
        restoredSchedule++;
      }
    }

    const snoozed = await getMessagesByStatus('snoozed');
    let restoredSnooze = 0;
    for (const msg of snoozed) {
      if (msg.snoozeUntil && msg.snoozeUntil > Date.now()) {
        const delay = msg.snoozeUntil - Date.now();
        snoozeTimers.set(msg.id, setTimeout(() => triggerSnoozeReminder(msg.id), delay));
        restoredSnooze++;
      } else {
        // Snooze har gått ut – trigga direkt
        await triggerSnoozeReminder(msg.id);
        restoredSnooze++;
      }
    }

    if (restoredSchedule > 0 || restoredSnooze > 0) {
      console.log(`🔄 Återställda timers: ${restoredSchedule} schemalagda, ${restoredSnooze} snoozade`);
    }
  } catch (err) {
    console.error('❌ Fel vid timer-återställning:', err.message);
  }
}

// Shared timer functions (moved outside socket scope for restart)
async function deliverScheduledMessage(messageId) {
  try {
    await deliverScheduled(messageId);
    scheduleTimers.delete(messageId);
    const msg = await getMessageById(messageId);
    if (!msg) return;
    const participants = await getChatParticipants(msg.chatId);
    participants.forEach(uid => {
      emitToUser(uid, 'messageDelivered', { message: msg });
      emitToUser(uid, 'messagesChanged', { chatId: msg.chatId });
    });
  } catch (err) {
    console.error(`❌ Fel vid leverans av ${messageId}:`, err.message);
  }
}

async function triggerSnoozeReminder(messageId) {
  try {
    const msg = await getMessageById(messageId);
    if (!msg || msg.status !== 'snoozed') return;
    const snoozedBy = msg.snoozedBy;
    await updateMessageSnooze(messageId, 'sent', null, null);
    snoozeTimers.delete(messageId);
    const updated = await getMessageById(messageId);
    emitToUser(snoozedBy, 'snoozeReminder', { message: updated });
    await emitToChatParticipants(msg.chatId, 'messagesChanged', { chatId: msg.chatId });
  } catch (err) {
    console.error(`❌ Fel vid snooze-påminnelse för ${messageId}:`, err.message);
  }
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

// ========== P1 #9: Health-check med DB-ping ==========
app.get('/api/health', async (req, res) => {
  try {
    const dbOk = await healthCheck();
    res.json({
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'error',
      online: connectedUsers.size,
      uptime: Math.round(process.uptime()),
      timers: { scheduled: scheduleTimers.size, snoozed: snoozeTimers.size },
    });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

// ========== P0 #2: Socket.io Auth Middleware ==========
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    // Allow unauthenticated connections temporarily – they must emit 'login' to do anything useful
    // This preserves backward compatibility with the login flow
    socket.authenticated = false;
    return next();
  }
  const result = verifyToken(token);
  if (!result.ok) {
    return next(new Error('Ogiltig eller utgången token'));
  }
  socket.userId = result.payload.userId;
  socket.authenticated = true;
  next();
});

// ========== Socket.io ==========
io.on('connection', (socket) => {
  let currentUserId = socket.userId || null;

  // If already authenticated via handshake, register immediately
  if (socket.authenticated && currentUserId) {
    if (!connectedUsers.has(currentUserId)) connectedUsers.set(currentUserId, new Set());
    connectedUsers.get(currentUserId).add(socket.id);
  }

  socket.on('login', async (data) => {
    // P0 #4: Rate limit
    if (!checkRateLimit(socket.id)) {
      socket.emit('loginError', { error: 'För många förfrågningar – vänta en stund' });
      return;
    }

    const token = typeof data === 'string' ? data : data?.token;
    const displayName = data?.displayName;
    if (!token) { socket.emit('loginError', { error: 'Token saknas' }); return; }
    const result = verifyToken(token);
    if (!result.ok) { socket.emit('loginError', { error: 'Sessionen har gått ut' }); return; }

    const { userId, email, displayName: tokenName } = result.payload;
    const name = displayName || tokenName || email;
    currentUserId = userId;
    socket.userId = userId;
    socket.authenticated = true;

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

  // P0 #4: Guard – all events below require auth
  function requireAuth() {
    if (!currentUserId || !socket.authenticated) {
      socket.emit('loginError', { error: 'Inte autentiserad' });
      return false;
    }
    if (!checkRateLimit(socket.id)) {
      socket.emit('error', { message: 'Rate limit – vänta en stund' });
      return false;
    }
    return true;
  }

  socket.on('pairWith', async (partnerId) => {
    if (!requireAuth()) return;
    if (!partnerId || typeof partnerId !== 'string' || partnerId.length > 100) return;
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
    if (!requireAuth()) return;
    const participants = await getChatParticipants(chatId);
    if (!participants.includes(currentUserId)) return;
    socket.emit('chatMessages', { chatId, messages: await getMessagesForUser(chatId, currentUserId) });
  });

  socket.on('sendMessage', async ({ chatId, text, priority, scheduledFor, location }) => {
    if (!requireAuth()) return;
    if (!text || typeof text !== 'string' || !text.trim() || text.length > 2000) return;
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

  socket.on('cancelScheduledMessage', async (messageId) => {
    if (!requireAuth()) return;
    const msg = await getMessageById(messageId);
    if (!msg || msg.status !== 'scheduled' || msg.senderId !== currentUserId) return;
    if (scheduleTimers.has(messageId)) { clearTimeout(scheduleTimers.get(messageId)); scheduleTimers.delete(messageId); }
    await deleteMessage(messageId);
    emitToUser(currentUserId, 'messageCancelled', { message: msg });
    emitToUser(currentUserId, 'messagesChanged', { chatId: msg.chatId });
  });

  socket.on('snoozeMessage', async ({ messageId, durationMs }) => {
    if (!requireAuth()) return;
    if (!durationMs || typeof durationMs !== 'number' || durationMs < 0 || durationMs > 86400000) return; // max 24h
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

  socket.on('markSeen', async (messageId) => {
    if (!requireAuth()) return;
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
    if (!requireAuth()) return;
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
    rateLimits.delete(socket.id);
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

// ========== P1 #8: Graceful Shutdown ==========
function gracefulShutdown(signal) {
  console.log(`\n⏹ ${signal} mottagen – stänger ner...`);
  // Notify all connected clients
  io.emit('serverRestarting', { message: 'Servern startar om – ansluter automatiskt igen' });

  // Clear all timers
  for (const [id, timer] of scheduleTimers) { clearTimeout(timer); }
  for (const [id, timer] of snoozeTimers) { clearTimeout(timer); }

  httpServer.close(() => {
    console.log('✅ Server nedstängd korrekt');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    console.error('⚠️ Tvingad nedstängning efter timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ========== Start ==========
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', async () => {
  const resendReady = !!process.env.RESEND_API_KEY;
  console.log(`\n🔔 DFF! Server på port ${PORT}`);
  console.log(`🔒 JWT: ${IS_PROD ? 'Produktion (env secret)' : 'Dev-läge (fallback secret)'}`);
  console.log(resendReady ? `📧 E-post: Resend API` : `⚠️  DEV-LÄGE: OTP loggas i terminalen`);

  // P0 #5: Återskapa timers från DB
  await restoreTimers();

  console.log('✅ Server redo!\n');
});
