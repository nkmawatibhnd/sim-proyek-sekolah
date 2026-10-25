'use strict';

const express = require('express');
const router = express.Router();
const { db, rebuildCodes, deleteTaskCascade, isDescendant } = require('../db');
const { isValidYmd } = require('../scheduler/calendar');

function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

const PRIORITIES = ['Rendah', 'Sedang', 'Tinggi', 'Kritis'];

function taskHasChildren(id) {
  return !!db.prepare('SELECT id FROM tasks WHERE parent_id = ? LIMIT 1').get(id);
}

function num(reqId) {
  return Number(reqId);
}

// Ambil tugas + proyeknya
function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function siblingMax(projectId, parentId) {
  return db.prepare('SELECT COALESCE(MAX(sort),0) AS m FROM tasks WHERE project_id=? AND (parent_id IS ?)')
    .get(projectId, parentId == null ? null : parentId).m;
}

function validateTaskBody(body, existing) {
  if (!String(body.name || '').trim()) return 'Nama tugas wajib diisi.';
  if (body.priority != null && !PRIORITIES.includes(body.priority)) return 'Prioritas tidak valid.';
  if (body.progress != null) {
    const v = Number(body.progress);
    if (isNaN(v) || v < 0 || v > 100) return 'Progres harus angka 0–100.';
  }
  if (body.duration != null) {
    const v = Number(body.duration);
    if (isNaN(v) || v < 1) return 'Durasi minimal 1 hari kerja.';
  }
  if (body.start_date && !isValidYmd(body.start_date)) return 'Tanggal mulai tidak valid.';
  // Tanggal mulai manual hanya bermakna untuk tugas tanpa predecessor.
  void existing;
  return null;
}

