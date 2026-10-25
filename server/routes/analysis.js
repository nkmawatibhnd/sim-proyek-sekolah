'use strict';

const express = require('express');
const router = express.Router();
const { db, reseed } = require('../db');
const { buildScheduleSafe, simulate } = require('../scheduleService');
const { analyzeResources } = require('../scheduler/resources');

function rowFromIds(rows) {
  // helper map id->row
  return new Map(rows.map((r) => [r.id, r]));
}

// Jadwal terhitung lengkap (dipakai semua halaman)
router.get('/projects/:id/schedule', (req, res) => {
  const s = buildScheduleSafe(req.params.id);
  if (!s) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });
  if (s.error) return res.status(409).json({ error: s.message });
  res.json(s);
});

// Analisis sumber daya dengan filter
router.get('/projects/:id/resources', (req, res) => {
  const s = buildScheduleSafe(req.params.id);
  if (!s) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });
  if (s.error) return res.status(409).json({ error: s.message });
  const filter = {};
  if (req.query.member_id) filter.member_id = Number(req.query.member_id);
  if (req.query.role) filter.role = String(req.query.role);
  if (req.query.date_from) filter.date_from = String(req.query.date_from);
  if (req.query.date_to) filter.date_to = String(req.query.date_to);
  const rows = rowFromIds(s.members);
  const result = analyzeResources(
    { tasks: s.tasks, byId: new Map(s.tasks.map((t) => [t.id, t])), projectStart: s.projectStart, projectFinish: s.projectFinish, calendar: { workdays: s.calendarWorkdays } },
    s.members,
    db.prepare('SELECT * FROM member_leaves').all(),
    filter
  );
  // biaya per tugas
  const taskCosts = s.tasks.filter((t) => t.is_leaf).map((t) => ({
    task_id: t.id, code: t.code, name: t.name,
    cost: (t.assignees || []).reduce((a, x) => a + Math.round((x.salary_per_day * (t.work_dates ? t.work_dates.length : 0) * x.allocation) / 100), 0),
    assignees: (t.assignees || []).map((x) => ({ name: x.name, allocation: x.allocation, cost: Math.round((x.salary_per_day * (t.work_dates ? t.work_dates.length : 0) * x.allocation) / 100) })),
  })).filter((t) => t.assignees.length);
  void rows;
  res.json(Object.assign({}, result, { task_costs: taskCosts, total_cost: taskCosts.reduce((a, t) => a + t.cost, 0) }));
});

// Simulasi keterlambatan (tidak mengubah data)
router.post('/projects/:id/simulate', (req, res) => {
  const { task_id, delay } = req.body || {};
  const tid = Number(task_id);
  if (!tid) return res.status(400).json({ error: 'Pilih tugas yang akan disimulasikan.' });
  const delayN = Number(delay);
  if (isNaN(delayN) || delayN < 0) return res.status(400).json({ error: 'Keterlambatan harus angka >= 0.' });
  const r = simulate(Number(req.params.id), tid, delayN);
  if (!r) return res.status(404).json({ error: 'Tugas tidak ditemukan pada proyek ini.' });
  res.json(r);
});

// Ekspor jadwal CSV
router.get('/projects/:id/export.csv', (req, res) => {
  const s = buildScheduleSafe(req.params.id);
  if (!s || s.error) return res.status(409).json({ error: 'Jadwal tidak tersedia.' });
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [];
  lines.push(['Kode', 'Nama', 'Tipe', 'Mulai', 'Selesai', 'Durasi (hari kerja)', 'ES', 'EF', 'LS', 'LF', 'Slack (hari)', 'Kritis', 'Predecessor', 'Penanggung Jawab', 'Progres (%)'].map(esc).join(';'));
  for (const t of s.tasks) {
    lines.push([
      t.code, t.name, t.is_leaf ? 'Tugas' : 'Tugas Induk',
      t.start || '', t.finish || '', t.duration,
      t.is_leaf ? (t.es || '') : (t.es || ''), t.is_leaf ? (t.ef || '') : (t.ef || ''),
      t.is_leaf ? (t.ls || '') : (t.ls || ''), t.is_leaf ? (t.lf || '') : (t.lf || ''),
      t.slack, t.critical ? 'Kritis' : 'Normal', t.deps_text || '', t.responsible_name || '', t.progress || 0,
    ].map(esc).join(';'));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="jadwal-proyek-' + s.project.id + '.csv"');
  res.send(csv);
});

// Reset ke data contoh
router.post('/reset', (req, res) => {
  reseed();
  const p = db.prepare('SELECT * FROM projects ORDER BY id LIMIT 1').get();
  res.json({ ok: true, message: 'Data contoh berhasil dimuat ulang.', project_id: p ? p.id : null });
});

// Ringkasan sistem (halaman pengaturan)
router.get('/summary', (req, res) => {
  res.json({
    projects: db.prepare('SELECT COUNT(*) c FROM projects').get().c,
    tasks: db.prepare('SELECT COUNT(*) c FROM tasks').get().c,
    members: db.prepare('SELECT COUNT(*) c FROM members').get().c,
    holidays: db.prepare('SELECT COUNT(*) c FROM holidays').get().c,
    leaves: db.prepare('SELECT COUNT(*) c FROM member_leaves').get().c,
    assignments: db.prepare('SELECT COUNT(*) c FROM assignments').get().c,
    deps: db.prepare('SELECT COUNT(*) c FROM deps').get().c,
  });
});

module.exports = router;
