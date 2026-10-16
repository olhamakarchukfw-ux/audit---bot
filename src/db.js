// База даних SQLite (вбудована в Node). Файл лежить на постійному диску Railway: DB_PATH=/data/bot.db
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  -- Короткі коди для переходу з ManyChat: код → нік Instagram
  CREATE TABLE IF NOT EXISTS start_codes (
    code       TEXT PRIMARY KEY,
    ig         TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Люди, які зайшли в бот
  CREATE TABLE IF NOT EXISTS people (
    tg_id        INTEGER PRIMARY KEY,
    name         TEXT,
    tg_username  TEXT,
    ig           TEXT,
    status       TEXT NOT NULL,
    analysis     TEXT,
    messages     TEXT,      -- JSON-масив повідомлень аудиту
    screenshots  TEXT,      -- JSON-масив file_id скріншотів
    attempts     INTEGER NOT NULL DEFAULT 0,
    next_try_at  INTEGER,   -- коли робити (наступну) спробу аудиту
    send_at      INTEGER,   -- коли надіслати готовий аудит
    sent_at      INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  -- Повідомлення, переслані Ользі: щоб її Reply дійшов потрібній людині
  CREATE TABLE IF NOT EXISTS owner_messages (
    owner_msg_id INTEGER PRIMARY KEY,
    tg_id        INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );
`);

// Внутрішні статуси і як вони пишуться в Google-таблиці
export const STATUS = {
  AWAITING_NICK: 'awaiting_nick',
  IN_WORK: 'in_work',
  AWAITING_SCREENS: 'awaiting_screens',
  READY: 'ready',
  SENT: 'sent',
  DIAGNOSTICS: 'diagnostics',
  ERROR: 'error',
};

export const STATUS_LABEL = {
  [STATUS.IN_WORK]: 'аудит у роботі',
  [STATUS.AWAITING_SCREENS]: 'чекаю скріншоти',
  [STATUS.READY]: 'аудит готовий',
  [STATUS.SENT]: 'аудит надіслано',
  [STATUS.DIAGNOSTICS]: 'хоче на діагностику',
  [STATUS.ERROR]: 'помилка',
};

const now = () => Date.now();
const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- Коди старту ----------

export function createStartCode(ig) {
  // Telegram дозволяє в параметрі старту лише A–Z, a–z, 0–9, _ і -
  const code = randomBytes(8).toString('base64url');
  db.prepare('INSERT INTO start_codes (code, ig, created_at) VALUES (?, ?, ?)').run(code, ig, now());
  db.prepare('DELETE FROM start_codes WHERE created_at < ?').run(now() - CODE_TTL_MS);
  return code;
}

export function resolveStartCode(code) {
  if (!code) return null;
  const row = db.prepare('SELECT ig, created_at FROM start_codes WHERE code = ?').get(code);
  if (!row || row.created_at < now() - CODE_TTL_MS) return null;
  return row.ig;
}

// ---------- Люди ----------

export function getPerson(tgId) {
  return db.prepare('SELECT * FROM people WHERE tg_id = ?').get(tgId) ?? null;
}

// Створює людину або оновлює її ім'я й нік Telegram (вони можуть змінитися).
export function upsertPerson(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || null;
  const tgUsername = from.username || null;
  const existing = getPerson(from.id);
  if (existing) {
    db.prepare('UPDATE people SET name = ?, tg_username = ?, updated_at = ? WHERE tg_id = ?').run(
      name,
      tgUsername,
      now(),
      from.id,
    );
  } else {
    db.prepare(
      'INSERT INTO people (tg_id, name, tg_username, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(from.id, name, tgUsername, STATUS.AWAITING_NICK, now(), now());
  }
  return getPerson(from.id);
}

const UPDATABLE = new Set([
  'ig', 'status', 'analysis', 'messages', 'screenshots', 'attempts',
  'next_try_at', 'send_at', 'sent_at',
]);

export function updatePerson(tgId, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return getPerson(tgId);
  const sql = `UPDATE people SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE tg_id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k] ?? null), now(), tgId);
  return getPerson(tgId);
}

export function deletePerson(tgId) {
  db.prepare('DELETE FROM owner_messages WHERE tg_id = ?').run(tgId);
  db.prepare('DELETE FROM people WHERE tg_id = ?').run(tgId);
}

// ---------- Повідомлення Ользі ----------

export function rememberOwnerMessage(ownerMsgId, tgId) {
  db.prepare('INSERT OR REPLACE INTO owner_messages (owner_msg_id, tg_id, created_at) VALUES (?, ?, ?)').run(
    ownerMsgId,
    tgId,
    now(),
  );
}

export function personByOwnerMessage(ownerMsgId) {
  const row = db.prepare('SELECT tg_id FROM owner_messages WHERE owner_msg_id = ?').get(ownerMsgId);
  return row ? getPerson(row.tg_id) : null;
}
