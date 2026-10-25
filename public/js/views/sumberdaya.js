'use strict';

import { get, post, put, del, esc, fmtDate, rupiah, notifyError, toast, confirmDialog } from '../util.js';
import { refreshSchedule, rerender } from '../app.js';

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) { container.innerHTML = `<div class="callout danger">Jadwal belum tersedia.</div>`; return; }

  // beban per anggota dari jadwal
  const detail = {};
  for (const mem of state.members) detail[mem.id] = { tasks: [] };

  // tugas per anggota (leaf)
  for (const t of s.tasks.filter((t) => t.is_leaf)) {
    for (const a of t.assignees) {
      if (!detail[a.member_id]) continue;
      detail[a.member_id].tasks.push({
        code: t.code, name: t.name, start: t.start, finish: t.finish,
        dur: t.work_dates ? t.work_dates.length : t.duration, allocation: a.allocation,
        cost: Math.round(a.salary_per_day * (t.work_dates ? t.work_dates.length : 0) * a.allocation / 100),
      });
    }
  }
  // cuti (diambil dari endpoint detail tiap anggota)
  let allLeaves = [];
  try { allLeaves = (await Promise.all(state.members.map((m) => get('/api/members/' + m.id)))); }
  catch (e) { allLeaves = []; }
  const leavesFlat = [];
  for (const d of allLeaves) {
    for (const l of d.leaves) leavesFlat.push({ member_id: d.member.id, ...l });
  }

  container.innerHTML = `
    <div class="card">
      <h2>Anggota Tim</h2>
      <div class="toolbar">
        <span class="spacer"></span>
        <button class="btn primary" id="btn-add-member">+ Tambah Anggota</button>
      </div>
      <table class="table"><thead><tr>
        <th>Nama</th><th>Peran/Posisi</th><th>Kontak</th><th class="num">Gaji / Hari</th>
        <th class="num">Tugas</th><th style="width:210px">Aksi</th>
      </tr></thead><tbody id="members-body"></tbody></table>
    </div>`;

  drawMembers(container, state, detail, leavesFlat);
  container.querySelector('#btn-add-member').addEventListener('click', () => memberModal(state, null, rerender));
}

function drawMembers(container, state, detail, leavesFlat) {
  const body = container.querySelector('#members-body');
  body.innerHTML = state.members.map((m) => `<tr>
    <td><b>${esc(m.name)}</b></td>
    <td>${esc(m.role)}</td>
    <td style="font-size:12px">${esc(m.phone || '')}<br/>${esc(m.email || '')}</td>
    <td class="num">${rupiah(m.salary_per_day)}</td>
    <td class="num">${(detail[m.id].tasks.length)}</td>
    <td class="row-actions">
      <button class="btn sm" data-detail="${m.id}">Detail</button>
      <button class="btn sm" data-edit="${m.id}">Ubah</button>
      <button class="btn sm danger" data-del="${m.id}">Hapus</button>
    </td></tr>`).join('');

  body.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.detail || btn.dataset.edit || btn.dataset.del);
    const mem = state.members.find((x) => x.id === id);
    try {
      if (btn.dataset.detail) memberDetail(state, id, leavesFlat, rerender);
      else if (btn.dataset.edit) memberModal(state, mem, rerender);
      else if (btn.dataset.del) {
        const ok = await confirmDialog('Hapus anggota "' + mem.name + '" beserta seluruh cuti dan penugasannya?', 'Ya, hapus anggota');
        if (!ok) return;
        await del('/api/members/' + id);
        toast('Anggota dihapus.', 'ok');
        await refreshSchedule(); rerender();
      }
    } catch (err) { notifyError(err); }
  };
}

function memberModal(state, member, done) {
  const isNew = !member;
  const m = openModal(isNew ? 'Tambah Anggota Tim' : 'Ubah Anggota', `
    <div class="form-grid">
      <label class="f">Nama *</label><label class="f">Peran / Posisi *</label>
      <input id="mm-nama" value="${esc(member ? member.name : '')}" />
      <input id="mm-role" value="${esc(member ? member.role : '')}" placeholder="cth: Tukang Batu" />
      <label class="f">Telepon</label><label class="f">Email</label>
      <input id="mm-telp" value="${esc(member ? member.phone || '' : '')}" />
      <input id="mm-email" type="email" value="${esc(member ? member.email || '' : '')}" />
      <label class="f">Gaji per Hari (Rp) *</label><span></span>
      <input id="mm-gaji" type="number" min="0" value="${member ? member.salary_per_day : 0}" />
    </div>
    <div class="err" id="mm-err"></div>`);
  const batal = document.createElement('button');
  batal.className = 'btn'; batal.textContent = 'Batal'; batal.addEventListener('click', m.close);
  const simpan = document.createElement('button');
  simpan.className = 'btn primary'; simpan.textContent = 'Simpan';
  simpan.addEventListener('click', async () => {
    const err = m.body.querySelector('#mm-err'); err.textContent = '';
    const body = {
      name: m.body.querySelector('#mm-nama').value,
      role: m.body.querySelector('#mm-role').value,
      phone: m.body.querySelector('#mm-telp').value,
      email: m.body.querySelector('#mm-email').value,
      salary_per_day: Number(m.body.querySelector('#mm-gaji').value) || 0,
    };
    try {
      if (isNew) { await post('/api/members', body); toast('Anggota ditambahkan.', 'ok'); }
      else { await put('/api/members/' + member.id, body); toast('Anggota diperbarui.', 'ok'); }
      m.close(); await refreshSchedule(); done();
    } catch (e) { err.textContent = e.message; }
  });
  m.foot.append(batal, simpan);
}

