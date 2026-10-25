'use strict';

import { get, post, put, del, esc, fmtDate, notifyError, toast, openModal, confirmDialog } from '../util.js';
import { refreshSchedule, rerender } from '../app.js';

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) { container.innerHTML = `<div class="callout danger">Jadwal belum tersedia.</div>`; return; }

  const leaves = {};
  try {
    const det = await Promise.all(state.members.map((m) => get('/api/members/' + m.id)));
    for (const d of det) leaves[d.member.id] = d.leaves;
  } catch (e) { /* non-fatal */ }

  const warns = s.warnings || { overallocations: [], leaveConflicts: [] };
  container.innerHTML = `
    <div class="card">
      <h2>Penugasan Anggota ke Tugas</h2>
      <p class="sub">Penugasan hanya untuk tugas sub-kegiatan (paling bawah). Atur persentase alokasi per anggota (default 100%).</p>
      ${warns.overallocations.length ? `<div class="callout warn"><b>Peringatan kelebihan beban:</b> ${warns.overallocations.length} hari dengan beban &gt;100%.
        Contoh: ${esc(warns.overallocations[0].member)} pada ${fmtDate(warns.overallocations[0].date)} — beban ${warns.overallocations[0].load}% (${warns.overallocations[0].tasks.map((t) => t.code).join(', ')}). Lihat menu Resource.</div>` : ''}
      ${warns.leaveConflicts.length ? `<div class="callout warn"><b>Tugas terhenti karena cuti:</b> ${warns.leaveConflicts.length} kasus. Contoh: ${esc(warns.leaveConflicts[0].member)} cuti pada ${fmtDate(warns.leaveConflicts[0].date)} — tugas ${esc(warns.leaveConflicts[0].task_code)} berhenti sementara.</div>` : ''}
      <table class="table"><thead><tr>
        <th style="width:70px">Kode</th><th>Tugas</th><th>Mulai</th><th>Selesai</th><th>Penugasan</th><th style="width:140px">Aksi</th>
      </tr></thead><tbody>
        ${s.tasks.filter((t) => t.is_leaf).map((t) => `<tr>
          <td>${esc(t.code)}</td>
          <td><b>${esc(t.name)}</b>${t.critical ? ' <span class="badge Kritis">kritis</span>' : ''}</td>
          <td>${fmtDate(t.start)}</td><td>${fmtDate(t.finish)}</td>
          <td>${assignees(t)}</td>
          <td class="row-actions">
            <button class="btn sm primary" data-assign="${t.id}">Atur penugasan</button>
          </td></tr>`).join('')}
      </tbody></table>
    </div>`;

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-assign]');
    if (!btn) return;
    const t = s.tasks.find((x) => x.id === Number(btn.dataset.assign));
    assignmentDialog(state, t, leaves, rerender);
  });
}

function assignees(t) {
  if (!t.assignees.length) return '<span class="cash-note">— belum ada —</span>';
  return t.assignees.map((a) =>
    `<span class="chip" title="${esc(a.role)}">${esc(a.name)} · ${a.allocation}%</span>`).join(' ');
}

function assignmentDialog(state, task, leaves, done) {
  const s = state.schedule;
  const current = task.assignees.map((a) => ({ member_id: a.member_id, allocation: a.allocation }));

  const m = openModal('Penugasan: ' + task.code + ' ' + task.name, `
    <p class="cash-note">Rentang tugas: ${fmtDate(task.start)} — ${fmtDate(task.finish)} · ${task.work_dates ? task.work_dates.length : task.duration} hari kerja efektif.</p>
    <div id="as-list"></div>
    <div class="toolbar" style="margin-top:10px">
      <select id="as-pick"></select>
      <button class="btn primary sm" id="as-add">+ Tambah anggota</button>
    </div>
    <div class="err" id="as-err"></div>`);

  const sel = m.body.querySelector('#as-pick');
  s.members.forEach((mem) => {
    if (!current.some((c) => c.member_id === mem.id)) {
      const opt = document.createElement('option');
      opt.value = mem.id;
      opt.textContent = mem.name + ' (' + mem.role + ')';
      sel.appendChild(opt);
    }
  });

  function rows() {
    const box = m.body.querySelector('#as-list');
    box.innerHTML = `<table class="table"><thead><tr><th>Anggota</th><th>Peran</th><th style="width:130px">Alokasi (%)</th><th>Keterangan</th><th></th></tr></thead><tbody>
      ${current.map((c) => {
        const mem = s.members.find((x) => x.id === c.member_id) || {};
        const lv = (leaves[mem.id] || []).filter((l) => task.start && task.finish &&
          (l.start_date <= task.finish) && ((l.end_date || l.start_date) >= task.start));
        const lvNote = lv.length ? `<span class="badge Kritis">Cuti ${fmtDate(lv[0].start_date)}–${fmtDate(lv[0].end_date || lv[0].start_date)}</span>` : '';
        return `<tr>
          <td><b>${esc(mem.name || '#' + c.member_id)}</b></td><td>${esc(mem.role || '')}</td>
          <td><input type="number" min="1" max="100" value="${c.allocation}" data-alloc="${c.member_id}" style="width:100px" /></td>
          <td>${lvNote}</td>
          <td><button class="btn sm danger" data-rm="${c.member_id}">Lepas</button></td></tr>`;
      }).join('') || '<tr><td colspan="5" style="color:var(--muted)">Belum ada anggota ditugaskan.</td></tr>'}
    </tbody></table>`;
    box.querySelectorAll('input[data-alloc]').forEach((inp) => inp.addEventListener('change', () => {
      const id = Number(inp.dataset.alloc);
      const v = Math.max(1, Math.min(100, Number(inp.value) || 100));
      const e = current.find((c) => c.member_id === id);
      e.allocation = v;
      rows();
    }));
    box.querySelectorAll('button[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.rm);
      const i = current.findIndex((c) => c.member_id === id);
      if (i >= 0) { current.splice(i, 1); rows(); sel.value = ''; }
      const opt = document.createElement('option');
      const mem = s.members.find((x) => x.id === id);
      opt.value = id; opt.textContent = mem.name + ' (' + mem.role + ')';
      sel.appendChild(opt);
    }));
  }
  rows();

  m.body.querySelector('#as-add').addEventListener('click', () => {
    const id = Number(sel.value);
    if (!id) return;
    current.push({ member_id: id, allocation: 100 });
    sel.querySelector('option[value="' + id + '"]') && sel.querySelector('option[value="' + id + '"]').remove();
    sel.value = '';
    rows();
  });

  const batal = document.createElement('button');
  batal.className = 'btn'; batal.textContent = 'Batal'; batal.addEventListener('click', m.close);
  const simpan = document.createElement('button');
  simpan.className = 'btn primary'; simpan.textContent = 'Simpan Penugasan';
  simpan.addEventListener('click', async () => {
    const err = m.body.querySelector('#as-err'); err.textContent = '';
    try {
      await put('/api/members/assignments/task/' + task.id, { members: current.map((c) => ({ member_id: c.member_id, allocation: c.allocation })) });
      toast('Penugasan tersimpan. Jadwal & beban dihitung ulang.', 'ok');
      m.close(); await refreshSchedule(); done();
    } catch (e) { err.textContent = e.message; }
  });
  m.foot.append(batal, simpan);
}
