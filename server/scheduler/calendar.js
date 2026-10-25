'use strict';

// Kalender kerja — fungsi murni (tanpa I/O) agar mudah diuji.
// Semua tanggal dalam format string 'YYYY-MM-DD'.

const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function toDate(y) {
  return new Date(y + 'T00:00:00Z');
}

function toYmd(d) {
  return d.toISOString().slice(0, 10);
}

function isValidYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toDate(s).getTime());
}

function addDays(y, n) {
  const d = toDate(y);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
}

// 0 = Minggu .. 6 = Sabtu (sesuai getUTCDay)
function weekdayOf(y) {
  return toDate(y).getUTCDay();
}

function namaHari(y) {
  return HARI_ID[weekdayOf(y)];
}

// workdays: array 0..6 hari kerja. Kembalikan Set.
function workdaySet(workdays) {
  return new Set((workdays || []).map(Number));
}

// Daftar rentang tanggal (inklusif) untuk libur.
function rangeInclusive(a, b) {
  const out = [];
  if (!isValidYmd(a) || !isValidYmd(b)) return out;
  let cur = a;
  let guard = 0;
  while (cur <= b && guard < 20000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

// Set tanggal libur dari daftar baris cuti/libur [{start_date,end_date}]
function expandRanges(rows) {
  const set = new Set();
  for (const r of rows) {
    const end = r.end_date || r.start_date;
    for (const d of rangeInclusive(r.start_date, end)) set.add(d);
  }
  return set;
}

// Map memberId -> Set tanggal cuti
function leavesByMember(leaveRows) {
  const map = new Map();
  for (const r of leaveRows || []) {
    if (!map.has(r.member_id)) map.set(r.member_id, new Set());
    const end = r.end_date || r.start_date;
    for (const d of rangeInclusive(r.start_date, end)) map.get(r.member_id).add(d);
  }
  return map;
}

// Bangkitkan daftar hari kerja proyek: mulai dari startYmd, panjang `count` hari kerja,
// melewati hari non-kerja (akhir pekan) dan tanggal libur.
function generateWorkdays(startYmd, count, flags, holidays) {
  const out = [];
  let d = startYmd;
  let guard = 0;
  const limit = (count || 1) * 20 + 100; // pengaman
  while (out.length < count && guard < limit) {
    if (flags.has(weekdayOf(d)) && !holidays.has(d)) out.push(d);
    d = addDays(d, 1);
    guard++;
  }
  return out;
}

// Kalender lengkap proyek: array hari kerja + indeks pencarian tanggal.
function buildCalendar(startYmd, horizonWorkdays, flags, holidaySet) {
  const dates = generateWorkdays(startYmd, horizonWorkdays, flags, holidaySet);
  const index = new Map();
  dates.forEach((d, i) => index.set(d, i));
  return { dates, index };
}

// Binary search: posisi elemen pertama >= v pada array terurut, atau -1.
function firstGE(arr, v) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] >= v) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  return ans;
}

// Binary search: posisi elemen terakhir <= v pada array terurut, atau -1.
function lastLE(arr, v) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

// Posisi pertama pada array terurut dengan nilai >= v (untuk daftar indeks hari).
function firstAvailPosGE(avail, v) {
  return firstGE(avail, v);
}

// Posisi terakhir pada array terurut dengan nilai <= v.
function lastAvailPosLE(avail, v) {
  return lastLE(avail, v);
}

module.exports = {
  HARI_ID,
  toDate,
  toYmd,
  isValidYmd,
  addDays,
  weekdayOf,
  namaHari,
  workdaySet,
  rangeInclusive,
  expandRanges,
  leavesByMember,
  generateWorkdays,
  buildCalendar,
  firstGE,
  lastLE,
  firstAvailPosGE,
  lastAvailPosLE,
};
