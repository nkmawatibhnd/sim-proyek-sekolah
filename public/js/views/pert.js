'use strict';

import { esc, fmtDate, openModal } from '../util.js';

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) { container.innerHTML = `<div class="callout danger">Jadwal belum tersedia.</div>`; return; }

  const leaves = s.tasks.filter((t) => t.is_leaf);
  const byId = new Map(leaves.map((t) => [t.id, t]));
  const succs = new Map(); // pred_id -> [{task_id, type, lag}]
  for (const t of leaves) {
    for (const d of t.deps || []) {
      if (!succs.has(d.pred_id)) succs.set(d.pred_id, []);
      succs.get(d.pred_id).push({ task_id: t.id, type: d.type, lag: d.lag, code: t.code });
    }
  }

  // Node Mulai/Selesai
  const START = '_START_', FINISH = '_FINISH_';
  const sources = leaves.filter((t) => !(t.deps || []).length);
  const sinks = leaves.filter((t) => !(succs.get(t.id) || []).length);
  const edges = [];
  for (const t of sources) edges.push({ from: START, to: t.id, type: 'FS', lag: 0 });
  for (const t of leaves) {
    for (const d of succs.get(t.id) || []) edges.push({ from: t.id, to: d.task_id, type: d.type, lag: d.lag });
  }
  for (const t of sinks) edges.push({ from: t.id, to: FINISH, type: 'FS', lag: 0 });

  // level = panjang jalur terpanjang dari START
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const level = new Map([[START, 0]]);
  const queue = [START];
  while (queue.length) {
    const cur = queue.shift();
    const lv = level.get(cur) || 0;
    for (const nxt of adj.get(cur) || []) {
      if ((level.get(nxt) ?? -1) < lv + 1) { level.set(nxt, lv + 1); if (!queue.includes(nxt)) queue.push(nxt); }
    }
  }
  // susun baris per level
  const byLevel = new Map();
  for (const [id, lv] of level) {
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(id);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const HORIZONTALS = 220, NODE_W = 150, NODE_H = 74, VGAP = 26;
  const pos = new Map();
  let maxRows = 0;
  for (const lv of levels) maxRows = Math.max(maxRows, byLevel.get(lv).length);
  const height = levels.length ? maxRows * (NODE_H + VGAP) + 80 : 400;
  const width = levels.length * HORIZONTALS + NODE_W + 60;
  levels.forEach((lv) => {
    const list = byLevel.get(lv);
    const totalH = list.length * (NODE_H + VGAP);
    const y0 = (height - totalH) / 2;
    list.forEach((id, i) => pos.set(id, { x: 20 + lv * HORIZONTALS, y: y0 + i * (NODE_H + VGAP) }));
  });
  if (!pos.has(START)) pos.set(START, { x: 20, y: (height - NODE_H) / 2 });
  if (!pos.has(FINISH)) pos.set(FINISH, { x: 20 + (levels.length - 1) * HORIZONTALS, y: (height - NODE_H) / 2 });

  let scale = 1, tx = 0, ty = 0;
  const nodeLabel = (id) => {
    if (id === START) return { code: 'MULAI', name: '', isVirtual: true };
    if (id === FINISH) return { code: 'SELESAI', name: '', isVirtual: true };
    return { code: id.code, name: id.name, task: id, isVirtual: false };
  };

  const nodeSVG = (id) => {
    const p = pos.get(id);
    const meta = nodeLabel(id === START || id === FINISH ? id : byId.get(id));
    const isCrit = !meta.isVirtual && meta.task.critical;
    const fill = id === START || id === FINISH ? '#1e293b' : (isCrit ? '#fee2e2' : '#ffffff');
    const stroke = isCrit ? '#dc2626' : (id === START || id === FINISH ? '#0f172a' : '#94a3b8');
    const ink = id === START || id === FINISH ? '#fff' : '#0f172a';
    let body;
    if (meta.isVirtual) {
      body = `<text class="t b" x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle" fill="${ink}">${meta.code}</text>`;
    } else {
      const t = meta.task;
      const nm = t.name.length > 17 ? t.name.slice(0, 16) + '…' : t.name;
      body = `
        <text class="t b ${isCrit ? 'c' : ''}" x="${p.x + 10}" y="${p.y + 16}">${esc(t.code)} ${esc(nm)}</text>
        <text class="t" x="${p.x + 10}" y="${p.y + 31}">Dur: ${t.duration} hkr</text>
        <text class="t" x="${p.x + 10}" y="${p.y + 46}">ES ${esc(t.es || '-')} EF ${esc(t.ef || '-')}</text>
        <text class="t" x="${p.x + 10}" y="${p.y + 61}">LS ${esc(t.ls || '-')} LF ${esc(t.lf || '-')}</text>
        <text class="t ${t.slack === 0 ? 'c' : ''}" x="${p.x + 10}" y="${p.y + NODE_H - 6}">Slack: ${t.slack} hari</text>`;
    }
    return `<g class="pert-node ${isCrit ? 'critical' : ''}" data-node="${id}" style="cursor:${meta.isVirtual ? 'default' : 'pointer'}">
      <rect class="node" x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${isCrit ? 2 : 1.4}"/>
      ${body}</g>`;
  };

  const edgeSVG = (e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    const x2 = b.x, y2 = b.y + NODE_H / 2;
    const critEdge = (() => {
      const f = byId.get(e.from), t = byId.get(e.to);
      return f && t && f.critical && t.critical;
    })();
    const color = critEdge ? '#dc2626' : '#94a3b8';
    const mx = (x1 + x2) / 2;
    const path = Math.abs(y2 - y1) < 30
      ? `M ${x1} ${y1} H ${x2 - 8}`
      : `M ${x1} ${y1} h 9 V ${y2} H ${x2 - 8}`;
    const arrow = `M ${x2 - 8} ${y2 - 4} L ${x2} ${y2} L ${x2 - 8} ${y2 + 4} Z`;
    const label = (e.from === START || e.to === FINISH) ? '' :
      `${e.type}${e.lag ? (e.lag > 0 ? '+' : '') + e.lag : ''}`;
    const showLabel = label; // FS/SS + lag selalu ditampilkan pada panah riil
    const lblX = y1 === y2 ? mx : mx;
    const lblY = Math.min(y1, y2) - 6;
    return `${label ? `<text class="pert-elbl ${critEdge ? 'crit' : ''}" x="${lblX}" y="${lblY}" text-anchor="middle">${esc(label)}</text>` : ''}
      <path class="pert-edge ${critEdge ? 'crit' : ''}" d="${path}"/>
      <path d="${arrow}" fill="${color}"/>`;
  };

  container.innerHTML = `
    <div class="card">
      <h2>PERT / Network Diagram</h2>
      <p class="sub">Tahan mouse untuk menggeser (pan), roda mouse / tombol di bawah untuk zoom. Klik node tugas untuk melihat detail.</p>
      <div class="pert-tools">
        <button class="btn sm" id="p-zin">＋ Perbesar</button>
        <button class="btn sm" id="p-zout">－ Perkecil</button>
        <button class="btn sm" id="p-reset">Basis 1:1</button>
        <span class="cash-note">Node merah = jalur kritis</span>
      </div>
      <div class="pert-stage" id="p-stage"></div>
    </div>`;

  const stage = container.querySelector('#p-stage');
  let svgEl;
  function draw() {
    const svg = `<svg class="pert-svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" style="min-width:${width}px">
      <g transform="translate(${tx},${ty})">
        ${edges.map(edgeSVG).join('')}
        ${levels.flatMap((lv) => byLevel.get(lv)).map(nodeSVG).join('')}
        ${nodeSVG(START)}${nodeSVG(FINISH)}
      </g></svg>`;
    stage.innerHTML = svg;
    svgEl = stage.querySelector('svg');
    bindNodes();
  }

  // pan & zoom dilekatkan sekali pada stage
  let dragging = false, sx = 0, sy = 0;
  stage.addEventListener('mousedown', (e) => {
    if (e.target.closest('.pert-node')) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    stage.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    tx += (e.clientX - sx) / scale;
    ty += (e.clientY - sy) / scale;
    sx = e.clientX; sy = e.clientY;
    const svgNow = stage.querySelector('svg');
    const g = svgNow && svgNow.querySelector('g');
    if (g) g.setAttribute('transform', `translate(${tx},${ty})`);
  });
  window.addEventListener('mouseup', () => { dragging = false; stage.style.cursor = 'grab'; });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    setScale(scale * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });

  function setScale(v) {
    scale = Math.min(2.5, Math.max(0.35, v));
    draw();
  }

  container.querySelector('#p-zin').addEventListener('click', () => setScale(scale * 1.15));
  container.querySelector('#p-zout').addEventListener('click', () => setScale(scale * 0.87));
  container.querySelector('#p-reset').addEventListener('click', () => { scale = 1; tx = 0; ty = 0; draw(); });

  function bindNodes() {
    stage.querySelectorAll('g.pert-node').forEach((g) => {
      const id = g.dataset.node;
      if (id === START || id === FINISH) return;
      g.addEventListener('click', () => {
        const t = byId.get(id);
        if (!t) return;
        taskDetail(t);
      });
    });
  }

  function taskDetail(t) {
    const assigns = (t.assignees || []).map((a) => `${esc(a.name)} (${a.allocation}%)`).join(', ') || '—';
    const detail = openModal('Detail Tugas: ' + t.code + ' ' + t.name, `
      <table class="table"><tbody>
        <tr><td>Tanggal mulai (ES)</td><td><b>${fmtDate(t.es)}</b></td></tr>
        <tr><td>Tanggal selesai (EF)</td><td><b>${fmtDate(t.ef)}</b></td></tr>
        <tr><td>LS (Latest Start)</td><td>${fmtDate(t.ls)}</td></tr>
        <tr><td>LF (Latest Finish)</td><td>${fmtDate(t.lf)}</td></tr>
        <tr><td>Durasi</td><td>${t.duration} hari kerja</td></tr>
        <tr><td>Total float / slack</td><td><b class="${t.slack === 0 ? '' : ''}" style="color:${t.slack === 0 ? 'var(--danger)' : 'inherit'}">${t.slack} hari kerja ${t.slack === 0 ? '— KRITIS' : ''}</b></td></tr>
        <tr><td>Predecessor</td><td>${esc(t.deps_text || '—')}</td></tr>
        <tr><td>Penanggung jawab</td><td>${esc(t.responsible_name || '—')}</td></tr>
        <tr><td>Penugasan</td><td>${assigns}</td></tr>
        <tr><td>Progres</td><td>${t.progress}%</td></tr>
        <tr><td>Prioritas</td><td>${esc(t.priority)}</td></tr>
      </tbody></table>
      <p class="cash-note">Ubah data tugas di menu <b>Tugas (WBS)</b> atau <b>Ketergantungan</b>.</p>`);
    void detail;
  }

  draw();
}
