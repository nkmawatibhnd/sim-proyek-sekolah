'use strict';

import { get, esc, fmtDate, rupiah, notifyError } from '../util.js';

let charts = [];

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) { container.innerHTML = `<div class="callout danger">Jadwal belum tersedia.</div>`; return; }
  charts.forEach((c) => { try { c.destroy(); } catch (e) { /* noop */ } });
  charts = [];
  if (typeof Chart === 'undefined') {
    container.innerHTML = '<div class="callout warn">Chart.js gagal dimuat (butuh koneksi internet untuk CDN). Sisa analisis tetap tersedia di tabel di bawah.</div>';
  }

  const roles = [...new Set(state.members.map((m) => m.role))].sort((a, b) => a.localeCompare(b, 'id'));
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="card">
      <h2>Resource Histogram & Estimasi Biaya</h2>
      <div class="toolbar">
        <label class="f" style="margin:0">Periode</label>
        <select id="r-period"><option value="harian">Harian</option><option value="mingguan" selected>Mingguan</option></select>
        <label class="f" style="margin:0">Satuan</label>
        <select id="r-unit"><option value="pct">% Alokasi</option><option value="jam">Jam (8 jam/hari)</option></select>
        <label class="f" style="margin:0">Peran</label>
        <select id="r-role"><option value="">Semua peran</option>${roles.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
        <label class="f" style="margin:0">Anggota</label>
        <select id="r-member"><option value="">Semua anggota</option>${state.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <label class="f" style="margin:0">Dari</label>
        <input id="rf-from" type="date" />
        <label class="f" style="margin:0">Sampai</label>
        <input id="rf-to" type="date" />
        <button class="btn sm primary" id="r-apply">Terapkan Filter</button>
      </div>
      <div class="grid2" style="grid-template-columns: 2fr 1fr">
        <div class="card" style="margin:0"><h3 style="margin:2px 0 8px;font-size:13.5px">Beban Kerja per Periode</h3><div class="chart-box"><canvas id="c-hist"></canvas></div></div>
        <div class="card" style="margin:0"><h3 style="margin:2px 0 8px;font-size:13.5px">Biaya per Anggota</h3><div class="chart-box"><canvas id="c-cost"></canvas></div></div>
      </div>
      <div id="r-warn"></div>
      <h3 style="margin:14px 0 8px;font-size:13.5px">Ringkasan per Anggota</h3>
      <div style="overflow-x:auto"><table class="table" id="r-summary"></table></div>
      <h3 style="margin:14px 0 8px;font-size:13.5px">Biaya per Tugas</h3>
      <div style="overflow-x:auto"><table class="table" id="r-taskcost"></table></div>
    </div>`;

  async function loadAndDraw() {
    const period = container.querySelector('#r-period').value;
    const unit = container.querySelector('#r-unit').value;
    const role = container.querySelector('#r-role').value;
    const memberId = container.querySelector('#r-member').value;
    const dfrom = container.querySelector('#rf-from').value;
    const dto = container.querySelector('#rf-to').value;
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (memberId) params.set('member_id', memberId);
    if (dfrom) params.set('date_from', dfrom);
    if (dto) params.set('date_to', dto);
    let data;
    try {
      data = await get('/api/projects/' + s.project.id + '/resources?' + params.toString());
    } catch (e) { notifyError(e); return; }

    // ---- histogram ----
    const hist = period === 'mingguan' ? data.chart_weekly : data.chart_daily;
    const factor = unit === 'jam' ? (data.hours_per_day / 100) : 1;
    const labels = hist.labels.map((d) => period === 'mingguan' ? 'Mulai ' + fmtDate(d) : fmtDate(d));
    const inSeries = [...hist.series]; // [memberId, map]
    const hasMemberFilter = !!memberId || !!role;
    const ds = inSeries
      .filter(([mid]) => !memberId || Number(memberId) === mid)
      .filter(([mid]) => {
        if (!role) return true;
        const m = state.members.find((x) => x.id === mid);
        return m && m.role === role;
      })
      .map(([mid, map], i) => {
        const mem = state.members.find((x) => x.id === mid) || { name: '#' + mid };
        return {
          label: mem.name,
          data: hist.labels.map((k) => Math.round((map.get(k) || 0) * factor)),
          backgroundColor: palette(i % palette.length),
          stack: 'beban',
        };
      });
    if (typeof Chart !== 'undefined') {
      charts.push(new Chart(container.querySelector('#c-hist'), {
        type: 'bar',
        data: { labels, datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { stacked: true },
            y: { stacked: true, title: { display: true, text: unit === 'jam' ? 'Jam / periode' : '% alokasi' } },
          },
          plugins: { legend: { display: hasMemberFilter || ds.length <= 12, position: 'bottom' } },
        },
      }));
    }

    // ---- biaya pie ----
    const withCost = data.summary.filter((m) => m.cost > 0);
    if (typeof Chart !== 'undefined') {
      charts.push(new Chart(container.querySelector('#c-cost'), {
        type: 'pie',
        data: {
          labels: withCost.map((m) => m.name),
          datasets: [{ data: withCost.map((m) => m.cost), backgroundColor: withCost.map((_, i) => palette(i % palette.length)) }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
      }));
    }

    // ---- peringatan kelebihan beban ----
    const ws = container.querySelector('#r-warn');
    ws.innerHTML = data.overallocations.length
      ? `<div class="callout danger" style="margin-top:12px"><b>${data.overallocations.length} hari kelebihan beban (overallocated):</b><ul style="margin:6px 0 0 18px">
        ${data.overallocations.slice(0, 12).map((o) => `<li>${esc(o.member)} — ${fmtDate(o.date)} — beban ${o.load}% — penyebab: ${o.tasks.map((t) => esc(t.code + ' ' + t.name)).join(', ')}</li>`).join('')}
        ${data.overallocations.length > 12 ? `<li><i>… dan ${data.overallocations.length - 12} lainnya</i></li>` : ''}</ul></div>`
      : '<div class="callout ok" style="margin-top:12px">Tidak ada kelebihan beban pada filter ini.</div>';

    // ---- ringkasan ----
    const stLabel = (st) => st === 'Kelebihan Beban' ? '<span class="badge KelebihanBeban">Kelebihan Beban</span>'
      : st === 'Kurang Dimanfaatkan' ? '<span class="badge Kurang">Kurang Dimanfaatkan</span>'
      : st === 'Belum Ditugaskan' ? '<span class="badge Belum">Belum Ditugaskan</span>'
      : '<span class="badge Normal">Normal</span>';
    const totalCost = data.total_cost || withCost.reduce((a, m) => a + m.cost, 0);
    container.querySelector('#r-summary').innerHTML = `
      <thead><tr><th>Anggota</th><th>Peran</th><th class="num">Hari Kerja Teralokasi</th><th class="num">Hari Cuti</th><th class="num">Beban Rata-rata</th><th>Status</th><th class="num">Biaya</th></tr></thead><tbody>
      ${data.summary.map((m) => `<tr>
        <td><b>${esc(m.name)}</b></td><td>${esc(m.role)}</td>
        <td class="num">${m.allocated_days}</td><td class="num">${m.leave_days}</td>
        <td class="num">${m.avg_load}%</td><td>${stLabel(m.status)}</td>
        <td class="num">${rupiah(m.cost)}</td></tr>`).join('')}
      <tr style="font-weight:700;background:#f8fafc"><td colspan="6" style="text-align:right">Total estimasi biaya tenaga kerja</td><td class="num">${rupiah(totalCost)}</td></tr>
      </tbody></table>`;

    // ---- biaya per tugas ----
    container.querySelector('#r-taskcost').innerHTML = `
      <thead><tr><th>Kode</th><th>Tugas</th><th>Anggota (alokasi)</th><th class="num">Biaya</th></tr></thead><tbody>
      ${(data.task_costs || []).map((t) => `<tr>
        <td>${esc(t.code)}</td><td>${esc(t.name)}</td>
        <td style="font-size:12px">${t.assignees.map((a) => esc(a.name) + ' (' + a.allocation + ')').join(', ')}</td>
        <td class="num">${rupiah(t.cost)}</td></tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted)">Tidak ada penugasan.</td></tr>'}
      </tbody></table>`;
  }

  container.querySelector('#r-apply').addEventListener('click', loadAndDraw);
  void today;
  loadAndDraw();
}

function palette(i) {
  const C = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#be185d', '#65a30d', '#a16207', '#4f46e5'];
  return C[i];
}
