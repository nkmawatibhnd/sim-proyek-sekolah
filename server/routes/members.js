'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { isValidYmd } = require('../scheduler/calendar');

function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

// ---------- Anggota ----------
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM members ORDER BY name').all());
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return bad(res, 'Nama anggota wajib diisi.');
  if (!String(b.role || '').trim()) return bad(res, 'Peran/posisi wajib diisi.');
  const sal = Number(b.salary_per_day);
  if (isNaN(sal) || sal < 0) return bad(res, 'Gaji per hari harus angka >= 0.');
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return bad(res, 'Format email tidak valid.');
  const r = db.prepare('INSERT INTO members (name, phone, email, role, salary_per_day) VALUES (?,?,?,?,?)')
    .run(String(b.name).trim(), String(b.phone || '').trim(), String(b.email || '').trim(),
      String(b.role).trim(), sal);
  res.status(201).json(db.prepare('SELECT * FROM members WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!m) return bad(res, 'Anggota tidak ditemukan.', 404);
  const b = Object.assign({}, m, req.body || {});
  if (!String(b.name || '').trim()) return bad(res, 'Nama anggota wajib diisi.');
  if (!String(b.role || '').trim()) return bad(res, 'Peran/posisi wajib diisi.');
  const sal = Number(b.salary_per_day);
  if (isNaN(sal) || sal < 0) return bad(res, 'Gaji per hari harus angka >= 0.');
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return bad(res, 'Format email tidak valid.');
  db.prepare('UPDATE members SET name=?, phone=?, email=?, role=?, salary_per_day=? WHERE id=?')
    .run(String(b.name).trim(), String(b.phone || '').trim(), String(b.email || '').trim(), String(b.role).trim(), sal, m.id);
  res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(m.id));
});

router.delete('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!m) return bad(res, 'Anggota tidak ditemukan.', 404);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM member_leaves WHERE member_id = ?').run(m.id);
    db.prepare('DELETE FROM assignments WHERE member_id = ?').run(m.id);
    db.prepare('UPDATE tasks SET responsible_id = NULL WHERE responsible_id = ?').run(m.id);
    db.prepare('DELETE FROM members WHERE id = ?').run(m.id);
  });
  tx();
  res.json({ ok: true, message: 'Anggota "' + m.name + '" dan seluruh penugasannya telah dihapus.' });
});

// ---------- Cuti pribadi ----------
router.post('/:id/leaves', (req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!m) return bad(res, 'Anggota tidak ditemukan.', 404);
  const { start_date, end_date, notes } = req.body || {};
  if (!isValidYmd(start_date)) return bad(res, 'Tanggal mulai cuti tidak valid.');
  const end = end_date || start_date;
  if (!isValidYmd(end)) return bad(res, 'Tanggal akhir cuti tidak valid.');
  if (end < start_date) return bad(res, 'Tanggal akhir cuti tidak boleh lebih awal dari tanggal mulai.');
  const r = db.prepare('INSERT INTO member_leaves (member_id, start_date, end_date, notes) VALUES (?,?,?,?)')
    .run(m.id, start_date, end, String(notes || '').trim());
  res.status(201).json(db.prepare('SELECT * FROM member_leaves WHERE id = ?').get(r.lastInsertRowid));
});

router.delete('/leaves/:lid', (req, res) => {
  const l = db.prepare('SELECT * FROM member_leaves WHERE id = ?').get(req.params.lid);
  if (!l) return bad(res, 'Data cuti tidak ditemukan.', 404);
  db.prepare('DELETE FROM member_leaves WHERE id = ?').run(l.id);
  res.json({ ok: true });
});

// Detail anggota: tugas yang ditugaskan + total beban + biaya
router.get('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!m) return bad(res, 'Anggota tidak ditemukan.', 404);
  const leaves = db.prepare('SELECT * FROM member_leaves WHERE member_id = ? ORDER BY start_date').all(m.id);
  const assignments = db.prepare('SELECT a.*, t.code, t.name, t.project_id FROM assignments a JOIN tasks t ON t.id = a.task_id WHERE a.member_id = ? ORDER BY t.code').all(m.id);
  res.json({ member: m, leaves, assignments });
});

// ---------- Penugasan ----------
// Ganti seluruh penugasan satu tugas (leaf saja)
router.put('/assignments/task/:taskId', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!t) return bad(res, 'Tugas tidak ditemukan.', 404);
  const child = db.prepare('SELECT id FROM tasks WHERE parent_id = ? LIMIT 1').get(t.id);
  if (child) return bad(res, 'Penugasan hanya untuk tugas sub-kegiatan (bukan tugas induk).');
  const list = (req.body || {}).members || [];
  if (!Array.isArray(list)) return bad(res, 'Format penugasan tidak valid.');
  const seen = new Map();
  for (const a of list) {
    const mid = Number(a.member_id);
    const alloc = Number(a.allocation == null ? 100 : a.allocation);
    if (!db.prepare('SELECT id FROM members WHERE id = ?').get(mid)) return bad(res, 'Anggota tidak ditemukan.');
    if (isNaN(alloc) || alloc < 1 || alloc > 100) return bad(res, 'Alokasi harus 1–100%.');
    if (seen.has(mid)) return bad(res, 'Anggota "' + (db.prepare('SELECT name FROM members WHERE id=?').get(mid).name) + '" duplikat.');
    seen.set(mid, true);
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM assignments WHERE task_id = ?').run(t.id);
    const ins = db.prepare('INSERT INTO assignments (task_id, member_id, allocation) VALUES (?,?,?)');
    for (const a of list) ins.run(t.id, Number(a.member_id), Number(a.allocation == null ? 100 : a.allocation));
  });
  tx();
  res.json({ ok: true, assignments: db.prepare('SELECT * FROM assignments WHERE task_id = ?').all(t.id) });
});

router.delete('/assignments/:aid', (req, res) => {
  const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.aid);
  if (!a) return bad(res, 'Penugasan tidak ditemukan.', 404);
  db.prepare('DELETE FROM assignments WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

module.exports = router;