function memberDetail(state, memberId, leavesFlat, done) {
  const s = state.schedule;
  const mem = state.members.find((x) => x.id === memberId);
  const myLeaves = leavesFlat.filter((l) => l.member_id === memberId);
  const tasks = [];
  for (const t of s.tasks.filter((t) => t.is_leaf)) {
    for (const a of t.assignees.filter((x) => x.member_id === memberId)) {
      tasks.push({ t, a, days: t.work_dates ? t.work_dates.length : 0 });
    }
  }
  const totalDays = tasks.reduce((x, y) => x + y.days, 0);
  const totalCost = tasks.reduce((x, y) => x + Math.round(y.a.salary_per_day * y.days * y.a.allocation / 100), 0);
  const avgAlloc = totalDays ? Math.round(tasks.reduce((x, y) => x + y.a.allocation, 0) / tasks.length) : 0;

  const m = openModal('Detail Anggota: ' + mem.name, `
    <div class="kpis">
      <div class="kpi"><div class="k-l">Peran</div><div class="k-v" style="font-size:14px">${esc(mem.role)}</div></div>
      <div class="kpi"><div class="k-l">Total Hari Kerja Teralokasi</div><div class="k-v">${totalDays}</div></div>
      <div class="kpi"><div class="k-l">Hari Cuti Terdaftar</div><div class="k-v">${myLeaves.reduce((x, y) => x + (spanDays(y.start_date, y.end_date)), 0)}</div></div>
      <div class="kpi ${totalCost ? 'k-ok' : ''}"><div class="k-l">Estimasi Biaya Tenaga Kerja</div><div class="k-v">${rupiah(totalCost)}</div></div>
    </div>
    <h2 style="font-size:14px">Tugas yang Ditugaskan</h2>
    <table class="table"><thead><tr><th>Kode</th><th>Tugas</th><th>Mulai</th><th>Selesai</th><th class="num">Hari</th><th class="num">Alokasi</th><th class="num">Biaya</th></tr></thead><tbody>
      ${tasks.length ? tasks.map(({ t, a, days }) => `<tr>
        <td>${esc(t.code)}</td><td>${esc(t.name)}</td><td>${fmtDate(t.start)}</td><td>${fmtDate(t.finish)}</td>
        <td class="num">${days}</td><td class="num">${a.allocation}%</td><td class="num">${rupiah(Math.round(a.salary_per_day * days * a.allocation / 100))}</td>
      </tr>`).join('') : '<tr><td colspan="7" style="color:var(--muted)">Belum ditugaskan ke tugas mana pun.</td></tr>'}
    </tbody></table>
    <h2 style="font-size:14px;margin-top:14px">Cuti / Hari Libur Pribadi</h2>
    <table class="table"><thead><tr><th>Dari</th><th>Sampai</th><th class="num">Hari</th><th>Keterangan</th><th style="width:120px"></th></tr></thead><tbody id="lv-body">
      ${myLeaves.length ? myLeaves.map((l) => `<tr>
        <td>${fmtDate(l.start_date)}</td><td>${fmtDate(l.end_date || l.start_date)}</td>
        <td class="num">${spanDays(l.start_date, l.end_date)}</td><td>${esc(l.notes || '')}</td>
        <td><button class="btn sm danger" data-lev="${l.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="5" style="color:var(--muted)">Belum ada cuti.</td></tr>'}
    </tbody></table>
    <div class="toolbar" style="margin-top:8px">
      <input id="lv-from" type="date" /> <span class="cash-note">s/d</span> <input id="lv-to" type="date" />
      <input id="lv-note" placeholder="Keterangan cuti…" style="min-width:180px" />
      <button class="btn primary sm" id="lv-add">Tambah Cuti</button>
    </div>
    <p class="cash-note">Hari cuti tidak dihitung sebagai hari kerja bagi tugas yang ia kerjakan — jadwal tugas otomatis menyesuaikan.</p>`);

  m.body.querySelectorAll('button[data-lev]').forEach((b) => b.addEventListener('click', async () => {
    try { await del('/api/members/leaves/' + b.dataset.lev); toast('Cuti dihapus. Jadwal dihitung ulang.', 'ok'); m.close(); await refreshSchedule(); done(); }
    catch (e) { notifyError(e); }
  }));
  m.body.querySelector('#lv-add').addEventListener('click', async () => {
    const from = m.body.querySelector('#lv-from').value;
    const to = m.body.querySelector('#lv-to').value || from;
    const note = m.body.querySelector('#lv-note').value;
    try { await post('/api/members/' + memberId + '/leaves', { start_date: from, end_date: to, notes: note }); toast('Cuti ditambahkan. Jadwal dihitung ulang.', 'ok'); m.close(); await refreshSchedule(); done(); }
    catch (e) { notifyError(e); }
  });
}

function spanDays(a, b) {
  if (!a) return 0;
  const end = b || a;
  return Math.round((new Date(end + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000) + 1;
}
