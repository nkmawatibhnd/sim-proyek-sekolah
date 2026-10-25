'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cal = require('../server/scheduler/calendar');
const { computeSchedule } = require('../server/scheduler/cpm');

function rows(n, opts) {
  // helper tugas sintetis: id i=1..n, urut rantai sesuai opts.chain
}

function mkTasks(defs, depsLike, opts) {
  // defs: [{id, parent_id?, duration, start?}] ; depsLike: [[task, pred, type, lag]]
  const tasks = defs.map((d) => Object.assign({
    id: d.id, parent_id: d.parent_id == null ? null : d.parent_id,
    name: 'T' + d.id, duration: d.duration == null ? 1 : d.duration,
    start_date: d.start || null, progress: 0, code: String(d.id), priority: 'Sedang',
  }, d));
  const deps = depsLike.map((d, i) => ({ id: i + 1, task_id: d[0], pred_id: d[1], type: d[2] || 'FS', lag: d[3] || 0 }));
  return { tasks, deps, assignments: opts && opts.assignments || [], leaves: opts && opts.leaves || [] };
}

function inputOf(build, proj) {
  return {
    project: proj || { start_date: '2026-01-05', workdays: [1, 2, 3, 4, 5] }, // Senin 5 Jan 2026
    holidays: (proj && proj.holidays) || [],
    tasks: build.tasks,
    deps: build.deps,
    assignments: build.assignments,
    leaves: build.leaves,
  };
}

test('Kalender: hari kerja Senin–Jumat dan melewati akhir pekan', () => {
  const flags = cal.workdaySet([1, 2, 3, 4, 5]);
  const days = cal.generateWorkdays('2026-01-05', 5, flags, new Set());
  // Sen 5, Sel 6, Rab 7, Kam 8, Jum 9 Jan 2026
  assert.deepStrictEqual(days, ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);
  // +1 = Sabtu harus dilewati
  const more = cal.generateWorkdays('2026-01-09', 2, flags, new Set());
  assert.deepStrictEqual(more, ['2026-01-09', '2026-01-12']);
});

test('Kalender: hari libur nasional dilewati', () => {
  const flags = cal.workdaySet([1, 2, 3, 4, 5]);
  const holidays = new Set(['2026-05-01']); // Jumat
  const days = cal.generateWorkdays('2026-04-30', 2, flags, holidays);
  assert.deepStrictEqual(days, ['2026-04-30', '2026-05-04']); // Lewati Jumat Agung... 1 Mei & akhir pekan
});

test('Kalender: 1 Jan 2026 adalah Kamis', () => {
  assert.strictEqual(cal.namaHari('2026-01-01'), 'Kamis');
});

test('Forward pass: tugas tanpa predecessor mulai dari awal proyek; FS menggeser', () => {
  const b = mkTasks(
    [{ id: 1, duration: 5 }, { id: 2, duration: 3 }],
    [[2, 1, 'FS', 0]]
  );
  const s = computeSchedule(inputOf(b));
  const t1 = s.tasks.find((t) => t.id === 1);
  const t2 = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(t1.start, '2026-01-05');
  assert.strictEqual(t1.finish, '2026-01-09'); // 5 hari kerja
  assert.strictEqual(t2.start, '2026-01-12'); // Jum 9 + FS -> Sen 12
  assert.strictEqual(t2.finish, '2026-01-14');
  assert.strictEqual(s.projectFinish, '2026-01-14');
});

test('FS dengan lag 7 hari kerja (curing beton)', () => {
  // pred: 2.3 pengecoran pondasi 3 hari; succ mulai 7 hari kerja setelah selesai
  const b = mkTasks(
    [{ id: 1, duration: 3 }, { id: 2, duration: 20 }],
    [[2, 1, 'FS', 7]]
  );
  const s = computeSchedule(inputOf(b, { start_date: '2026-01-05', workdays: [1, 2, 3, 4, 5] }));
  const t1 = s.tasks.find((t) => t.id === 1);
  const t2 = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(t1.finish, '2026-01-07'); // Sen-Kam
  // 7 hari kerja setelah 7 Jan: 8,9,12,13,14,15,16 -> succ mulai Sen 19 Jan
  assert.strictEqual(t2.start, '2026-01-19');
});

test('SS dengan lag', () => {
  // bata (25) mulai 10 hari kerja setelah kolom mulai
  const b = mkTasks(
    [{ id: 1, duration: 20 }, { id: 2, duration: 25 }],
    [[2, 1, 'SS', 10]]
  );
  const s = computeSchedule(inputOf(b));
  const t1 = s.tasks.find((t) => t.id === 1);
  const t2 = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(t1.start, '2026-01-05');
  // 10 hari kerja setelah 5 Jan = 19 Jan (Sen)
  assert.strictEqual(t2.start, '2026-01-19');
});

test('Backward pass: slack & jalur kritis rantai sederhana', () => {
  // A(3) -> B(2) -> C(4): semuanya kritis karena tidak ada jalur paralel
  const b = mkTasks(
    [{ id: 1, duration: 3 }, { id: 2, duration: 2 }, { id: 3, duration: 4 }],
    [[2, 1, 'FS', 0], [3, 2, 'FS', 0]]
  );
  const s = computeSchedule(inputOf(b));
  for (const t of s.tasks.filter((x) => x.is_leaf)) {
    assert.strictEqual(t.slack, 0, 'slack ' + t.id);
    assert.strictEqual(t.critical, true);
  }
  assert.strictEqual(s.projectDuration, 9);
});

