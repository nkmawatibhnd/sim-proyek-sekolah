'use strict';

// Route autentikasi: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me.
// Di-mount di server.js sebagai app.use('/api/auth', router).

const express = require('express');
const {
  createSession, getSessionUser, destroySession,
  sessionCookie, clearCookie,
  checkAttempt, recordFail, recordSuccess, lockRemaining,
} = require('../auth');
const { db } = require('../db');
const { verifyPassword } = require('../password');

const router = express.Router();

function publicUser(u) {
  return { id: u.userId, username: u.username, email: u.email, name: u.name, role: u.role };
}

router.post('/login', (req, res) => {
  const b = req.body || {};
  const identifier = String(b.username || b.email || '').trim();
  const password = String(b.password || '');

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/username dan password wajib diisi.' });
  }

  const lock = checkAttempt(identifier);
  if (!lock.ok) {
    return res.status(429).json({
      error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${lock.waitSeconds} detik.`,
    });
  }

  // Validasi kredensial di sisi server terhadap database (hash scrypt).
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(identifier, identifier);

  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFail(identifier);
    const rests = lockRemaining(identifier);
    const extra = rests > 0 ? ` Sisa kunci ${rests} detik.` : '';
    return res.status(401).json({ error: 'Email/username atau password salah.' + extra });
  }

  recordSuccess(identifier);
  const session = createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(session.token));
  return res.json({
    message: 'Login berhasil.',
    user: {
      id: user.id, username: user.username, email: user.email,
      name: user.name || user.username, role: user.role,
    },
  });
});

router.post('/logout', (req, res) => {
  destroySession(req);
  res.setHeader('Set-Cookie', clearCookie());
  return res.json({ message: 'Anda telah keluar.' });
});

router.get('/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum masuk.' });
  return res.json({ user: publicUser(user) });
});

module.exports = router;
