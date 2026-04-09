// ============================================
// DFF! – Database Module
// PostgreSQL i produktion (Railway DATABASE_URL)
// SQLite lokalt (better-sqlite3)
// ============================================

const USE_PG = !!process.env.DATABASE_URL;

console.log(`🗄️  Databas: ${USE_PG ? 'PostgreSQL (Railway)' : 'SQLite (lokal)'}`);

// ========== PostgreSQL ==========
let pgPool = null;
if (USE_PG) {
  const { default: pg } = await import('pg');
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      emoji       TEXT DEFAULT '👤',
      avatar_class TEXT DEFAULT 'gradient-1',
      created_at  BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id TEXT NOT NULL REFERENCES chats(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      chat_id          TEXT NOT NULL REFERENCES chats(id),
      sender_id        TEXT NOT NULL REFERENCES users(id),
      text             TEXT NOT NULL,
      priority         TEXT NOT NULL DEFAULT 'normal',
      status           TEXT NOT NULL DEFAULT 'sent',
      timestamp        BIGINT NOT NULL,
      scheduled_for    BIGINT,
      snooze_until     BIGINT,
      snoozed_by       TEXT,
      location_lat     DOUBLE PRECISION,
      location_lng     DOUBLE PRECISION,
      location_radius  INTEGER,
      location_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON chat_participants(user_id);
  `);

  console.log('✅ PostgreSQL tables redo');
}

// ========== SQLite ==========
let sqliteDb = null;
if (!USE_PG) {
  const { default: Database } = await import('better-sqlite3');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const { mkdirSync } = await import('fs');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(__dirname, 'data');
  mkdirSync(dataDir, { recursive: true });

  sqliteDb = new Database(join(dataDir, 'dff.db'));
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, emoji TEXT DEFAULT '👤',
      avatar_class TEXT DEFAULT 'gradient-1',
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id TEXT NOT NULL REFERENCES chats(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (chat_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
      sender_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'sent',
      timestamp INTEGER NOT NULL, scheduled_for INTEGER,
      snooze_until INTEGER, snoozed_by TEXT,
      location_lat REAL, location_lng REAL,
      location_radius INTEGER, location_address TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON chat_participants(user_id);
  `);

  console.log('✅ SQLite databas redo: data/dff.db');
}

// ========== Gemensamt API ==========

// Kör en query – returnerar rows[]
async function query(sql, params = []) {
  if (USE_PG) {
    const res = await pgPool.query(sql, params);
    return res.rows;
  } else {
    // SQLite: konvertera ? → positional params
    const stmt = sqliteDb.prepare(sql);
    if (sql.trimStart().toUpperCase().startsWith('SELECT')) {
      return stmt.all(...params);
    }
    stmt.run(...params);
    return [];
  }
}

// Kör en query – returnerar första raden eller null
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// ========== UPSERT helpers ==========

export async function upsertUser({ id, email, name, emoji = '👤', avatarClass = 'gradient-1' }) {
  if (USE_PG) {
    await query(
      `INSERT INTO users (id, email, name, emoji, avatar_class)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email`,
      [id, email, name, emoji, avatarClass]
    );
  } else {
    await query(
      `INSERT INTO users (id, email, name, emoji, avatar_class)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email`,
      [id, email, name, emoji, avatarClass]
    );
  }
}

// ========== Users ==========
export async function getUserById(id) {
  return queryOne(USE_PG ? 'SELECT * FROM users WHERE id = $1' : 'SELECT * FROM users WHERE id = ?', [id]);
}

export async function getAllUsers() {
  return query('SELECT * FROM users');
}

// ========== Chats ==========
export async function createChat(chatId, userId1, userId2) {
  if (USE_PG) {
    await query('INSERT INTO chats (id) VALUES ($1) ON CONFLICT DO NOTHING', [chatId]);
    await query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [chatId, userId1]);
    await query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [chatId, userId2]);
  } else {
    await query('INSERT OR IGNORE INTO chats (id) VALUES (?)', [chatId]);
    await query('INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?,?)', [chatId, userId1]);
    await query('INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?,?)', [chatId, userId2]);
  }
}

export async function chatExists(chatId) {
  const row = await queryOne(USE_PG ? 'SELECT id FROM chats WHERE id = $1' : 'SELECT id FROM chats WHERE id = ?', [chatId]);
  return !!row;
}

