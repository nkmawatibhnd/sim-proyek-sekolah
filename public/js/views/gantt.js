'use strict';

import { esc, fmtDate, addDays, hariNama } from '../util.js';

const COLW = { harian: 26, mingguan: 10, bulanan: 5 };
const ROW_H = 28;

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) { container.innerHTML = `<div class="callout danger">Jadwal belum tersedia.</div>`; return; }

  let scale = localStorage.getItem('simpro.ganttScale') || 'mingguan';
  const expanded = new Set(s.tasks.filter((t) => !t.is_leaf).map((t) => t.id));

  container.innerHTML = `
    <div class="card">
      <h2>Gantt Chart</h2>
      <div class="toolbar">
        <span class="cash-note">Zoom:</span>
        <select id="g-zoom">
          <option value="harian" ${scale === 'harian' ? 'selected' : ''}>Harian</option>
          <option value="mingguan" ${scale === 'mingguan' ? 'selected' : ''}>Mingguan</option>
          <option value="bulanan" ${scale === 'bulanan' ? 'selected' : ''}>Bulanan</option>
        </select>
        <span class="spacer"></span>
        <span class="cash-note">Hari ini: <b id="g-today-label"></b></span>
      </div>
      <div class="gantt-wrap">
        <div class="gantt-grid">
          <div class="gantt-left" id="g-left"></div>
          <div class="gantt-right" id="g-right"></div>
        </div>
        <div class="gantt-legend">
          <span><span class="s" style="background:#2563eb"></span>Tugas</span>
          <span><span class="s" style="background:#dc2626"></span>Tugas kritis</span>
          <span><span class="s" style="background:#334155"></span>Tugas induk (ringkasan)</span>
          <span><span class="s" style="background:#93c5fd"></span>Progres</span>
          <span><span class="s" style="background:#e2e8f0"></span>Akhir pekan / libur</span>
          <span><span class="s" style="background:transparent;border:1px dashed #dc2626"></span>Hari ini</span>
        </div>
      </div>
    </div>
    <div id="tooltip"></div>`;

  const zoomSel = container.querySelector('#g-zoom');
  zoomSel.addEventListener('change', () => { scale = zoomSel.value; localStorage.setItem('simpro.ganttScale', scale); draw(); });

  // susun baris terlihat (pohon)
  const kids = new Map();
  for (const t of s.tasks) {
    const k = t.parent_id == null ? 0 : t.parent_id;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(t);
  }
  function visibleRows() {
    const out = [];
    const walk = (pid, depth) => {
      for (const t of kids.get(pid) || []) {
        t.depth = depth;
        out.push(t);
        if (!t.is_leaf && expanded.has(t.id)) walk(t.id, depth + 1);
      }
    };
    walk(0, 0);
    return out;
  }

  const left = container.querySelector('#g-left');
  const right = container.querySelector('#g-right');
  container.querySelector('#g-today-label').textContent = todayLabel();

  function todayLabel() {
    const d = new Date();
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function draw() {
    const rows = visibleRows();
    const col = COLW[scale];
    // rentang min/max data + buffer
    const dates = [];
    for (const t of s.tasks) { if (t.start) dates.push(t.start); if (t.finish) dates.push(t.finish); }
    const start = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : new Date().toISOString().slice(0, 10);
    const finish = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : start;
    const dayFrom = addDays(start, -3);
    const dayTo = addDays(finish, 7);
    const nDays = Math.round((new Date(dayTo + 'T00:00:00Z') - new Date(dayFrom + 'T00:00:00Z')) / 86400000);
    const dayIdx = new Map();
    for (let i = 0; i < nDays; i++) dayIdx.set(addDays(dayFrom, i), i);

    const width = nDays * col;
    const height = Math.max(rows.length * ROW_H, 60) + 34;
    const today = new Date().toISOString().slice(0, 10);
    const holidays = new Map((s.holidays || []).map((h) => [h.date, h.name]));
    const workSet = new Set(s.calendarWorkdays || []);

    let svg = `<svg class="gantt-svg" width="${width}" height="${height}" style="min-width:${width}px">`;
    // kolom hari: akhir pekan & libur diarsir
    for (let i = 0; i < nDays; i++) {
      const d = addDays(dayFrom, i);
      if (!workSet.has(d)) {
        const isHol = holidays.has(d);
        svg += `<rect x="${i * col}" y="0" width="${col}" height="${height}" fill="${isHol ? '#fee2e2' : '#e6ebf2'}" opacity="0.8"/>`;
      }
    }
    // header bulan
    let mo = null, moStart = 0;
    for (let i = 0; i < nDays; i++) {
      const d = addDays(dayFrom, i);
      const ym = d.slice(0, 7);
      if (mo === null) { mo = ym; moStart = i; }
      else if (ym !== mo) {
        svg += `<text class="hdrmonth" x="${moStart * col + 3}" y="12">${bulan(ym)} ${mo.slice(0, 4)}</text>`;
        svg += `<line x1="${i * col}" y1="0" x2="${i * col}" y2="16" stroke="#cbd5e1"/>`;
        mo = ym; moStart = i;
      }
      // garis hari/minggu kecil
      svg += `<line x1="${i * col}" y1="16" x2="${i * col}" y2="${height}" stroke="${scale === 'harian' ? '#f1f5f9' : 'none'}"/>`;
    }
    svg += `<text class="hdrmonth" x="${moStart * col + 3}" y="12">${bulan(mo)} ${mo.slice(0, 4)}</text>`;
    // header tanggal (harian)
    if (scale === 'harian') {
      for (let i = 0; i < nDays; i++) {
        const d = addDays(dayFrom, i);
        if (i % 1 === 0 && nDays * col < 4000 || scale === 'harian') {
          if (workSet.has(d) || holidays.has(d)) svg += `<text class="hdrday" x="${i * col + 3}" y="25">${Number(d.slice(8))}</text>`;
        }
      }
    }
    svg += `<line x1="0" y1="28" x2="${width}" y2="28" stroke="#cbd5e1"/>`;

    // garis hari ini
    if (dayIdx.has(today)) {
      const tx = dayIdx.get(today) * col;
      svg += `<line x1="${tx}" y1="28" x2="${tx}" y2="${height}" stroke="#dc2626" stroke-width="1.6" stroke-dasharray="4 3"/>`;
      svg += `<text x="${tx + 3}" y="40" font-size="10" fill="#dc2626">Hari ini</text>`;
    }

    const taskById = new Map(s.tasks.map((t) => [t.id, t]));
    const rowAt = new Map(rows.map((t, i) => [t.id, i]));
    const tip = document.getElementById('tooltip');

    rows.forEach((t, i) => {
      const y = 34 + i * ROW_H;
      svg += `<line x1="0" y1="${34 + (i + 1) * ROW_H}" x2="${width}" y2="${34 + (i + 1) * ROW_H}" stroke="#f1f5f9"/>`;
      if (!t.start || !t.finish) return;
      const x1 = dayIdx.get(t.start) * col;
      const x2 = (dayIdx.get(t.finish) + 1) * col;
      const w = Math.max(2, x2 - x1);
      const crit = t.critical;
      if (t.is_leaf) {
        const fill = crit ? '#dc2626' : '#2563eb';
        svg += `<g class="gbar" data-task="${t.id}">
          <rect x="${x1}" y="${y + 6}" width="${w}" height="${ROW_H - 12}" rx="3" fill="${fill}" opacity="0.9">
            <title>${esc(t.name)}</title></rect>`;
        if (t.progress > 0) {
          const pw = Math.max(0, Math.min(w, w * (t.progress / 100)));
          svg += `<rect x="${x1}" y="${y + 6}" width="${pw}" height="${ROW_H - 12}" rx="3" fill="#93c5fd" opacity="0.95"/>`;
        }
        svg += `</g>`;
      } else {
        // batang ringkasan: bracket
        const yy = y + ROW_H / 2 - 3;
        svg += `<g class="gsum"><path d="M ${x1} ${yy} L ${x1} ${yy - 6} L ${x1 + w} ${yy - 6} L ${x1 + w} ${yy} L ${x1 + w - 5} ${yy + 5} L ${x1 + 5} ${yy + 5} Z" fill="#334155"><title>${esc(t.name)}</title></path></g>`;
      }
    });

    // panah ketergantungan (FS/SS), antar tugas leaf yang tampil
    const depsDrawn = [];
    for (const t of rows) {
      if (!t.deps) continue;
      for (const d of t.deps) {
        const p = taskById.get(d.pred_id);
        if (!p || !rowAt.has(t.id) || !rowAt.has(p.id) || !p.start || !t.start) continue;
        const yP = 34 + rowAt.get(p.id) * ROW_H + ROW_H / 2;
        const yT = 34 + rowAt.get(t.id) * ROW_H + ROW_H / 2;
        const crit = p.critical && t.critical;
        const color = crit ? '#dc2626' : '#94a3b8';
        if (d.type === 'FS') {
          const x1 = (dayIdx.get(p.finish) + 1) * col;
          const x2 = dayIdx.get(t.start) * col;
          depsDrawn.push(fsPath(x1, yP, x2, yT, color));
        } else {
          const x1 = dayIdx.get(p.start) * col;
          const x2 = dayIdx.get(t.start) * col;
          depsDrawn.push(ssPath(x1, yP, x2, yT, color));
        }
      }
    }
    svg += depsDrawn.join('');
    svg += '</svg>';

    right.innerHTML = svg;
    left.innerHTML = `<div style="height:28px;border-bottom:1px solid #cbd5e1;display:flex;align-items:center;padding:0 8px;font-size:12px;color:var(--muted)">Tugas (pohon WBS)</div>` +
      rows.map((t, i) => {
        const indent = t.depth;
        return `<div class="gantt-left-row ${t.is_leaf ? '' : 'is-summary'} ${t.critical && t.is_leaf ? 'is-critical' : ''}"
          data-row="${t.id}" style="padding-left:${8 + (t.depth || 0) * 16}px">
          <span class="wbs-toggle" data-tg="${t.id}" style="width:${t.is_leaf ? '12px' : 'auto'}">${t.is_leaf ? '' : (expanded.has(t.id) ? '▾' : '▸')}</span>
          <span class="g-code">${esc(t.code)}</span>
          <span style="overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</span>
        </div>`;
      }).join('');

    // sync scroll vertikal
    left.scrollTop = right.scrollTop = 0;
    right.addEventListener('scroll', () => { left.scrollTop = right.scrollTop; });
    left.addEventListener('scroll', () => { right.scrollTop = left.scrollTop; });
    // klik toggle
    container.querySelectorAll('.gantt-left-row .wbs-toggle[data-tg]').forEach((el) => {
      el.addEventListener('click', () => { const id = Number(el.dataset.tg); expanded.has(id) ? expanded.delete(id) : expanded.add(id); draw(); });
    });

    // tooltip
    right.querySelectorAll('g.gbar, g.gsum').forEach((g) => {
      g.addEventListener('mouseenter', () => {
        const t = taskById.get(Number(g.dataset.task));
        if (!t) return;
        const assignee = (t.assignees || []).map((a) => a.name).join(', ') || '—';
        tip.innerHTML = `<b>${esc(t.code)} ${esc(t.name)}</b><br/>
          Mulai: ${fmtDate(t.start)} · Selesai: ${fmtDate(t.finish)}<br/>
          Durasi: ${t.duration} hari kerja · Progres: ${t.progress}%<br/>
          PJ: ${esc(t.responsible_name || '—')} · Penugasan: ${esc(assignee)}<br/>
          Slack: ${t.slack} hari kerja ${t.slack === 0 ? '(KRITIS)' : ''}`;
        tip.style.display = 'block';
      });
      g.addEventListener('mousemove', (e) => {
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 340) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      });
      g.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  }

  draw();
}

function bulan(ym) {
  const b = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return b[Number(ym.slice(5, 7)) - 1];
}

function fsPath(x1, y1, x2, y2, color) {
  if (x2 - x1 > 14) {
    const xm = (x1 + x2) / 2;
    return `<path class="gdep" d="M ${x1} ${y1} H ${xm} V ${y2} H ${x2 - 6}" fill="none" stroke="${color}" stroke-width="1.4"/>
      <path d="M ${x2 - 6} ${y2 - 4} L ${x2} ${y2} L ${x2 - 6} ${y2 + 4} Z" fill="${color}"/>`;
  }
  return `<path class="gdep" d="M ${x1} ${y1} h 6 V ${y2 - 10} h 8 v 8 h -2" fill="none" stroke="${color}" stroke-width="1.4"/>
    <path d="M ${x1 + 10} ${y1} h 0" fill="none"/>`;
}

function ssPath(x1, y1, x2, y2, color) {
  const ymid = Math.min(y1, y2) - 8;
  return `<path class="gdep" d="M ${x1} ${y1} V ${ymid} H ${x2} V ${y2 - 4}" fill="none" stroke="${color}" stroke-width="1.4" stroke-dasharray="3 2"/>
    <path d="M ${x2 - 4} ${y2 - 4} L ${x2} ${y2} L ${x2 + 4} ${y2 - 4}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
}
