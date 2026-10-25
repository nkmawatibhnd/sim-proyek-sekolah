'use strict';

import { post, esc, fmtDate, notifyError, toast } from '../util.js';

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) { container.innerHTML = `<div class="callout danger">Jadwal belum tersedia.</div>`; return; }

  const kritis = s.tasks.filter((t) => t.is_leaf && t.critical);
  container.innerHTML = `
    <div class="card">
      <h2>Analisis Jalur Kritis (CPM)</h2>
      <div class="kpis">
        <div class="kpi"><div class="k-l">Durasi Total Proyek</div><div class="k-v">${s.projectDuration} hari kerja</div></div>
        <div class="kpi"><div class="k-l">Tanggal Selesai Proyek</div><div class="k-v" style="font-size:15px">${fmtDate(s.projectFinish)}</div></div>
        <div class="kpi k-danger"><div class="k-l">Tugas Kritis</div><div class="k-v">${kritis.length}</div></div>
        <div class="kpi k-ok"><div class="k-l">Jalur Kritis</div><div class="k-v" style="font-size:15px">${s.criticalChains.length} rangkaian</div></div>
      </div>

      <h2>Simulasi Keterlambatan</h2>
      <p class="sub">Telisik dampak keterlambatan tanpa mengubah data. Pilih tugas, masukkan keterlambatan (hari kerja), lalu lihat efeknya ke tanggal selesai proyek.</p>
      <div class="toolbar">
        <select id="sim-task">
          <option value="">— pilih tugas —</option>
          ${s.tasks.filter((t) => t.is_leaf).map((t) => `<option value="${t.id}">${esc(t.code)} — ${esc(t.name)}</option>`).join('')}
        </select>
        <input id="sim-delay" type="number" min="0" value="5" style="width:110px" />
        <span class="cash-note">hari kerja terlambat</span>
        <button class="btn primary" id="sim-run">Jalankan Simulasi</button>
      </div>
      <div id="sim-result"></div>

      <h2 style="margin-top:18px">Daftar Jalur Kritis</h2>
      ${s.criticalChains.map((chain, i) => `
        <p style="margin:6px 0"><b>Jalur ${i + 1}:</b> ${chain.map((code) => `<span class="chip" style="background:#fee2e2;border-color:#fecaca">${esc(code)}</span>`).join(' → ')}</p>`).join('')}

      <h2 style="margin-top:16px">Tabel Forward/Backward Pass</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr>
        <th>Kode</th><th>Nama Tugas</th><th class="num">Durasi</th>
        <th>ES</th><th>EF</th><th>LS</th><th>LF</th>
        <th class="num">Slack (hkr)</th><th>Status</th>
      </tr></thead><tbody>
        ${s.tasks.map((t) => `<tr class="${t.critical ? 'critical' : ''}">
          <td>${esc(t.code)}</td>
          <td>${esc(t.name)}${!t.is_leaf ? ' <span class="chip">induk</span>' : ''}</td>
          <td class="num">${t.duration}</td>
          <td>${fmtDate(t.es)}</td><td>${fmtDate(t.ef)}</td>
          <td>${fmtDate(t.ls)}</td><td>${fmtDate(t.lf)}</td>
          <td class="num"><b>${t.slack}</b></td>
          <td>${t.critical ? '<span class="badge Kritis">Kritis</span>' : '<span class="badge Normal">Normal</span>'}</td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>`;

  container.querySelector('#sim-run').addEventListener('click', async () => {
    const taskId = Number(container.querySelector('#sim-task').value);
    const delay = Number(container.querySelector('#sim-delay').value) || 0;
    const box = container.querySelector('#sim-result');
    if (!taskId) { box.innerHTML = '<div class="callout warn">Pilih tugas yang akan disimulasikan.</div>'; return; }
    box.innerHTML = '<p class="cash-note">Menghitung…</p>';
    try {
      const r = await post('/api/projects/' + s.project.id + '/simulate', { task_id: taskId, delay });
      const t = r.task;
      box.innerHTML = r.mempengaruhi_selesai ? `
        <div class="callout danger">
          <b>Tanggal selesai proyek MUNDUR ${r.bergeser_hari} hari kalender</b> — dari ${fmtDate(r.selesai_proyek_lama)} menjadi ${fmtDate(r.selesai_proyek_baru)}.
        </div>
        <table class="table"><tbody>
          <tr><td>Tugas</td><td><b>${esc(t.code)} ${esc(t.name)}</b></td></tr>
          <tr><td>Jadwal tugas (lama)</td><td>${fmtDate(t.mulai_lama)} — ${fmtDate(t.selesai_lama)}</td></tr>
          <tr><td>Jadwal tugas (terlambat)</td><td>${fmtDate(t.mulai_baru)} — ${fmtDate(t.selesai_baru)}</td></tr>
          <tr><td>Keterlambatan</td><td>${r.delay_days} hari kerja</td></tr>
        </tbody></table>
        <p class="cash-note">Simulasi tidak mengubah data asli (segarkan halaman untuk mengembalikan tampilan).</p>` : `
        <div class="callout ok">
          Proyek <b>TIDAK terganggu</b>: tanggal selesai tetap ${fmtDate(r.selesai_proyek_lama)} (tugas memiliki slack yang cukup).
        </div>`;
      void toast;
    } catch (e) {
      notifyError(e);
      box.innerHTML = '';
    }
  });
}