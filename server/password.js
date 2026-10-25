'use strict';

// Hash password menggunakan scrypt (crypto bawaan Node) — tanpa dependensi tambahan.
// Format tersimpan: scrypt$N$r$p$salt_hex$hash_hex

const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    if (!N || !r || !p) return false;
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    if (!salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(String(password || ''), salt, expected.length, { N, r, p });
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
