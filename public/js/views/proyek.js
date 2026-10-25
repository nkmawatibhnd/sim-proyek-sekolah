'use strict';

import { get, post, put, del, esc, fmtDateFull, hariNama, notifyError, toast, confirmDialog } from '../util.js';
import { rerender, setActive, refreshSchedule } from '../app.js';

let calMonth = null; // {y, m} 1-based month
const HARI_LABEL = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) {
    container.innerHTML = `<div class="callout danger">${s && s.error ? esc(s.message) : 'Belum ada proyek. Buat proyek baru terlebih dahulu.'}</div>`;
  }
  const p = state.projects.find((x) => x.id === state.activeId);
  const project = s && !s.error ? s.project : null;

  const card = document.createElement('div');
  card.innerHTML = `
    <div class="grid2">
      <div>
        <div class="card" id="proyek-form-card">
          <h2 data-form-title>Tambah Proyek</h2>
          <div class="form-grid">
            <label class="f">Nama Proyek *</label><label class="f">Organisasi</label>
            <input id="f-nama" placeholder="cth: Pembangunan Gedung SD Negeri Baru" />
            <input id="f-org" placeholder="cth: Dinas Pendidikan Kota" />
            <label class="f">Tanggal Mulai Proyek *</label><label class="f">Deskripsi</label>
            <input id="f-tgl" type="date" />
            <textarea id="f-desc" rows="2" placeholder="Deskripsi proyek…"></textarea>
          </div>
          <div class="err" data-err></div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn primary" id="btn-save-proyek">Simpan Proyek</button>
            <button class="btn" data-editing hidden>Selesai ubah</button>
          </div>
        </div>
        <div class="card">
          <h2>Daftar Proyek</h2>
          <div data-proj-list></div>
        </div>
      </div>
      <div id="kalender-area"></div>
    </div>`;

  container.appendChild(card);
  const formId = { current: null };

  const listCard = card.querySelector('[data-proj-list]');
  listCard.innerHTML = state.projects.length
    ? `<table class="table"><thead><tr><th>Nama</th><th>Organisasi</th><th>Mulai</th><th style="width:170px"></th></tr></thead><tbody>
      ${state.projects.map((x) => `
        <tr class="${x.id === state.activeId ? '' : ''}">
          <td><b>${esc(x.name)}</b>${x.id === state.activeId ? ' <span class="chip">aktif</span>' : ''}</td>
          <td>${esc(x.org || '-')}</td><td>${fmtDateFull(x.start_date)}</td>
          <td class="row-actions">
            <button class="btn sm" data-act="aktif" data-id="${x.id}">Jadikan aktif</button>
            <button class="btn sm" data-act="edit" data-id="${x.id}">Ubah</button>
            <button class="btn sm danger" data-act="hapus" data-id="${x.id}">Hapus</button>
          </td></tr>`).join('')}
      </tbody></table>`
    : '<p style="color:var(--muted)">Belum ada proyek. Isi formulir di atas.</p>';

  listCard.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const proj = state.projects.find((x) => x.id === id);
    if (btn.dataset.act === 'aktif') { setActive(id); toast('Proyek aktif: ' + proj.name); await refreshSchedule(); rerender(); }
    if (btn.dataset.act === 'edit') {
      formId.current = id;
      card.querySelector('[data-form-title]').textContent = 'Ubah Proyek: ' + proj.name;
      card.querySelector('[data-editing]').hidden = false;
      card.querySelector('#f-nama').value = proj.name;
      card.querySelector('#f-org').value = proj.org || '';
      card.querySelector('#f-desc').value = proj.description || '';
      card.querySelector('#f-tgl').value = proj.start_date;
      card.querySelector('#f-nama').focus();
    }
    if (btn.dataset.act === 'hapus') {
      const ok = await confirmDialog(`Hapus proyek "${proj.name}" beserta seluruh tugas, libur, dan datanya?`, 'Ya, hapus proyek');
      if (!ok) return;
      try { await del('/api/projects/' + id); toast('Proyek dihapus.', 'ok'); rerender(); } catch (err) { notifyError(err); }
    }
  });

  card.querySelector('[data-editing]').addEventListener('click', () => {
    formId.current = null;
    card.querySelector('[data-form-title]').textContent = 'Tambah Proyek';
    card.querySelector('[data-editing]').hidden = true;
    card.querySelectorAll('#f-nama,#f-org,#f-desc,#f-tgl').forEach((i) => (i.value = ''));
  });

  card.querySelector('#btn-save-proyek').addEventListener('click', async () => {
    const errBox = card.querySelector('[data-err]');
    errBox.textContent = '';
    const body = {
      name: card.querySelector('#f-nama').value,
      org: card.querySelector('#f-org').value,
      description: card.querySelector('#f-desc').value,
      start_date: card.querySelector('#f-tgl').value,
      workdays: project ? project.workdays.join('') : '12345',
    };
    if (!body.name.trim()) { errBox.textContent = 'Nama proyek wajib diisi.'; return; }
    if (!body.start_date) { errBox.textContent = 'Tanggal mulai proyek wajib diisi.'; return; }
    try {
      if (formId.current) {
        await put('/api/projects/' + formId.current, body);
        toast('Proyek diperbarui.', 'ok');
      } else {
        const created = await post('/api/projects', body);
        setActive(created.id);
        toast('Proyek dibuat & dijadikan aktif.', 'ok');
      }
      rerender();
    } catch (e) { errBox.textContent = e.message; }
  });

  // Kalender kerja
  const kal = card.querySelector('#kalender-area');
  const workdays = project ? project.workdays : [1, 2, 3, 4, 5];
  if (!project) {
    kal.innerHTML = '<div class="card"><h2>Kalender Kerja</h2><p style="color:var(--muted)">Buat / pilih proyek aktif untuk mengelola kalender.</p></div>';
    return;
  }
  const holidays = state.schedule.holidays;
  if (!calMonth) {
    const d = new Date();
    calMonth = { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  renderKalender(kal, calMonth, workdays, holidays, project, state);
}

function renderKalender(area, cm, workdays, holidays, project, state) {
  area.innerHTML = `
    <div class="card">
      <h2>Kalender Kerja Proyek</h2>
      <div class="toolbar">
        <button class="btn sm" id="cal-prev">◀ Bulan sebelumnya</button>
        <b id="cal-title" style="min-width:150px;text-align:center"></b>
        <button class="btn sm" id="cal-next">▶ Bulan berikutnya</button>
        <span class="spacer"></span>
        <small class="cash-note">Hari kerja aktif: <span id="wd-label"></span></small>
      </div>
      <div id="cal-grid"></div>
      <div class="day-checks" id="day-checks"></div>
      <div style="margin-top:10px"><button class="btn primary" id="btn-save-cal">Simpan Hari Kerja</button></div>
    </div>
    <div class="card">
      <h2>Hari Libur Nasional / Khusus</h2>
      <div class="toolbar">
        <input id="hol-date" type="date" />
        <input id="hol-name" placeholder="Keterangan (cth: Idulfitri)" style="min-width:200px" />
        <button class="btn primary sm" id="btn-add-hol">Tambah Libur</button>
      </div>
      <div id="hol-list"></div>
    </div>`;

  const year = cm.y, month = cm.m;
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  area.querySelector('#cal-title').textContent = BULAN[month - 1] + ' ' + year;
  area.querySelector('#wd-label').textContent = project.workdays.map((d) => HARI_LABEL[(d + 6) % 7]).join(', ');

  const holByDate = new Map(holidays.map((h) => [h.date, h]));
  const workSet = new Set(project.workdays);
  const today = new Date().toISOString().slice(0, 10);

  // mulai hari Senin di minggu pertama
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDayIdx = (first.getUTCDay() + 6) % 7; // 0=Senin
  let start = new Date(Date.UTC(year, month - 1, 1 - firstDayIdx));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    cells.push({ ymd, inMonth: d.getUTCMonth() === month - 1, wd: d.getUTCDay() });
  }

  const holidayName = (ymd) => (holByDate.get(ymd) || {}).name;
  const gridHTML = `<table class="cal"><thead><tr>${HARI_LABEL.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
    [0, 1, 2, 3, 4, 5].map((w) => '<tr>' + cells.slice(w * 7, w * 7 + 7).map((c) => {
      const cls = [];
      if (!c.inMonth) cls.push('out');
      if (!workSet.has(c.wd)) cls.push('off');
      if (holidayName(c.ymd)) cls.push('holiday');
      if (c.ymd === today) cls.push('today');
      const lbl = holidayName(c.ymd) ? `<small>${esc(holidayName(c.ymd))}</small>` : '';
      return `<td class="${cls.join(' ')}" title="${c.ymd}${holidayName(c.ymd) ? ' — ' + esc(holidayName(c.ymd)) : ''}"><span class="d">${Number(c.ymd.slice(8))}</span>${lbl}</td>`;
    }).join('') + '</tr>').join('') + '</tbody></table>';
  area.querySelector('#cal-grid').innerHTML = gridHTML;

  // checkbox hari kerja
  const dc = area.querySelector('#day-checks');
  dc.innerHTML = HARI_ID.map((h, i) => `
    <label><input type="checkbox" data-wd="${i}" ${workSet.has(i) ? 'checked' : ''}/> ${h}</label>`).join('');

  dc.addEventListener('change', () => {
    if (![...dc.querySelectorAll('input:checked')].length) {
      toast('Minimal satu hari kerja harus dipilih.', 'err');
      dc.querySelector(`input[data-wd="${workdays[0] || 1}"]`).checked = true;
    }
  });

  area.querySelector('#btn-save-cal').addEventListener('click', async () => {
    const selected = [...dc.querySelectorAll('input:checked')].filter((x) => x.disabled !== true).map((x) => Number(x.dataset.wd)).sort((a, b) => a - b);
    try {
      await put('/api/projects/' + project.id, { workdays: selected.join('') });
      toast('Hari kerja tersimpan. Jadwal dihitung ulang.', 'ok');
      await refreshSchedule();
      const s2 = (await import('../app.js')).state.schedule;
      const p2 = s2.project;
      renderKalender(area, cm, p2.workdays, state.schedule.holidays, p2, state);
    } catch (e) { notifyError(e); }
  });

  area.querySelector('#cal-prev').addEventListener('click', () => { cm.m--; if (cm.m < 1) { cm.m = 12; cm.y--; } renderKalender(area, cm, project.workdays, holidays, project, state); });
  area.querySelector('#cal-next').addEventListener('click', () => { cm.m++; if (cm.m > 12) { cm.m = 1; cm.y++; } renderKalender(area, cm, project.workdays, holidays, project, state); });

  // daftar libur
  const hl = area.querySelector('#hol-list');
  hl.innerHTML = holidays.length ? `<table class="table"><tbody>${holidays.map((h) => `
      <tr><td style="white-space:nowrap">${fmtDateFull(h.date)}</td><td>${hariNama(h.date)}</td><td>${esc(h.name)}</td>
      <td class="row-actions"><button class="btn sm danger" data-hol="${h.id}">Hapus</button></td></tr>`).join('')}</tbody></table>`
    : '<p style="color:var(--muted)">Belum ada hari libur terdaftar.</p>';
  hl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-hol]');
    if (!btn) return;
    try { await del('/api/projects/holidays/' + btn.dataset.hol); toast('Hari libur dihapus. Jadwal dihitung ulang.', 'ok'); await refreshSchedule(); rerender(); } catch (err) { notifyError(err); }
  });

  area.querySelector('#btn-add-hol').addEventListener('click', async () => {
    const date = area.querySelector('#hol-date').value;
    const name = area.querySelector('#hol-name').value;
    try {
      await post('/api/projects/' + project.id + '/holidays', { date, name });
      toast('Hari libur ditambahkan. Jadwal dihitung ulang.', 'ok');
      await refreshSchedule();
      const s2 = (await import('../app.js')).state.schedule;
      renderKalender(area, cm, s2.project.workdays, s2.holidays, s2.project, state);
    } catch (e) { notifyError(e); }
  });
}
