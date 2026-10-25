'use strict';

// Database SQLite: skema + seed data contoh + reset.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.db');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  org TEXT DEFAULT '',
  description TEXT DEFAULT '',
  start_date TEXT NOT NULL,
  workdays TEXT NOT NULL DEFAULT '12345'
);
CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  role TEXT DEFAULT '',
  salary_per_day REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  code TEXT DEFAULT '',
  parent_id INTEGER,
  name TEXT NOT NULL,
  start_date TEXT,
  duration REAL NOT NULL DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'Sedang',
  notes TEXT DEFAULT '',
  responsible_id INTEGER,
  progress REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  pred_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'FS',
  lag REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS member_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  allocation REAL NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'admin',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`);

function reseed() {
  const tx = db.transaction(() => {
    db.exec('DELETE FROM projects; DELETE FROM holidays; DELETE FROM tasks; DELETE FROM deps; DELETE FROM members; DELETE FROM member_leaves; DELETE FROM assignments;');

    const insProject = db.prepare('INSERT INTO projects (name, org, description, start_date, workdays) VALUES (?,?,?,?,?)');
    const p = insProject.run('Pembangunan Gedung SD Negeri Baru', 'Dinas Pendidikan Kota',
      'Konstruksi gedung sekolah dasar 2 lantai, pengadaan perabot & buku, dan rekrutmen guru/staf.',
      '2026-01-05', '12345');
    const projectId = p.lastInsertRowid;

    const insHoliday = db.prepare('INSERT INTO holidays (project_id,date,name) VALUES (?,?,?)');
    const H = [
      ['2026-01-01', 'Tahun Baru Masehi'],
      ['2026-02-18', 'Awal Ramadan (perkiraan)'],
      ['2026-03-20', 'Idulfitri (perkiraan)'],
      ['2026-03-21', 'Idulfitri hari kedua (perkiraan)'],
      ['2026-03-27', 'Libur khusus proyek: perawatan alat berat'],
      ['2026-04-03', 'Jumat Agung'],
      ['2026-05-01', 'Hari Buruh Internasional'],
      ['2026-05-14', 'Kenaikan Isa Almasih'],
      ['2026-05-27', 'Idul Adha (perkiraan)'],
      ['2026-06-01', 'Hari Lahir Pancasila'],
      ['2026-07-03', 'Libur khusus proyek: persiapan gedung diserahkan'],
      ['2026-08-17', 'Hari Kemerdekaan RI'],
    ];
    for (const [d, n] of H) insHoliday.run(projectId, d, n);

    const insTask = db.prepare('INSERT INTO tasks (project_id,code,parent_id,name,start_date,duration,priority,notes,responsible_id,progress,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const IDs = {}; // kode -> id
    // Definisi (kode, nama, induk, start, durasi, prioritas, catatan, PJ-index, progres)
    const defs = [
      ['1', 'Persiapan dan Perizinan', null, null, null, 'Sedang', '', null, null],
      ['1.1', 'Survei lokasi dan pengukuran', '1', '2026-01-05', 5, 'Sedang', 'Menggunakan stasiun total.', 1, 100],
      ['1.2', 'Pengurusan PBG dan izin lingkungan', '1', null, 14, 'Kritis', 'Koordinasi dengan Dinas PUPR.', 10, 100],
      ['1.3', 'Mobilisasi alat dan pembangunan direksi keet', '1', null, 4, 'Sedang', '', 2, 100],
      ['2', 'Pekerjaan Pondasi', null, null, null, 'Tinggi', '', null, null],
      ['2.1', 'Galian tanah pondasi', '2', null, 6, 'Tinggi', '', 2, 100],
      ['2.2', 'Pembesian dan bekisting pondasi', '2', null, 5, 'Tinggi', '', 2, 50],
      ['2.3', 'Pengecoran pondasi', '2', null, 3, 'Kritis', 'Mutu beton K-225.', 5, 0],
      ['3', 'Struktur dan Dinding', null, null, null, 'Kritis', '', null, null],
      ['3.1', 'Kolom dan balok lantai 1', '3', null, 20, 'Kritis', 'Curing 7 hari kerja setelah pengecoran pondasi.', 2, 20],
      ['3.2', 'Pemasangan dinding bata', '3', null, 25, 'Kritis', '', 2, 0],
      ['3.3', 'Plat dan struktur lantai 2', '3', null, 15, 'Tinggi', '', 2, 0],
      ['4', 'Pekerjaan Atap', null, null, null, 'Tinggi', '', null, null],
      ['4.1', 'Rangka atap baja ringan', '4', null, 10, 'Tinggi', '', 2, 0],
      ['4.2', 'Pemasangan penutup atap', '4', null, 8, 'Sedang', '', 2, 0],
      ['5', 'Instalasi MEP', null, null, null, 'Tinggi', '', null, null],
      ['5.1', 'Instalasi listrik', '5', null, 15, 'Tinggi', '', 6, 0],
      ['5.2', 'Instalasi air bersih dan sanitasi', '5', null, 12, 'Sedang', '', 7, 0],
      ['6', 'Finishing', null, null, null, 'Sedang', '', null, null],
      ['6.1', 'Plester dan acian', '6', null, 15, 'Tinggi', '', 2, 0],
      ['6.2', 'Pengecatan', '6', null, 10, 'Kritis', 'Pengeringan 3 hari kerja.', 8, 0],
      ['6.3', 'Pemasangan lantai keramik', '6', null, 12, 'Sedang', '', 3, 0],
      ['6.4', 'Pemasangan pintu dan jendela', '6', null, 8, 'Sedang', '', 2, 0],
      ['7', 'Pengadaan Perabot dan Buku', null, null, null, 'Sedang', '', null, null],
      ['7.1', 'Penyusunan spesifikasi dan tender perabot', '7', null, 10, 'Tinggi', '', 9, 40],
      ['7.2', 'Produksi meja, kursi, dan papan tulis', '7', null, 25, 'Sedang', '', 9, 0],
      ['7.3', 'Pengadaan buku dan alat peraga', '7', null, 15, 'Sedang', '', 9, 0],
      ['7.4', 'Pemasangan dan penataan perabot', '7', null, 5, 'Sedang', '', 2, 0],
      ['8', 'Rekrutmen Guru dan Staf', null, null, null, 'Sedang', '', null, null],
      ['8.1', 'Pembukaan lowongan dan pendaftaran', '8', null, 14, 'Sedang', '', 10, 60],
      ['8.2', 'Seleksi dan wawancara', '8', null, 10, 'Tinggi', '', 10, 0],
      ['8.3', 'Pelatihan dan orientasi', '8', null, 5, 'Sedang', '', 1, 0],
      ['9', 'Serah Terima', null, null, null, 'Kritis', '', null, null],
      ['9.1', 'Pembersihan area proyek', '9', null, 4, 'Sedang', '', 2, 0],
      ['9.2', 'Inspeksi dan uji kelayakan bangunan', '9', null, 3, 'Kritis', '', 1, 0],
      ['9.3', 'Serah terima resmi ke sekolah', '9', null, 1, 'Kritis', '', 1, 0],
    ];
    const treeRows = defs;

    // Anggota tim
    const members = [
      ['Budi Santoso', '0812-1000-001', 'budi.santoso@dinas.go.id', 'Pengawas Lapangan', 500000],
      ['Ahmad Wijaya', '0812-1000-002', 'ahmad.wijaya@kontraktor.co.id', 'Mandor', 350000],
      ['Joko Susilo', '0812-1000-003', 'joko.susilo@kontraktor.co.id', 'Tukang Batu 1', 250000],
      ['Rudi Hartono', '0812-1000-004', 'rudi.hartono@kontraktor.co.id', 'Tukang Batu 2', 250000],
      ['Dedi Kurniawan', '0812-1000-005', 'dedi.kurniawan@kontraktor.co.id', 'Tukang Besi/Pembesian', 300000],
      ['Eko Prasetyo', '0812-1000-006', 'eko.prasetyo@kontraktor.co.id', 'Tukang Listrik', 300000],
      ['Fajar Ramadhan', '0812-1000-007', 'fajar.ramadhan@kontraktor.co.id', 'Tukang Plumbing', 280000],
      ['Gunawan Saputra', '0812-1000-008', 'gunawan.saputra@kontraktor.co.id', 'Tukang Cat', 250000],
      ['Hendra Putra', '0812-1000-009', 'hendra.putra@dinas.go.id', 'Staf Pengadaan', 220000],
      ['Irfan Maulana', '0812-1000-010', 'irfan.maulana@dinas.go.id', 'Staf Administrasi/HRD', 200000],
    ];
    const insMember = db.prepare('INSERT INTO members (name,phone,email,role,salary_per_day) VALUES (?,?,?,?,?)');
    const memberIds = [];
    for (const m of members) memberIds.push(insMember.run(...m).lastInsertRowid);

    // Tugas: induk dulu kemudian anak (urut definisi sudah benar)
    for (const [code, name, parentCode, start, dur, prio, notes, pjIdx, prog] of treeRows) {
      const parentId = parentCode ? IDs[parentCode] : null;
      const durVal = dur == null ? 0 : dur;
      const r = insTask.run(projectId, '', parentId, name, start, durVal, prio, notes,
        pjIdx ? memberIds[pjIdx - 1] : null, prog || 0, 0);
      IDs[code] = r.lastInsertRowid;
    }

    // Urutan saudara + kode WBS
    const allTasks = db.prepare('SELECT id, parent_id FROM tasks WHERE project_id = ?').all(projectId);
    const kids = new Map();
    for (const t of allTasks) {
      const k = t.parent_id == null ? 0 : t.parent_id;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(t.id);
    }
    const setUpd = db.prepare('UPDATE tasks SET sort = ?, code = ? WHERE id = ?');
    const walk = (parentId, parentCode) => {
      const list = kids.get(parentId || 0) || [];
      list.forEach((id, i) => {
        const code = parentCode ? parentCode + '.' + (i + 1) : String(i + 1);
        setUpd.run(i + 1, code, id);
        walk(id, code);
      });
    };
    walk(null, '');

    // Ketergantungan (kode: tugas, pred, tipe, lag)
    const DEFS_DEP = [
      ['1.2', '1.1', 'FS', 0],
      ['1.3', '1.2', 'FS', 0],
      ['2.1', '1.3', 'FS', 0],
      ['2.2', '2.1', 'SS', 2],
      ['2.3', '2.2', 'FS', 0],
      ['3.1', '2.3', 'FS', 7],
      ['3.2', '3.1', 'SS', 10],
      ['3.3', '3.1', 'FS', 0],
      ['4.1', '3.3', 'FS', 0],
      ['4.2', '4.1', 'FS', 0],
      ['5.1', '3.2', 'SS', 10],
      ['5.2', '3.2', 'SS', 10],
      ['6.1', '3.2', 'FS', 0],
      ['6.2', '6.1', 'FS', 3],
      ['6.3', '6.1', 'FS', 0],
      ['6.4', '6.1', 'SS', 5],
      ['7.1', '1.2', 'FS', 0],
      ['7.2', '7.1', 'FS', 0],
      ['7.3', '7.1', 'FS', 0],
      ['7.4', '6.2', 'FS', 0],
      ['7.4', '7.2', 'FS', 0],
      ['8.1', '3.1', 'SS', 0],
      ['8.2', '8.1', 'FS', 0],
      ['8.3', '8.2', 'FS', 0],
      ['9.1', '7.4', 'FS', 0],
      ['9.2', '9.1', 'FS', 0],
      ['9.2', '5.1', 'FS', 0],
      ['9.2', '5.2', 'FS', 0],
      ['9.2', '6.3', 'FS', 0],
      ['9.2', '6.4', 'FS', 0],
      ['9.3', '9.2', 'FS', 0],
      ['9.3', '8.3', 'FS', 0],
      ['9.3', '7.3', 'FS', 0],
    ];
    const insDep = db.prepare('INSERT INTO deps (task_id,pred_id,type,lag) VALUES (?,?,?,?)');
    for (const [c, pc, ty, lag] of DEFS_DEP) insDep.run(IDs[c], IDs[pc], ty, lag);

    // Cuti pribadi anggota
    const insLeave = db.prepare('INSERT INTO member_leaves (member_id,start_date,end_date,notes) VALUES (?,?,?,?)');
    insLeave.run(memberIds[2], '2026-01-26', '2026-01-27', 'Acara keluarga');
    insLeave.run(memberIds[6], '2026-02-09', '2026-02-13', 'Cuti tahunan');
    insLeave.run(memberIds[5], '2026-03-03', '2026-03-04', 'Cuti tahunan');
    insLeave.run(memberIds[8], '2026-04-20', '2026-04-21', 'Cuti tahunan');

    // Penugasan (indeks sesuai daftar anggota, dimulai 0)
    const A = [
      ['1.1', [0, 2], [100, 50]],
      ['1.2', [9, 8], [50, 50]],
      ['1.3', [1, 2], [100, 50]],
      ['2.1', [2, 3], [100, 100]],
      ['2.2', [2, 4], [100, 100]], // Joko kelebihan beban: paralel dengan 2.1
      ['2.3', [4, 3], [100, 50]],
      ['3.1', [4, 3], [100, 40]],
      ['3.2', [2, 3], [100, 100]],
      ['3.3', [4, 5, 3], [100, 100, 40]], // Eko kelebihan beban: paralel dengan 5.1
      ['4.1', [1, 4], [100, 60]],
      ['4.2', [1, 3], [100, 60]],
      ['5.1', [5, 6], [100, 40]],
      ['5.2', [6, 3], [100, 30]],
      ['6.1', [7, 2, 3], [100, 50, 50]],
      ['6.2', [7], [100]],
      ['6.3', [2, 3], [100, 50]],
      ['6.4', [1, 7], [70, 40]],
      ['7.1', [8], [100]],
      ['7.2', [8, 9], [60, 40]],
      ['7.3', [8, 9], [100, 50]],
      ['7.4', [1, 2, 3], [50, 60, 60]],
      ['8.1', [9], [100]],
      ['8.2', [9, 0], [100, 50]],
      ['8.3', [9, 0], [80, 50]],
      ['9.1', [1, 2, 3], [50, 50, 50]],
      ['9.2', [0, 9], [100, 50]],
      ['9.3', [0, 9], [100, 100]],
    ];
    const insAssign = db.prepare('INSERT INTO assignments (task_id,member_id,allocation) VALUES (?,?,?)');
    for (const [code, midx, alloc] of A) {
      for (let i = 0; i < midx.length; i++) insAssign.run(IDs[code], memberIds[midx[i]], alloc[i]);
    }
  });
  tx();
  return db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
}

function getProjectOr404(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

// Bangun ulang kode WBS dan urutan saudara untuk satu proyek.
function rebuildCodes(projectId) {
  // Urut saudara mengikuti kolom `sort` (lalu id), agar pindah/geser berpengaruh pada kode WBS.
  const rows = db.prepare('SELECT id, parent_id, sort FROM tasks WHERE project_id = ? ORDER BY sort, id').all(projectId);
  const parentSet = new Set(rows.map((r) => r.parent_id).filter((v) => v != null));
  const kids = new Map();
  for (const r of rows) {
    const k = r.parent_id == null || !anyRowWithId(rows, r.parent_id) ? 0 : r.parent_id;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(r.id);
  }
  void parentSet;
  const setUpd = db.prepare('UPDATE tasks SET sort = ?, code = ? WHERE id = ?');
  const walk = (parentId, parentCode) => {
    const list = (kids.get(parentId || 0) || []);
    list.forEach((id, i) => {
      const code = parentCode ? parentCode + '.' + (i + 1) : String(i + 1);
      setUpd.run(i + 1, code, id);
      walk(id, code);
    });
  };
  walk(null, '');
}

function anyRowWithId(rows, id) {
  return rows.some((r) => r.id === id);
}

// Hapus tugas beserta seluruh keturunannya. Kembalikan daftar id yang dihapus.
function deleteTaskCascade(id) {
  const ids = [id];
  const collect = (pid) => {
    const kids = db.prepare('SELECT id FROM tasks WHERE parent_id = ?').all(pid);
    for (const k of kids) { ids.push(k.id); collect(k.id); }
  };
  collect(id);
  const del = db.prepare('DELETE FROM tasks WHERE id = ?');
  const delDeps = db.prepare('DELETE FROM deps WHERE task_id = ? OR pred_id = ?');
  const delAssign = db.prepare('DELETE FROM assignments WHERE task_id = ?');
  for (const tid of ids) {
    delDeps.run(tid, tid);
    delAssign.run(tid);
    del.run(tid);
  }
  return ids;
}

// Apakah `maybeDescendant` adalah keturunan dari `id`?
function isDescendant(maybeDescendant, id) {
  let cur = maybeDescendant;
  let guard = 0;
  while (cur != null && guard < 500) {
    if (cur === id) return true;
    const row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(cur);
    cur = row ? row.parent_id : null;
    guard++;
  }
  return false;
}

function init() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM projects').get().c;
  if (!n) reseed();
  ensureDefaultUser();
}

// Migrasi aman: buat akun admin default jika tabel user masih kosong.
// Password disimpan sebagai hash scrypt, tidak pernah teks biasa.
function ensureDefaultUser() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c > 0) return;
  const { hashPassword } = require('./password');
  db.prepare('INSERT INTO users (username, email, name, role, password_hash) VALUES (?,?,?,?,?)')
    .run('admin', 'admin@simpro.local', 'Administrator', 'admin', hashPassword('admin123'));
}

module.exports = { db, reseed, init, rebuildCodes, deleteTaskCascade, isDescendant, getProjectOr404 };
