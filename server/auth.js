'use strict';

// Autentikasi sesi: token random (disimpan sebagai hash SHA-256 di SQLite),
// cookie HttpOnly SameSite=Lax, guard middleware, dan rate-limit login sederhana.

const crypto = require('crypto');
const { db } = require('./db');

const COOKIE_NAME = 'simpro_sid';
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000; // kunci 1 menit setelah 5x gagal berturut-turut

// ---------- Cookie helpers ----------
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch (e) { /* biarkan apa adanya */ }
    if (k) out[k] = v;
  }
  return out;
}

// ---------- Sesi ----------
function nowIso() { return new Date().toISOString(); }

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 86400 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, created.toISOString(), expires.toISOString());
  // Bersihkan sesi kedaluwarsa (pembersihan malas, murah karena LIMIT kecil).
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  return { token, expires };
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token_hash, s.expires_at, u.id AS user_id, u.username, u.email, u.name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return {
    userId: row.user_id, username: row.username, email: row.email,
    name: row.name || row.username, role: row.role,
  };
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------- Rate limit login (in-memory) ----------
const attempts = new Map(); // kunci: username/email url-encoded-lowercase

function normalizeKey(s) {
  return String(s || '').trim().toLowerCase();
}

// Kembali { ok: true } atau { ok: false, waitSeconds }
function checkAttempt(key) {
  const rec = attempts.get(normalizeKey(key));
  if (!rec) return { ok: true };
  if (rec.lockUntil && rec.lockUntil > Date.now()) {
    return { ok: false, waitSeconds: Math.ceil((rec.lockUntil - Date.now()) / 1000) };
  }
  if (rec.fails >= MAX_FAILS && rec.lockUntil) {
    attempts.delete(normalizeKey(key));
  }
  return { ok: true };
}

function recordFail(key) {
  const k = normalizeKey(key);
  const rec = attempts.get(k) || { fails: 0, lockUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) {
    rec.lockUntil = Date.now() + LOCK_MS * (rec.fails - MAX_FAILS + 1);
    rec.fails = MAX_FAILS; // reset penghitung kegagalan, waktu kunci makin panjang di sisi cek
  }
  attempts.set(k, rec);
}

function recordSuccess(key) {
  attempts.delete(normalizeKey(key));
}

// Kunci terkini dalam detik (untuk pesan error), 0 bila tidak dikunci.
function lockRemaining(key) {
  const rec = attempts.get(normalizeKey(key));
  if (!rec || !rec.lockUntil) return 0;
  return Math.max(0, Math.ceil((rec.lockUntil - Date.now()) / 1000));
}

// ---------- Guard middleware ----------
// Dipakai: app.use('/api', authGuard). Route publik: /api/auth/* (login/logout/me).
function authGuard(req, res, next) {
  const url = req.originalUrl || req.url || '';
  if (/^\/api\/auth(\/|\\?|$)/.test(url)) {
    return next();
  }
  // Semua endpoint API lainnya wajib sesi valid.
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk terlebih dahulu.' });
  }
  req.user = user;
  return next();
}

module.exports = {
  COOKIE_NAME, SESSION_DAYS,
  parseCookies, createSession, getSessionUser, destroySession,
  sessionCookie, clearCookie,
  checkAttempt, recordFail, recordSuccess, lockRemaining,
  authGuard,
};