test('Slack: tugas paralel yang lebih pendek punya float', () => {
  // Jalan kritis = X(10); Y(2) paralel tanpa penerus -> float 8
  const b = mkTasks(
    [{ id: 1, duration: 10, start: '2026-01-05' }, { id: 2, duration: 2, start: '2026-01-05' }],
    []
  );
  const s = computeSchedule(inputOf(b));
  const x = s.tasks.find((t) => t.id === 1);
  const y = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(x.critical, true);
  assert.strictEqual(y.critical, false);
  assert.strictEqual(y.slack, 8);
  assert.strictEqual(s.projectFinish, '2026-01-16'); // 10 hari kerja dari 5 Jan
});

test('Tugas induk: agregat tanggal & progres berbobot durasi', () => {
  const b = mkTasks(
    [
      { id: 100, parent_id: null },          // induk
      { id: 1, parent_id: 100, duration: 10, start: '2026-01-05' },
      { id: 2, parent_id: 100, duration: 2, start: '2026-01-19' },
    ],
    []
  );
  // progres: t1 100%, t2 0%  -> berbobot durasi: (10*100 + 2*0)/12 = 83.33
  b.tasks[1].progress = 100;
  const s = computeSchedule(inputOf(b));
  const parent = s.tasks.find((t) => t.id === 100);
  const t1 = s.tasks.find((t) => t.id === 1);
  const t2 = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(parent.es, t1.start);
  assert.strictEqual(parent.ef, t2.finish);
  assert.strictEqual(parent.duration, 12);
  assert.ok(Math.abs(parent.progress - 83.33) < 0.01);
});

test('Cuti anggota dimasukkan ke kalender tugas (tugas tertunda)', () => {
  // Tugas 5 hari kerja mulai Sen 5 Jan, tapi tukangnya cuti 7-8 Jan -> selesai 13 Jan
  const b = mkTasks(
    [{ id: 1, duration: 5, start: '2026-01-05' }],
    [],
    {
      assignments: [{ task_id: 1, member_id: 7, allocation: 100 }],
      leaves: [{ member_id: 7, start_date: '2026-01-07', end_date: '2026-01-08' }],
    }
  );
  const s = computeSchedule(inputOf(b));
  const t1 = s.tasks.find((t) => t.id === 1);
  // hari kerja efektif: 5,6,9,12,13
  assert.strictEqual(t1.finish, '2026-01-13');
  assert.strictEqual(t1.work_dates.length, 5);
});

test('Hari libur nasional menggeser jadwal proyek', () => {
  const flags = [1, 2, 3, 4, 5];
  const b = mkTasks([{ id: 1, duration: 3, start: '2026-04-30' }], []);
  const s = computeSchedule(inputOf(b, { start_date: '2026-01-05', workdays: flags, holidays: ['2026-05-01'] }));
  const t1 = s.tasks.find((t) => t.id === 1);
  // 30 Apr, 1 Mei libur, 4, 5, 6 Mei
  assert.strictEqual(t1.finish, '2026-05-06');
});

test('Simulasi keterlambatan memajukan akhir proyek tanpa mengubah data', () => {
  const b = mkTasks(
    [{ id: 1, duration: 3 }, { id: 2, duration: 4 }],
    [[2, 1, 'FS', 0]]
  );
  const base = computeSchedule(inputOf(b));
  const sim = computeSchedule(inputOf(b), { delays: { 1: 5 } });
  assert.strictEqual(base.projectFinish, '2026-01-13');
  assert.strictEqual(sim.projectFinish, '2026-01-20'); // +5 hari kerja
  assert.strictEqual(inputOf(b).tasks[0].name, 'T1'); // data tidak berubah
});

test('Lag negatif (lead) mempercepat mulai tugas berikutnya', () => {
  // FS -2: mulai 2 hari kerja sebelum pred selesai
  const proj = { start_date: '2026-01-05', workdays: [1, 2, 3, 4, 5, 6] }; // Senin-Sabtu
  const b = mkTasks(
    [{ id: 1, duration: 5, start: '2026-01-05' }, { id: 2, duration: 3 }],
    [[2, 1, 'FS', -2]]
  );
  const s = computeSchedule(inputOf(b, proj));
  const t1 = s.tasks.find((t) => t.id === 1);
  const t2 = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(t1.finish, '2026-01-09');
  assert.strictEqual(t2.start, '2026-01-08'); // 9 - 1? EF idx - lag -1: selesai idx pred tgl 9, start >= idx(9)-2 => 7
});

test('Lag dihitung dalam hari kerja, bukan hari kalender', () => {
  // Kalender Sen-Sabtu: pred selesai Jum 9 Jan; lag 2 hari kerja -> mulai Sen 12? (Sabtu 10 + Senin = kerja 2 hari: Sab 10, Sen 12) mulai Sel 13
  const proj = { start_date: '2026-01-05', workdays: [1, 2, 3, 4, 5, 6] };
  const b = mkTasks(
    [{ id: 1, duration: 5, start: '2026-01-05' }, { id: 2, duration: 3 }],
    [[2, 1, 'FS', 2]]
  );
  const s = computeSchedule(inputOf(b, proj));
  const t2 = s.tasks.find((t) => t.id === 2);
  assert.strictEqual(t2.start, '2026-01-13');
});

// helper rows tidak dipakai lagi
void rows;
