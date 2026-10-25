'use strict';

// CPM (Critical Path Method) — fungsi murni, bebas dari database & tampilan.
//
// Representasi waktu: "indeks hari kerja proyek" (posisi pada daftar hari kerja proyek sejak
// tanggal mulai). Semua pergeseran lag / slack dihitung dalam hari kerja.

const cal = require('./calendar');

const HORIZON = 1500; // horizon hari kerja (± 6 tahun)

function computeSchedule(input, options) {
  options = options || {};
  const delays = options.delays || {}; // { taskId: keterlambatan (hari kerja) } untuk simulasi

  const project = input.project;
  if (!project || !cal.isValidYmd(project.start_date)) {
    throw new Error('Proyek belum memiliki tanggal mulai yang valid.');
  }

  const holidaySet = new Set((input.holidays || []).map((h) => h.date || h));
  const flags = cal.workdaySet(
    parseWorkdays(project.workdays) // default Senin–Jumat
  );
  const kalender = cal.buildCalendar(project.start_date, HORIZON, flags, holidaySet);
  const idxOf = (d) => (kalender.index.has(d) ? kalender.index.get(d) : 0);

  const tasks = input.tasks || [];
  const byId = new Map(tasks.map((t) => [t.id, Object.assign({}, t)]));
  const childrenOf = new Map();
  for (const t of tasks) {
    if (t.parent_id != null && byId.has(t.parent_id)) {
      if (!childrenOf.has(t.parent_id)) childrenOf.set(t.parent_id, []);
      childrenOf.get(t.parent_id).push(t.id);
    }
  }
  const isLeaf = (id) => !childrenOf.has(id);

  const leaveSets = cal.leavesByMember(input.leaves || []);
  const assignments = input.assignments || [];
  const membersByTask = new Map();
  for (const a of assignments) {
    if (!membersByTask.has(a.task_id)) membersByTask.set(a.task_id, []);
    membersByTask.get(a.task_id).push(a.member_id);
  }

  const deps = (input.deps || [])
    .filter((d) => byId.has(d.task_id) && byId.has(d.pred_id))
    .map((d) => ({ task_id: d.task_id, pred_id: d.pred_id, type: d.type === 'SS' ? 'SS' : 'FS', lag: Number(d.lag) || 0 }));
  const predsOf = new Map();
  const succsOf = new Map();
  for (const d of deps) {
    if (!predsOf.has(d.task_id)) predsOf.set(d.task_id, []);
    predsOf.get(d.task_id).push(d);
    if (!succsOf.has(d.pred_id)) succsOf.set(d.pred_id, []);
    succsOf.get(d.pred_id).push(d);
  }

  const leafIds = tasks.filter((t) => isLeaf(t.id)).map((t) => t.id);

  // ---- Urut topologis (Kahn) pada tugas leaf; error bila melingkar ----
  const indeg = new Map();
  for (const id of leafIds) indeg.set(id, 0);
  for (const d of deps) {
    if (isLeaf(d.task_id) && isLeaf(d.pred_id)) indeg.set(d.task_id, (indeg.get(d.task_id) || 0) + 1);
  }
  const queue = leafIds.filter((id) => (indeg.get(id) || 0) === 0);
  const topo = [];
  const indegWork = new Map(indeg);
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    for (const s of succsOf.get(id) || []) {
      if (!isLeaf(s.task_id)) continue;
      const v = indegWork.get(s.task_id) - 1;
      indegWork.set(s.task_id, v);
      if (v === 0) queue.push(s.task_id);
    }
  }
  if (topo.length !== leafIds.length) {
    throw new Error('Terdapat ketergantungan melingkar antar tugas; periksa predecessor.');
  }

  // ---- Daftar hari kerja tersedia per tugas leaf (kalender proyek minus cuti anggota) ----
  const avail = new Map();
  const availPosOfIdx = new Map(); // indeks hari kerja proyek -> posisi dalam avail
  for (const id of leafIds) {
    const t = byId.get(id);
    const memberIds = membersByTask.get(id) || [];
    const list = [];
    for (let i = 0; i < kalender.dates.length; i++) {
      const d = kalender.dates[i];
      let block = false;
      for (const m of memberIds) {
        const set = leaveSets.get(m);
        if (set && set.has(d)) { block = true; break; }
      }
      if (!block) list.push(i);
    }
    if (!list.length) {
      throw new Error('Semua hari kerja tugas "' + t.name + '" tertutup cuti anggota yang ditugaskan.');
    }
    avail.set(id, list);
  }

  const posOf = (id, idx) => {
    const p = cal.firstGE(avail.get(id), idx);
    return p === -1 ? avail.get(id).length - 1 : p;
  };

  // ---- Forward pass ----
  const ES = new Map(); // indeks hari kerja proyek
  const EF = new Map();
  for (const id of topo) {
    const t = byId.get(id);
    const a = avail.get(id);
    let baseIdx = 0;
    const preds = predsOf.get(id) || [];
    if (preds.length) {
      for (const d of preds) {
        if (!isLeaf(d.pred_id)) continue;
        // FS: mulai >= EF pred + lag + 1 ; SS: mulai >= ES pred + lag
        const constraint = d.type === 'SS' ? ES.get(d.pred_id) + d.lag : EF.get(d.pred_id) + d.lag + 1;
        baseIdx = Math.max(baseIdx, constraint);
      }
    } else if (t.start_date && kalender.index.has(t.start_date)) {
      baseIdx = kalender.index.get(t.start_date);
    }
    const delay = Number(delays[id]) || 0;
    if (delay) baseIdx = baseIdx + delay;
    const pos = cal.firstAvailPosGE(a, baseIdx);
    const dur = Math.max(1, Math.round(Number(t.duration) || 1));
    const endPos = Math.min(pos + dur - 1, a.length - 1);
    ES.set(id, a[pos]);
    EF.set(id, a[endPos]);
  }

  // ---- Backward pass ----
  const LS = new Map();
  const LF = new Map();
  let projectFinish = 0;
  for (const id of leafIds) projectFinish = Math.max(projectFinish, EF.get(id));

  for (let k = topo.length - 1; k >= 0; k--) {
    const id = topo[k];
    const t = byId.get(id);
    const a = avail.get(id);
    const dur = Math.max(1, Math.round(Number(t.duration) || 1));
    // tanpa penerus: EF terakhir sebaiknya tidak melebihi akhir proyek
    let pos = -1;
    for (let i = Math.max(0, a.length - dur); i >= 0; i--) {
      if (a[Math.min(i + dur - 1, a.length - 1)] <= projectFinish) { pos = i; break; }
    }
    if (pos === -1) pos = 0;
    for (const s of succsOf.get(id) || []) {
      if (!isLeaf(s.task_id) || !LS.has(s.task_id)) continue;
      let c;
      if (s.type === 'FS') {
        // kendala pada LF pred: LF <= LS(succ) - lag - 1
        c = LS.get(s.task_id) - s.lag - 1;
        let p = -1;
        for (let i = a.length - dur; i >= 0; i--) {
          if (a[i + dur - 1] <= c) { p = i; break; }
        }
        if (p !== -1) pos = Math.min(pos, p);
      } else {
        // SS: kendala pada LS pred: LS <= LS(succ) - lag
        c = LS.get(s.task_id) - s.lag;
        const p = cal.lastAvailPosLE(a, c);
        if (p !== -1) pos = Math.min(pos, p);
      }
    }
    if (pos < 0) pos = 0;
    const endPos = Math.min(pos + dur - 1, a.length - 1);
    LS.set(id, a[pos]);
    LF.set(id, a[endPos]);
  }

  // Slack (dalam posisi hari-kerja tugas): selisih posisi LS vs ES.
  const slack = new Map();
  for (const id of leafIds) {
    const a = avail.get(id);
    const pES = cal.firstGE(a, ES.get(id));
    const pLS = cal.firstGE(a, LS.get(id));
    slack.set(id, Math.max(0, pLS - pES));
  }

  // ---- Tugas induk (summary): agregat dari anak-anak, bottom-up ----
  // progress berbobot durasi juga dihitung di sini.
  const progressOf = new Map();
  const durationOf = new Map();
  const computeSummary = (id) => {
    if (progressOf.has(id)) return;
    const kids = childrenOf.get(id) || [];
    for (const k of kids) if (!isLeaf(k)) computeSummary(k);
    if (!kids.length) {
      const t = byId.get(id);
      const pr = Math.min(100, Math.max(0, Number(t.progress) || 0));
      progressOf.set(id, isLeaf(id) ? pr : 0);
      durationOf.set(id, Math.max(1, Math.round(Number(t.duration) || 1)));
      return;
    }
    let wsum = 0, psum = 0;
    for (const k of kids) {
      const w = durationOf.get(k) || 1;
      wsum += w;
      psum += (progressOf.get(k) || 0) * w;
    }
    progressOf.set(id, wsum ? Math.round((psum / wsum) * 100) / 100 : 0);
    durationOf.set(id, wsum);
  };
  for (const t of tasks) computeSummary(t.id);

  const aggSummary = (id) => {
    const kids = childrenOf.get(id) || [];
    let es = Infinity, ef = -1, ls = Infinity, lf = -1;
    for (const k of kids) {
      es = Math.min(es, ES.has(k) ? ES.get(k) : LS.has(k) ? LS.get(k) : Infinity);
      ef = Math.max(ef, EF.has(k) ? EF.get(k) : -1);
      ls = Math.min(ls, LS.has(k) ? LS.get(k) : Infinity);
      lf = Math.max(lf, LF.has(k) ? LF.get(k) : -1);
    }
    if (kids.length && isFinite(es)) {
      return { es, ef, ls, lf };
    }
    return null;
  };

  // Susun hasil
  const out = [];
  for (const t of tasks) {
    const leaf = isLeaf(t.id);
    const row = {
      id: t.id,
      code: t.code,
      name: t.name,
      parent_id: t.parent_id,
      is_leaf: leaf,
      duration: Number(t.duration) || 0,        // untuk leaf: hari kerja; untuk induk: hari kerja anak-anak
      start_date_manual: t.start_date || null,
      priority: t.priority,
      notes: t.notes || '',
      responsible_id: t.responsible_id,
      progress_input: Number(t.progress) || 0,
      progress: progressOf.get(t.id) || 0,
    };
    if (leaf) {
      const a = avail.get(t.id);
      row.es_idx = ES.get(t.id);
      row.ef_idx = EF.get(t.id);
      row.ls_idx = LS.get(t.id);
      row.lf_idx = LF.get(t.id);
      row.es = kalender.dates[ES.get(t.id)];
      row.ef = kalender.dates[EF.get(t.id)];
      row.ls = kalender.dates[LS.get(t.id)];
      row.lf = kalender.dates[LF.get(t.id)];
      row.start = row.es;
      row.finish = row.ef;
      row.slack = slack.get(t.id);
      row.critical = row.slack <= 0;
      row.work_dates = a.slice(cal.firstGE(a, ES.get(t.id)), cal.firstGE(a, EF.get(t.id)) + 1);
      row.avail_count = a.length;
    } else {
      const agg = aggSummary(t.id);
      if (agg) {
        row.es_idx = agg.es; row.ef_idx = agg.ef; row.ls_idx = agg.ls; row.lf_idx = agg.lf;
        row.es = kalender.dates[agg.es];
        row.ef = kalender.dates[agg.ef];
        row.ls = kalender.dates[agg.ls];
        row.lf = kalender.dates[agg.lf];
        row.slack = Math.max(0, agg.ls - agg.es);
        row.critical = row.slack <= 0;
      } else {
        row.es = null; row.ef = null; row.ls = null; row.lf = null;
        row.slack = null; row.critical = false;
      }
      row.duration = durationOf.get(t.id) || 0; // durasi induk = total durasi anak
      row.start = row.es;
      row.finish = row.ef;
    }
    row.deps = (predsOf.get(t.id) || []).map((d) => ({
      pred_id: d.pred_id,
      pred_code: byId.get(d.pred_id).code,
      type: d.type,
      lag: d.lag,
    }));
    row.assignees = (assignments || [])
      .filter((x) => x.task_id === t.id)
      .map((x) => ({ member_id: x.member_id, allocation: Number(x.allocation) || 100 }));
    out.push(row);
  }

  // projectDuration = jumlah hari kerja proyek dari awal sampai hari terakhir proyek.
  const projectStart = kalender.dates[0];
  const finishDate = kalender.dates[projectFinish] || projectStart;
  const projectDuration = projectFinish + 1;

  // ---- Jalur kritis (rangkaian tugas kritis) ----
  const chains = buildCriticalChains(leafIds, predsOf, succsOf, slack);

  return {
    tasks: out,
    byId,
    projectStart,
    projectFinish: finishDate,
    projectDuration,
    criticalChains: chains,
    calendar: {
      workdays: kalender.dates, // daftar tanggal hari kerja (indeks = posisi)
      holidays: Array.from(holidaySet).sort(),
      flags: Array.from(flags),
    },
  };
}

