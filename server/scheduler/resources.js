'use strict';

// Perhitungan sumber daya & biaya dari hasil jadwal CPM — fungsi murni.

function toNum(x) { const n = Number(x); return isFinite(n) ? n : 0; }

// schedule: hasil computeSchedule (tasks berisi work_dates & assignees untuk leaf)
// members : baris anggota; leaves: baris cuti [{member_id,start_date,end_date}]
// filter  : { member_id, role, date_from, date_to } (opsional)
function analyzeResources(schedule, members, leaves, filter) {
  filter = filter || {};
  const memberById = new Map(members.map((m) => [m.id, m]));
  const tasks = schedule.tasks.filter((t) => t.is_leaf && t.work_dates && t.work_dates.length);
  const pairs = []; // {date, member_id, task_id, allocation}

  for (const t of tasks) {
    if (!t.assignees || !t.assignees.length) continue;
    for (const d of t.work_dates) {
      if (filter.date_from && d < filter.date_from) continue;
      if (filter.date_to && d > filter.date_to) continue;
      for (const a of t.assignees) {
        pairs.push({ date: d, member_id: a.member_id, task_id: t.id, allocation: toNum(a.allocation) });
      }
    }
  }

  // Agregasi beban per anggota per tanggal
  const dayLoad = new Map(); // memberId -> Map(date -> {pct, tasks:Map})
  for (const p of pairs) {
    if (filter.member_id && p.member_id !== filter.member_id) continue;
    if (filter.role && memberById.get(p.member_id) && memberById.get(p.member_id).role !== filter.role) continue;
    if (!dayLoad.has(p.member_id)) dayLoad.set(p.member_id, new Map());
    const m = dayLoad.get(p.member_id);
    if (!m.has(p.date)) m.set(p.date, { pct: 0, tasks: new Map() });
    const cell = m.get(p.date);
    cell.pct += p.allocation;
    const tinfo = schedule.byId.get(p.task_id);
    cell.tasks.set(p.task_id, { code: tinfo ? tinfo.code : '?', name: tinfo ? tinfo.name : '' });
  }

  // Rentang tanggal grafik
  const L8H = 8;
  let dFrom = filter.date_from, dTo = filter.date_to;
  dFrom = dFrom || schedule.projectStart;
  dTo = dTo || schedule.projectFinish;
  const daySet = new Set(schedule.calendar.workdays);
  const chartDays = [];
  let cur = dFrom;
  let guard = 0;
  while (cur <= dTo && guard < 1500) {
    if (daySet.has(cur)) chartDays.push(cur);
    const d = new Date(cur + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
    guard++;
  }

  // Peringatan kelebihan beban
  const overalerts = [];
  for (const [mid, m] of dayLoad) {
    for (const [date, cell] of m) {
      if (cell.pct > 100) {
        overalerts.push({
          member_id: mid,
          member: memberById.get(mid) ? memberById.get(mid).name : '#' + mid,
          date,
          load: Math.round(cell.pct),
          tasks: Array.from(cell.tasks.values()),
        });
      }
    }
  }
  overalerts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.member.localeCompare(b.member, 'id')));

  // Ringkasan per anggota
  const summary = [];
  for (const mem of members) {
    if (filter.member_id && mem.id !== filter.member_id) continue;
    if (filter.role && mem.role !== filter.role) continue;
    const m = dayLoad.get(mem.id) || new Map();
    let totalPct = 0, over = false;
    for (const [date, cell] of m) totalPct += cell.pct;
    for (const [, cell] of m) if (cell.pct > 100) over = true;
    const allocDays = m.size;
    const leaveDays = (leaves || []).filter((l) => l.member_id === mem.id).reduce((acc, l) => {
      // hitung hari cuti dalam rentang filter (inklusif)
      let c = 0;
      let s = l.start_date;
      const e = l.end_date || l.start_date;
      let g = 0;
      while (s <= e && g < 2000) {
        if ((!filter.date_from || s >= filter.date_from) && (!filter.date_to || s <= filter.date_to)) c++;
        const d = new Date(s + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        s = d.toISOString().slice(0, 10);
        g++;
      }
      return acc + c;
    }, 0);
    const avg = allocDays ? totalPct / allocDays : 0;
    const status = over ? 'Kelebihan Beban' : (allocDays === 0 ? 'Belum Ditugaskan' : (avg < 50 ? 'Kurang Dimanfaatkan' : 'Normal'));
    // Biaya: gaji/hari x hari teralokasi (proporsional alokasi)
    const cost = Math.round((toNum(mem.salary_per_day) * totalPct) / 100);
    summary.push({
      member_id: mem.id,
      name: mem.name,
      role: mem.role,
      allocated_days: allocDays,
      leave_days: leaveDays,
      avg_load: Math.round(avg),
      status,
      cost,
    });
  }

  // Data grafik histogram (harian / mingguan)
  const weekKey = (d) => {
    const dt = new Date(d + 'T00:00:00Z');
    const day = dt.getUTCDay(); // 0 Minggu
    const start = new Date(dt);
    start.setUTCDate(dt.getUTCDate() - ((day + 6) % 7)); // Senin
    return start.toISOString().slice(0, 10);
  };

  const histogram = (period) => {
    const labels = [];
    const keyList = [];
    const seen = new Set();
    for (const d of chartDays) {
      const key = period === 'mingguan' ? weekKey(d) : d;
      if (!seen.has(key)) { seen.add(key); keyList.push(key); labels.push(key); }
    }
    const series = new Map(); // memberId -> { key -> pct }
    for (const [mid, m] of dayLoad) {
      const s = new Map();
      for (const [date, cell] of m) {
        const key = period === 'mingguan' ? weekKey(date) : date;
        s.set(key, (s.get(key) || 0) + cell.pct);
      }
      series.set(mid, s);
    }
    return { labels: keyList, series };
  };

  return {
    filter_range: { from: dFrom, to: dTo },
    overallocations: overalerts,
    summary,
    chart_daily: histogram('harian'),
    chart_weekly: histogram('mingguan'),
    hours_per_day: L8H,
    total_cost: summary.reduce((a, s) => a + s.cost, 0),
  };
}

module.exports = { analyzeResources };
