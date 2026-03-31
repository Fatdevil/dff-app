// ============================================
// DFF! – Database Module (SQLite)
// ============================================

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'dff.db'));

// Snabbare schrivningar, säker läsning
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ========== Schema ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    emoji       TEXT DEFAULT '👤',
    avatar_class TEXT DEFAULT 'gradient-1',
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chats (
    id          TEXT PRIMARY KEY,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id     TEXT NOT NULL REFERENCES chats(id),
    user_id     TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    chat_id       TEXT NOT NULL REFERENCES chats(id),
    sender_id     TEXT NOT NULL REFERENCES users(id),
    text          TEXT NOT NULL,
    priority      TEXT NOT NULL DEFAULT 'normal',
    status        TEXT NOT NULL DEFAULT 'sent',
    timestamp     INTEGER NOT NULL,
    scheduled_for INTEGER,
    snooze_until  INTEGER,
    snoozed_by    TEXT,
    location_lat  REAL,
    location_lng  REAL,
    location_radius INTEGER,
    location_address TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_participants_user ON chat_participants(user_id);
`);

console.log('🗄️ SQLite databas redo: data/dff.db');

// ========== Users ==========
export const upsertUser = db.prepare(`
  INSERT INTO users (id, email, name, emoji, avatar_class)
  VALUES (@id, @email, @name, @emoji, @avatarClass)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email
`);

export const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
export const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
export const getAllUsers = db.prepare('SELECT * FROM users');

// ========== Chats ==========
export const insertChat = db.prepare('INSERT OR IGNORE INTO chats (id) VALUES (?)');
export const insertParticipant = db.prepare(
  'INSERT OR IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)'
);
export const getChatsByUser = db.prepare(`
  SELECT c.id FROM chats c
  JOIN chat_participants cp ON cp.chat_id = c.id
  WHERE cp.user_id = ?
`);
export const getChatParticipants = db.prepare(`
  SELECT user_id FROM chat_participants WHERE chat_id = ?
`);
export const chatExists = db.prepare('SELECT id FROM chats WHERE id = ?');

// Transaktionshjälpare: skapa chatt med deltagare atomärt
export const createChat = db.transaction((chatId, userId1, userId2) => {
  insertChat.run(chatId);
  insertParticipant.run(chatId, userId1);
  insertParticipant.run(chatId, userId2);
});

// ========== Messages ==========
export const insertMessage = db.prepare(`
  INSERT INTO messages
    (id, chat_id, sender_id, text, priority, status, timestamp,
     scheduled_for, location_lat, location_lng, location_radius, location_address)
  VALUES
    (@id, @chatId, @senderId, @text, @priority, @status, @timestamp,
     @scheduledFor, @locationLat, @locationLng, @locationRadius, @locationAddress)
`);

export const getMessagesByChat = db.prepare(`
  SELECT * FROM messages
  WHERE chat_id = ?
  ORDER BY timestamp ASC
`);

export const updateMessageStatus = db.prepare(`
  UPDATE messages SET status = @status WHERE id = @id
`);

export const updateMessageSnooze = db.prepare(`
  UPDATE messages SET status = @status, snooze_until = @snoozeUntil, snoozed_by = @snoozedBy
  WHERE id = @id
`);

export const updateMessageScheduled = db.prepare(`
  UPDATE messages SET status = @status, scheduled_for = NULL WHERE id = @id
`);

export const deleteMessage = db.prepare('DELETE FROM messages WHERE id = ?');

export const getMessageById = db.prepare('SELECT * FROM messages WHERE id = ?');

// ========== Hjälp: konvertera DB-rad till API-format ==========
export function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    text: row.text,
    priority: row.priority,
    status: row.status,
    timestamp: row.timestamp,
    scheduledFor: row.scheduled_for || null,
    snoozeUntil: row.snooze_until || null,
    snoozedBy: row.snoozed_by || null,
    location: row.location_lat != null ? {
      lat: row.location_lat,
      lng: row.location_lng,
      radius: row.location_radius,
      address: row.location_address,
    } : null,
  };
}

export function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emoji: row.emoji,
    avatarClass: row.avatar_class,
  };
}

export default db;
