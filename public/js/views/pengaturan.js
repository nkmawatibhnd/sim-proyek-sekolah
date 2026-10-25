'use strict';

import { get, post, esc, notifyError, toast, confirmDialog } from '../util.js';
import { resetDemo, rerender, refreshSchedule } from '../app.js';

export async function render(container, state) {
  let summary = null;
  try { summary = await get('/api/summary'); } catch (e) { /* biarkan kosong */ }

  container.innerHTML = `
    <div class="card">
      <h2>Pengaturan & Ekspor</h2>
      <div class="grid2">
        <div>
          <h3 style="font-size:14px;margin:0 0 6px">Ekspor Jadwal (CSV)</h3>
          <p class="sub">Unduh jadwal proyek aktif " ${esc(state.activeId ? (state.projects.find((p) => p.id === state.activeId) || {}).name : '')}" berformat CSV (pemisah titik-koma, siap dibuka di Excel).</p>
          ${state.activeId
            ? `<a class="btn primary" href="/api/projects/${state.activeId}/export.csv" download>⇩ Unduh CSV Jadwal</a>`
            : '<span class="cash-note">Pilih proyek aktif terlebih dahulu.</span>'}
        </div>
        <div>
          <h3 style="font-size:14px;margin:0 0 6px">Reset ke Data Contoh</h3>
          <p class="sub">Mengembalikan seluruh database ke data contoh awal (proyek "Pembangunan Gedung SD Negeri Baru", 10 anggota tim, kalender libur 2026, penugasan, dan cuti).</p>
          <button class="btn danger" id="btn-reset">⟳ Reset ke data contoh</button>
          <div class="err" id="reset-err"></div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Ringkasan Data Saat Ini</h2>
      <div class="kpis">
        ${summary ? [
          ['Proyek', summary.projects],
          ['Tugas (WBS)', summary.tasks],
          ['Anggota Tim', summary.members],
          ['Hari Libur', summary.holidays],
          ['Penugasan', summary.assignments],
          ['Ketergantungan', summary.deps],
          ['Cuti Pribadi', summary.leaves],
        ].map(([l, v]) => `<div class="kpi"><div class="k-l">${l}</div><div class="k-v">${v}</div></div>`).join('') : '<p class="cash-note">Ringkasan tidak tersedia.</p>'}
      </div>
      <p class="cash-note">Database tersimpan di <code>data/app.db</code>. Menghapus file tersebut lalu menjalankan ulang <code>npm start</code> juga akan memuat ulang data contoh.</p>
    </div>`;

  container.querySelector('#btn-reset').addEventListener('click', async () => {
    const ok = await confirmDialog('Reset seluruh data ke data contoh? Semua perubahan Anda akan hilang.', 'Ya, reset data');
    if (!ok) return;
    try {
      await resetDemo();
      await refreshSchedule();
      rerender();
    } catch (e) {
      notifyError(e);
      container.querySelector('#reset-err').textContent = e.message;
    }
  });
}
