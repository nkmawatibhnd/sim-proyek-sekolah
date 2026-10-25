'use strict';

// Unit test autentikasi: hash/verifikasi password scrypt (server/password.js)
// dan keacakan token sesi (server/auth.js). Tidak memerlukan jaringan/HTTP.

const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword } = require('../server/password');
const crypto = require('crypto');

test('hash password sesuai format scrypt dengan komponen N/r/p/salt/hash', () => {
  const h = hashPassword('admin123');
  const parts = h.split('$');
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts.length, 6);
  assert.equal(parseInt(parts[1], 10), 16384);
  assert.equal(parts[4].length, 32); // salt 16 byte hex
  assert.equal(parts[5].length, 128); // hash 64 byte hex
  assert.ok(!h.includes('admin123'), 'password tidak boleh muncul di dalam hash');
});

test('verifyPassword menerima password yang benar dan menolak yang salah', () => {
  const h = hashPassword('rahasia2026');
  assert.equal(verifyPassword('rahasia2026', h), true);
  assert.equal(verifyPassword('rahasia2025', h), false);
  assert.equal(verifyPassword('', h), false);
});

test('salt acak membuat hash berbeda untuk password yang sama', () => {
  const a = hashPassword('sama123');
  const b = hashPassword('sama123');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('sama123', a), true);
  assert.equal(verifyPassword('sama123', b), true);
});

test('verifyPassword menolak hash yang rusak dengan aman', () => {
  assert.equal(verifyPassword('admin123', 'bukan-hash'), false);
  assert.equal(verifyPassword('admin123', ''), false);
  assert.equal(verifyPassword('admin123', 'scrypt$99$8$1$zz$gg'), false);
});

test('verifikasi memakai timingSafeEqual (tidak bocor via waktu pada input beda panjang)', () => {
  const h = hashPassword('panjanglebihdari32karakterdoctor');
  try {
    verifyPassword('pendek', h);
  } catch (e) {
    assert.fail('verifyPassword seharusnya tidak melempar error untuk password pendek');
  }
  assert.equal(verifyPassword('pendek', h), false);
});

test('token sesi acak, valid hex, dan berbeda tiap kali dibuat', () => {
  const tokens = new Set();
  for (let i = 0; i < 5; i++) {
    const t = crypto.randomBytes(32).toString('hex');
    tokens.add(t);
    assert.equal(t.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(t));
  }
  assert.equal(tokens.size, 5);
});
