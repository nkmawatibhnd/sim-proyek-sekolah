'use strict';

import { post, put, del, esc, notifyError, toast, confirmDialog, openModal } from '../util.js';
import { refreshSchedule, rerender } from '../app.js';
import { openTaskModal } from './tugas.js';

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) {
    container.innerHTML = `<div class="callout danger">Jadwal belum tersedia: ${s && s.error ? esc(s.message) : 'pilih proyek di header.'}</div>`;
    return;
  }
  container.innerHTML = `
    <div class="card">
      <h2>Ketergantungan Tugas</h2>
      <p class="sub">Tipe hubungan: <b>FS</b> (Finish-to-Start) dan <b>SS</b> (Start-to-Start), dengan lag dalam
      hari kerja (boleh negatif sebagai <i>lead</i>). Contoh format: <span class="chip">2.3FS+7</span> berarti mulai
      7 hari kerja setelah tugas 2.3 selesai (masa curing beton).</p>
      <div class="callout info">Sistem menolak ketergantungan melingkar, predecessor ke diri sendiri, duplikat, dan
      tugas induk sebagai predecessor. Jadwal langsung bergeser saat predecessor/lag diubah.</div>
      <table class="table"><thead><tr>
        <th style="width:70px">Kode</th><th>Nama Tugas</th><th>Predecessor</th><th style="width:110px">Aksi</th>
      </tr></thead><tbody>
        ${s.tasks.map((t) => `<tr class="${t.critical ? 'critical' : ''}">
          <td>${esc(t.code)}</td>
          <td>${esc(t.name)}${!t.is_leaf ? ' <span class="chip">induk</span>' : ''}</td>
          <td>${depChips(t)}</td>
          <td class="row-actions">${t.is_leaf
            ? `<button class="btn sm" data-edit="${t.id}">Ubah ketergantungan</button>`
            : '<span class="cash-note">—</span>'}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-edit]');
    if (!btn) return;
    const t = s.tasks.find((x) => x.id === Number(btn.dataset.edit));
    openTaskModal(state, t, null, rerender);
  });
}

function depChips(t) {
  if (!t.deps || !t.deps.length) return '<span class="cash-note">—</span>';
  return t.deps.map((d) => `<span class="chip">${esc(d.pred_code)}${d.type}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}</span>`).join(' ');
}