router.post('/', (req, res) => {
  const b = req.body || {};
  const projectId = Number(b.project_id);
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return bad(res, 'Proyek tidak ditemukan.');
  const err = validateTaskBody(b);
  if (err) return bad(res, err);
  let parentId = b.parent_id == null || b.parent_id === '' ? null : Number(b.parent_id);
  if (parentId != null) {
    const parent = getTask(parentId);
    if (!parent || parent.project_id !== projectId) return bad(res, 'Tugas induk tidak ditemukan.');
  }
  const duration = b.parent_id != null && b.summary === true ? 0 : (Number(b.duration) || 1);
  const r = db.prepare(`INSERT INTO tasks
    (project_id, code, parent_id, name, start_date, duration, priority, notes, responsible_id, progress, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(projectId, '', parentId, String(b.name).trim(),
      b.start_date || null,
      duration,
      b.priority || 'Sedang',
      String(b.notes || '').trim(),
      b.responsible_id || null,
      Number(b.progress) || 0,
      siblingMax(projectId, parentId) + 1);
  rebuildCodes(projectId);
  res.status(201).json(getTask(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const t = getTask(num(req.params.id));
  if (!t) return bad(res, 'Tugas tidak ditemukan.', 404);
  const b = Object.assign({}, t, req.body || {});
  const err = validateTaskBody(b);
  if (err) return bad(res, err);
  const isParent = taskHasChildren(t.id);
  const hasDeps = !!db.prepare('SELECT id FROM deps WHERE task_id = ? LIMIT 1').get(t.id);
  let start = b.start_date || null;
  if (start && (isParent || hasDeps)) {
    return bad(res, 'Tanggal mulai tugas ini dihitung otomatis' + (isParent ? ' (tugas induk)' : ' (tugas memiliki predecessor)') + '. Kosongkan tanggal mulai.');
  }
  if (!hasDeps && !start && !isParent) {
    // tanpa predecessor & tanpa tanggal -> default: mulai proyek (scheduler menangani null)
  }
  db.prepare(`UPDATE tasks SET name=?, start_date=?, duration=?, priority=?, notes=?, responsible_id=?, progress=? WHERE id=?`)
    .run(String(b.name).trim(), start, isParent ? t.duration : (Number(b.duration) || t.duration || 1),
      b.priority || 'Sedang', String(b.notes || '').trim(), b.responsible_id || null,
      isParent ? t.progress : (Number(b.progress) || 0), t.id);
  rebuildCodes(t.project_id);
  res.json(getTask(t.id));
});

router.delete('/:id', (req, res) => {
  const t = getTask(num(req.params.id));
  if (!t) return bad(res, 'Tugas tidak ditemukan.', 404);
  const isParent = taskHasChildren(t.id);
  deleteTaskCascade(t.id);
  rebuildCodes(t.project_id);
  res.json({ ok: true, deleted_parent: isParent, message: isParent ?
    'Tugas induk beserta seluruh sub-kegiatannya telah dihapus.' : 'Tugas dihapus.' });
});

// Pindah tugas: ganti induk dan/atau posisi
router.post('/:id/move', (req, res) => {
  const t = getTask(num(req.params.id));
  if (!t) return bad(res, 'Tugas tidak ditemukan.', 404);
  const b = req.body || {};
  let newParent = b.parent_id === null ? null : (b.parent_id == null ? t.parent_id : Number(b.parent_id));
  if (newParent != null) {
    if (newParent === t.id) return bad(res, 'Tugas tidak dapat menjadi induk dirinya sendiri.');
    if (isDescendant(newParent, t.id)) return bad(res, 'Tugas tidak dapat dipindah ke bawah sub-kegiatannya sendiri.');
    const parent = getTask(newParent);
    if (!parent || parent.project_id !== t.project_id) return bad(res, 'Tugas induk baru tidak ditemukan.');
  }
  const idx = Number(b.position);
  if (isNaN(idx) || idx < 0) return bad(res, 'Posisi tidak valid.');
  const tx = db.transaction(() => {
    db.prepare('UPDATE tasks SET parent_id = ?, sort = ? WHERE id = ?').run(newParent, idx + 1, t.id);
    const sibs = db.prepare('SELECT id, sort FROM tasks WHERE project_id = ? AND (parent_id IS ?) ORDER BY sort, id')
      .all(t.project_id, newParent);
    // normalkan urutan setelah penyisipan
    const clean = sibs.filter((s) => s.id !== t.id);
    clean.splice(Math.min(idx, clean.length), 0, { id: t.id });
    const updSort = db.prepare('UPDATE tasks SET sort = ? WHERE id = ?');
    clean.forEach((s, i) => updSort.run(i + 1, s.id));
    rebuildCodes(t.project_id);
  });
  tx();
  res.json(getTask(t.id));
});

router.post('/:id/move/relative', (req, res) => {
  const t = getTask(num(req.params.id));
  if (!t) return bad(res, 'Tugas tidak ditemukan.', 404);
  const dir = (req.body || {}).direction === 'up' ? -1 : 1;
  const sibs = db.prepare('SELECT id, sort FROM tasks WHERE project_id = ? AND (parent_id IS ?) ORDER BY sort, id')
    .all(t.project_id, t.parent_id);
  const i = sibs.findIndex((s) => s.id === t.id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return bad(res, 'Tugas sudah berada di posisi ter' + (dir < 0 ? 'atas' : 'bawah') + '.');
  const upd = db.prepare('UPDATE tasks SET sort = ? WHERE id = ?');
  const tx = db.transaction(() => {
    upd.run(sibs[j].sort, t.id);
    upd.run(sibs[i].sort, sibs[j].id);
    rebuildCodes(t.project_id);
  });
  tx();
  res.json(getTask(t.id));
});

// ---------- Ketergantungan ----------
// Tukar seluruh predecessor tugas (semantik replace-all agar mudah dipakai UI)
router.put('/:id/deps', (req, res) => {
  const t = getTask(num(req.params.id));
  if (!t) return bad(res, 'Tugas tidak ditemukan.', 404);
  const list = (req.body || {}).deps || [];
  if (!Array.isArray(list)) return bad(res, 'Format predecessor tidak valid.');

  const seen = new Map();
  for (const d of list) {
    const predId = Number(d.pred_id);
    if (!predId) return bad(res, 'Predecessor tidak valid.');
    if (predId === t.id) return bad(res, 'Tugas tidak dapat menjadi predecessor dirinya sendiri.');
    if (taskHasChildren(predId)) {
      const p = getTask(predId);
      return bad(res, 'Tugas induk "' + p.code + ' ' + p.name + '" tidak dapat dijadikan predecessor — pilih tugas sub-kegiatan.');
    }
    if (seen.has(predId)) return bad(res, 'Predecessor "' + getTask(predId).code + '" duplikat.');
    seen.set(predId, true);
    const type = d.type === 'SS' ? 'SS' : 'FS';
    let lag = Number(d.lag) || 0;
    // Lag negatif (lead) dibolehkan untuk membuat tugas overlap
    const dep = db.prepare('SELECT id FROM tasks WHERE id = ?').get(predId);
    if (!dep || dep.project_id !== t.project_id) return bad(res, 'Predecessor harus dari proyek yang sama.');
  }

  // Deteksi dependency melingkar: dari tugas, ikuti rantai "penerus" — bila kembali ke salah
  // satu predecessor baru maka melingkar.
  for (const d of list) {
    const predId = Number(d.pred_id);
    if (reachesPred(predId, t.id)) {
      // predId tergantung pada t.id secara transitif -> pred -> task -> ... -> pred melingkar
      const p = getTask(predId);
      return bad(res, 'Ketergantungan melingkar terdeteksi: "' + p.code + ' ' + p.name +
        '" (langsung atau tidak langsung) bergantung pada "' + t.code + ' ' + t.name + '".');
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM deps WHERE task_id = ?').run(t.id);
    const ins = db.prepare('INSERT INTO deps (task_id, pred_id, type, lag) VALUES (?,?,?,?)');
    for (const d of list) ins.run(t.id, Number(d.pred_id), d.type === 'SS' ? 'SS' : 'FS', Number(d.lag) || 0);
  });
  tx();
  const hasDeps = list.length > 0;
  if (!hasDeps) {
    // tanpa predecessor → tanggal mulai manual boleh dipakai kembali
  }
  res.json({ ok: true, deps: db.prepare('SELECT * FROM deps WHERE task_id = ?').all(t.id) });
});

// Apakah taskId tergantung transitif pada targetId (targetId ada di rantai predecessor)?
function reachesPred(taskId, targetId) {
  const stack = [taskId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (cur === targetId) return true;
    for (const d of db.prepare('SELECT pred_id FROM deps WHERE task_id = ?').all(cur)) stack.push(d.pred_id);
  }
  return false;
}

module.exports = router;