export async function getChatsByUser(userId) {
  return query(
    USE_PG
      ? 'SELECT c.id FROM chats c JOIN chat_participants cp ON cp.chat_id = c.id WHERE cp.user_id = $1'
      : 'SELECT c.id FROM chats c JOIN chat_participants cp ON cp.chat_id = c.id WHERE cp.user_id = ?',
    [userId]
  );
}

export async function getChatParticipants(chatId) {
  const rows = await query(
    USE_PG ? 'SELECT user_id FROM chat_participants WHERE chat_id = $1' : 'SELECT user_id FROM chat_participants WHERE chat_id = ?',
    [chatId]
  );
  return rows.map(r => r.user_id);
}

// ========== Messages ==========
export async function insertMessage(msg) {
  const p = USE_PG
    ? ['$1','$2','$3','$4','$5','$6','$7','$8','$9','$10','$11','$12']
    : ['?','?','?','?','?','?','?','?','?','?','?','?'];
  await query(
    `INSERT INTO messages
      (id, chat_id, sender_id, text, priority, status, timestamp,
       scheduled_for, location_lat, location_lng, location_radius, location_address)
     VALUES (${p.join(',')})`,
    [
      msg.id, msg.chatId, msg.senderId, msg.text, msg.priority, msg.status, msg.timestamp,
      msg.scheduledFor || null,
      msg.location?.lat ?? null, msg.location?.lng ?? null,
      msg.location?.radius ?? null, msg.location?.address ?? null,
    ]
  );
}

export async function getMessagesByChat(chatId) {
  const rows = await query(
    USE_PG
      ? 'SELECT * FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC'
      : 'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC',
    [chatId]
  );
  return rows.map(rowToMessage);
}

export async function getMessageById(id) {
  const row = await queryOne(USE_PG ? 'SELECT * FROM messages WHERE id = $1' : 'SELECT * FROM messages WHERE id = ?', [id]);
  return row ? rowToMessage(row) : null;
}

export async function updateMessageStatus(id, status) {
  await query(
    USE_PG ? 'UPDATE messages SET status = $1 WHERE id = $2' : 'UPDATE messages SET status = ? WHERE id = ?',
    [status, id]
  );
}

export async function updateMessageSnooze(id, status, snoozeUntil, snoozedBy) {
  await query(
    USE_PG
      ? 'UPDATE messages SET status=$1, snooze_until=$2, snoozed_by=$3 WHERE id=$4'
      : 'UPDATE messages SET status=?, snooze_until=?, snoozed_by=? WHERE id=?',
    [status, snoozeUntil, snoozedBy, id]
  );
}

export async function deliverScheduled(id) {
  await query(
    USE_PG
      ? 'UPDATE messages SET status=$1, scheduled_for=NULL WHERE id=$2'
      : 'UPDATE messages SET status=?, scheduled_for=NULL WHERE id=?',
    ['sent', id]
  );
}

export async function deleteMessage(id) {
  await query(USE_PG ? 'DELETE FROM messages WHERE id=$1' : 'DELETE FROM messages WHERE id=?', [id]);
}

// ========== Row converters ==========
export function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    text: row.text,
    priority: row.priority,
    status: row.status,
    timestamp: Number(row.timestamp),
    scheduledFor: row.scheduled_for ? Number(row.scheduled_for) : null,
    snoozeUntil: row.snooze_until ? Number(row.snooze_until) : null,
    snoozedBy: row.snoozed_by || null,
    location: row.location_lat != null ? {
      lat: row.location_lat, lng: row.location_lng,
      radius: row.location_radius, address: row.location_address,
    } : null,
  };
}

export function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, emoji: row.emoji, avatarClass: row.avatar_class };
}

// ========== P0 #5: Hämta meddelanden per status (för timer-återställning) ==========
export async function getMessagesByStatus(status) {
  const rows = await query(
    USE_PG
      ? 'SELECT * FROM messages WHERE status = $1 ORDER BY timestamp ASC'
      : 'SELECT * FROM messages WHERE status = ? ORDER BY timestamp ASC',
    [status]
  );
  return rows.map(rowToMessage);
}

// ========== P1 #9: Health check – verifiera DB-anslutning ==========
export async function healthCheck() {
  try {
    await queryOne('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}