function parseWorkdays(workdays) {
  if (typeof workdays === 'string' && workdays.trim()) {
    return Array.from(workdays.trim()).map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
  }
  if (Array.isArray(workdays) && workdays.length) return workdays.map(Number);
  return [1, 2, 3, 4, 5]; // Senin–Jumat
}

// Jalur kritis: dari setiap tugas kritis tanpa penerus kritis, telusuri mundur lewat
// predecessor kritis. Hasil: array of array of id, urut dari awal ke akhir.
function buildCriticalChains(leafIds, predsOf, succsOf, slack) {
  const crit = new Set(leafIds.filter((id) => (slack.get(id) || 0) === 0));
  void predsOf;
  const hasCritSucc = (id) => (succsOf.get(id) || []).some((s) => crit.has(s.task_id));
  const chains = [];
  const MAX = 30;
  for (const end of crit) {
    if (hasCritSucc(end)) continue;
    // telusuri mundur, DFS dengan batas
    const paths = [[end]];
    let result = null;
    while (paths.length && !result) {
      const p = paths.shift();
      const head = p[0];
      const critPreds = (predsOf.get(head) || []).map((d) => d.pred_id).filter((x) => crit.has(x));
      if (!critPreds.length) {
        result = (result || []).concat([p]);
        continue;
      }
      for (const pr of critPreds) {
        if (p.includes(pr)) continue; // pengaman
        paths.push([pr].concat(p));
      }
    }
    for (const p of (result || [[end]])) chains.push(p);
    if (chains.length > MAX) break;
  }
  if (!chains.length && crit.size) {
    const any = Array.from(crit)[0];
    chains.push([any]);
  }
  return chains;
}

module.exports = { computeSchedule };
