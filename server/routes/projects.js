'use strict';

const express = require('express');
const router = express.Router();
const { db, rebuildCodes } = require('../db');
const { isValidYmd } = require('../scheduler/calendar');

function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

function validateProjectBody(body) {
  if (!body || !String(body.name || '').trim()) return 'Nama proyek wajib diisi.';
  if (!isValidYmd(body.start_date)) return 'Tanggal mulai proyek tidak valid (format YYYY-MM-DD).';
  if (body.workdays != null) {
    const s = String(body.workdays);
    if (!/^[0-6]+$/.test(s)) return 'Hari kerja tidak valid.';
  }
  return null;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY id').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const err = validateProjectBody(req.body);
  if (err) return bad(res, err);
  const name = String(req.body.name).trim();
  const org = String(req.body.org || '').trim();
  const desc = String(req.body.description || '').trim();
  const wd = String(req.body.workdays == null ? '12345' : req.body.workdays);
  const r = db.prepare('INSERT INTO projects (name, org, description, start_date, workdays) VALUES (?,?,?,?,?)')
    .run(name, org, desc, req.body.start_date, wd);
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 'Proyek tidak ditemukan.', 404);
  const body = Object.assign({}, p, req.body || {});
  const err = validateProjectBody(body);
  if (err) return bad(res, err);
  db.prepare('UPDATE projects SET name=?, org=?, description=?, start_date=?, workdays=? WHERE id=?')
    .run(String(body.name).trim(), String(body.org || '').trim(), String(body.description || '').trim(),
      body.start_date, String(body.workdays), p.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id));
});

router.delete('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 'Proyek tidak ditemukan.', 404);
  const tx = db.transaction(() => {
    const taskIds = db.prepare('SELECT id FROM tasks WHERE project_id = ? ORDER BY id DESC').all(p.id);
    for (const t of taskIds) {
      db.prepare('DELETE FROM deps WHERE task_id = ? OR pred_id = ?').run(t.id, t.id);
      db.prepare('DELETE FROM assignments WHERE task_id = ?').run(t.id);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
    }
    db.prepare('DELETE FROM holidays WHERE project_id = ?').run(p.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  });
  tx();
  res.json({ ok: true, message: 'Proyek "' + p.name + '" beserta seluruh datanya dihapus.' });
});

// Kalender proyek: hari kerja & daftar libur
router.get('/:id/calendar', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 'Proyek tidak ditemukan.', 404);
  const holidays = db.prepare('SELECT id, date, name FROM holidays WHERE project_id = ? ORDER BY date').all(p.id);
  res.json({ project: p, workdays: p.workdays.split('').map(Number), holidays });
});

router.post('/:id/holidays', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 'Proyek tidak ditemukan.', 404);
  const { date, name } = req.body || {};
  if (!isValidYmd(date)) return bad(res, 'Tanggal libur tidak valid.');
  if (!String(name || '').trim()) return bad(res, 'Keterangan hari libur wajib diisi.');
  const dup = db.prepare('SELECT id FROM holidays WHERE project_id=? AND date=?').get(p.id, date);
  if (dup) return bad(res, 'Tanggal tersebut sudah terdaftar sebagai hari libur.');
  const r = db.prepare('INSERT INTO holidays (project_id, date, name) VALUES (?,?,?)').run(p.id, date, String(name).trim());
  res.status(201).json(db.prepare('SELECT id, date, name FROM holidays WHERE id = ?').get(r.lastInsertRowid));
});

router.delete('/holidays/:hid', (req, res) => {
  const h = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.hid);
  if (!h) return bad(res, 'Hari libur tidak ditemukan.', 404);
  db.prepare('DELETE FROM holidays WHERE id = ?').run(h.id);
  res.json({ ok: true });
});

module.exports = router;
