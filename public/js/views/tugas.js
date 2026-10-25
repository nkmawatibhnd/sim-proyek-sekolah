'use strict';

import { post, put, del, esc, fmtDate, notifyError, toast, confirmDialog, openModal, pctBar } from '../util.js';
import { refreshSchedule, rerender } from '../app.js';

const PRIORITIES = ['Rendah', 'Sedang', 'Tinggi', 'Kritis'];

// ---------- pelaporan util pohon ----------
function buildTree(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = new Map();
  for (const t of tasks) {
    const k = t.parent_id == null ? 0 : t.parent_id;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(t);
  }
  return { byId, kids };
}

export async function render(container, state) {
  const s = state.schedule;
  if (!s || s.error) {
    container.innerHTML = `<div class="callout danger">Jadwal belum tersedia: ${s && s.error ? esc(s.message) : 'pilih proyek di header.'}</div>`;
    return;
  }
  const AllTasks = s.tasks;
  const expanded = new Set(AllTasks.filter((t) => !t.is_leaf).map((t) => t.id));
  const filters = { q: '', prio: '', pj: '' };

  container.innerHTML = `
    <div class="card">
      <h2>Pohon Tugas (WBS)</h2>
      <div class="toolbar">
        <input id="tq" placeholder="🔍 Cari nama tugas…" style="min-width:220px" />
        <select id="tp"><option value="">Semua prioritas</option>${PRIORITIES.map((p) => `<option>${p}</option>`).join('')}</select>
        <select id="tj"><option value="">Semua penanggung jawab</option>${state.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <span class="spacer"></span>
        <button class="btn primary" id="btn-add-root">+ Tambah Tugas</button>
      </div>
      <div id="wbs"></div>
      <p class="cash-note">Tugas induk menampilkan tanggal & durasi yang dihitung otomatis dari sub-kegiatan. Tugas kritis berlatar merah muda.</p>
    </div>`;

  let visible = null;
  function computeVisible() {
    const q = filters.q.toLowerCase();
    const { kids } = buildTree(AllTasks);
    const match = new Map();
    for (const t of AllTasks) {
      const ok = (!q || t.name.toLowerCase().includes(q)) &&
        (!filters.prio || t.priority === filters.prio) &&
        (!filters.pj || t.responsible_id === Number(filters.pj));
      match.set(t.id, ok);
    }
    // tampil bila cocok atau punya keturunan yang cocok
    const show = new Map();
    const walkDesc = (id, out) => {
      out.push(id);
      for (const k of kids.get(id) || []) walkDesc(k, out);
    };
    for (const t of AllTasks) {
      if (match.get(t.id)) {
        const desc = []; walkDesc(t.id, desc);
        for (const d of desc) show.set(d, true);
        let p = t.parent_id;
        while (p != null) { show.set(p, true); p = AllTasks.find((x) => x.id === p).parent_id; }
      }
    }
    visible = show;
  }

  function parentOf(t) { return t.parent_id == null ? 0 : t.parent_id; }

  function rowsHTML() {
    const { kids } = buildTree(AllTasks);
    const out = [];
    const walk = (parentId, depth) => {
      for (const t of (kids.get(parentId) || [])) {
        if (visible && !visible.get(t.id)) continue;
        out.push({ t, depth });
        if (!t.is_leaf && expanded.has(t.id)) walk(t.id, depth + 1);
      }
    };
    walk(0, 0);
    return out;
  }

  function renderTable() {
    computeVisible();
    const rows = rowsHTML();
    const w = document.getElementById('wbs');
    if (!rows.length) { w.innerHTML = '<p style="color:var(--muted)">Tidak ada tugas yang cocok dengan filter.</p>'; return; }
    w.innerHTML = `<table class="table"><thead><tr>
      <th style="width:70px">Kode</th><th>Nama Tugas</th><th>Mulai</th><th>Selesai</th>
      <th class="num">Durasi</th><th>Prioritas</th><th>PJ</th><th>Progres</th><th>Predecessor</th><th style="width:230px">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(({ t, depth }) => {
        const indent = '<span style="display:inline-block;width:' + (depth * 18) + 'px"></span>';
        const toggle = t.is_leaf ? '' : `<span class="wbs-toggle" data-toggle="${t.id}">${expanded.has(t.id) ? '▾' : '▸'}</span>`;
        const prog = t.is_leaf ? t.progress_input : t.progress;
        return `<tr class="${t.critical ? 'critical' : ''}">
          <td>${esc(t.code)}</td>
          <td>${indent}${toggle}<b class="${t.is_leaf ? '' : ''}">${esc(t.name)}</b>${!t.is_leaf ? ' <span class="chip">induk</span>' : ''}</td>
          <td>${fmtDate(t.start)}</td>
          <td>${fmtDate(t.finish)}</td>
          <td class="num">${t.duration || ''}</td>
          <td><span class="badge ${esc(t.priority)}">${esc(t.priority)}</span></td>
          <td>${esc(t.responsible_name || '')}</td>
          <td style="min-width:130px">${pctBar(prog)}</td>
          <td style="font-size:12px">${esc(t.deps_text || '')}</td>
          <td class="row-actions">
            ${!t.is_leaf ? `<button class="btn sm" data-add-child="${t.id}" title="Tambah sub-kegiatan">+ Anak</button>` : ''}
            <button class="btn sm" data-edit="${t.id}" title="Ubah">✎</button>
            <button class="btn sm danger" data-del="${t.id}" title="Hapus">🗑</button>
            <button class="btn sm ghost" data-up="${t.id}" title="Naik">▲</button>
            <button class="btn sm ghost" data-down="${t.id}" title="Turun">▼</button>
            ${depth > 0 ? `<button class="btn sm ghost" data-outdent="${t.id}" title="Keluar satu level">⇤</button>` : ''}
            <button class="btn sm ghost" data-indent="${t.id}" title="Jadikan anak tugas di atasnya">⇥</button>
          </td></tr>`;
      }).join('')}
      </tbody></table>`;

    w.onclick = async (e) => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) { const id = Number(tg.dataset.toggle); expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderTable(); }
    };
  }

  bindActions(container, state, AllTasks, expanded, { rerender, renderTable, openTaskModal, openDepsEditor });
  renderTable();

  document.getElementById('tq').addEventListener('input', (e) => { filters.q = e.target.value; renderTable(); });
  document.getElementById('tp').addEventListener('change', (e) => { filters.prio = e.target.value; renderTable(); });
  document.getElementById('tj').addEventListener('change', (e) => { filters.pj = e.target.value; renderTable(); });
  document.getElementById('btn-add-root').addEventListener('click', () => openTaskModal(state, null, null, rerender));
}

function bindActions(container, state, AllTasks, expanded, ctx) {
  const w = document.getElementById('wbs');
  w.addEventListener('click', onRowClick);
  function find(id) { return AllTasks.find((t) => t.id === id); }

  async function onRowClick(e) {
    const btn = e.target.closest('button');
    if (btn) {
      const did = btn.dataset;
      const id = Number(did.edit || did.del || did.addChild || did.up || did.down || did.outdent || did.indent);
      if (id) await handle(find(id), did, ctx, state);
      return;
    }
  }

  async function handle(t, did, ctx, state) {
    try {
      if (did.edit) openTaskModal(state, t, null, rerender);
      else if (did.addChild) openTaskModal(state, null, t, rerender);
      else if (did.del) {
        if (t.is_leaf) {
          const ok = await confirmDialog('Hapus tugas "' + t.name + '"?');
          if (!ok) return;
          await del('/api/tasks/' + t.id);
        } else {
          const ok = await confirmDialog('"' + t.name + '" adalah tugas induk. Hapus beserta SELURUH sub-kegiatannya?', 'Ya, hapus berserta sub-kegiatan');
          if (!ok) return;
          await del('/api/tasks/' + t.id);
        }
        toast('Tugas dihapus. Jadwal dihitung ulang.', 'ok');
        await refreshSchedule(); rerender();
      } else if (did.up) { await post('/api/tasks/' + t.id + '/move/relative', { direction: 'up' }); await refreshSchedule(); rerender(); }
      else if (did.down) { await post('/api/tasks/' + t.id + '/move/relative', { direction: 'down' }); await refreshSchedule(); rerender(); }
      else if (did.outdent) {
        await post('/api/tasks/' + t.id + '/move', { parent_id: t.parent_id == null ? null : (find(t.parent_id) || {}).parent_id == null ? null : find(t.parent_id).parent_id, position: 9999 });
        await refreshSchedule(); rerender();
      } else if (did.indent) {
        // jadikan anak dari saudara sebelumnya
        const sibs = AllTasks.filter((x) => x.parent_id === t.parent_id);
        const i = sibs.findIndex((x) => x.id === t.id);
        if (i <= 0) { toast('Tidak ada tugas di atasnya untuk dijadikan induk.', 'err'); return; }
        await post('/api/tasks/' + t.id + '/move', { parent_id: sibs[i - 1].id, position: 9999 });
        await refreshSchedule(); rerender();
      }
    } catch (err) { notifyError(err); }
  }
}

// ---------- modal tugas ----------
export function openTaskModal(state, task, parentTask, done) {
  const s = state.schedule;
  const isNew = !task;
  const parentId = isNew ? (parentTask ? parentTask.id : null) : (task.parent_id == null ? null : task.parent_id);
  const parentObj = parentId ? s.tasks.find((t) => t.id === parentId) : null;
  const deps = task ? s.tasks.find((t) => t.id === task.id).deps || [] : [];
  const isLeaf = isNew ? true : task.is_leaf;

  const m = openModal(isNew ? (parentTask ? 'Tambah Sub-Kegiatan' : 'Tambah Tugas') : 'Ubah Tugas', `
    <div class="form-grid">
      <label class="f">Nama Tugas *</label><label class="f">Induk</label>
      <input id="m-nama" value="${esc(task ? task.name : '')}" />
      <input value="${esc(parentObj ? parentObj.code + ' ' + parentObj.name : '— (tugas paling atas)')}" disabled />
      ${isLeaf ? `
      <label class="f">Durasi (hari kerja) *</label><label class="f">Tanggal mulai ${deps.length ? '(dinonaktifkan: punya predecessor)' : ''}</label>
      <input id="m-dur" type="number" min="1" value="${task ? task.duration : 1}" />
      <input id="m-start" type="date" value="${task ? (task.start_date_manual || '') : ''}" ${deps.length ? 'disabled' : ''} />` : `
      <label class="f">Durasi</label><label class="f">Tanggal mulai</label>
      <input value="Otomatis dari sub-kegiatan" disabled /><input value="Otomatis dari sub-kegiatan" disabled />`}
      <label class="f">Prioritas</label><label class="f">Penanggung Jawab</label>
      <select id="m-prio">${PRIORITIES.map((p) => `<option ${task && task.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="m-pj"><option value="">— tidak ada —</option>${state.members.map((x) => `<option value="${x.id}" ${task && task.responsible_id === x.id ? 'selected' : ''}>${esc(x.name)} (${esc(x.role)})</option>`).join('')}</select>
      ${isLeaf ? `
      <label class="f">Progres (%)</label><label class="f">Catatan</label>
      <input id="m-prog" type="number" min="0" max="100" value="${task ? task.progress_input : 0}" />
      <input id="m-notes" value="${esc(task ? task.notes : '')}" />` : `
      <label class="f">Catatan</label><span></span>
      <input id="m-notes" class="full" value="${esc(task ? task.notes : '')}" />`}
    </div>
    ${isLeaf ? `<div style="margin-top:12px"><h2 style="margin:0 0 4px;font-size:13.5px">Predecessor (ketergantungan)</h2>
      <div id="dep-rows"></div>
      <div class="err" id="dep-err"></div>
      <button class="btn sm" id="btn-add-dep" style="margin-top:6px">+ Tambah predecessor</button>
      ${isNew ? '<p class="cash-note">Simpan tugas terlebih dahulu untuk menetapkan predecessor yang valid terhadap tugas lain.</p>' : ''}
    </div>` : ''}
    <div class="err" id="m-err"></div>`);

  // ----- editor predecessor -----
  const depRows = [];
  const existingDeps = deps.map((d) => ({ pred_id: d.pred_id, type: d.type, lag: d.lag }));
  function depRowHTML(d, i) {
    const candidates = s.tasks.filter((x) => x.id !== (task ? task.id : -1) && x.is_leaf)
      .filter((x) => !isDescendantOf(x, task ? task.id : -1));
    return `<div class="dep-row" data-i="${i}" style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
      <select data-kind="pred" style="min-width:230px">
        <option value="">— pilih tugas —</option>
        ${candidates.map((x) => `<option value="${x.id}" ${d.pred_id === x.id ? 'selected' : ''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}
      </select>
      <select data-kind="type">
        <option value="FS" ${d.type === 'FS' ? 'selected' : ''}>FS — Selesai→Mulai</option>
        <option value="SS" ${d.type === 'SS' ? 'selected' : ''}>SS — Mulai→Mulai</option>
      </select>
      <input data-kind="lag" type="number" title="Lag (hari kerja; boleh negatif)" value="${d.lag}" style="width:90px" />
      <button class="btn sm danger" data-del-dep="${i}">Hapus</button>
    </div>`;
  }
  function isDescendantOf(candidateId, ancestorId) {
    if (ancestorId == null || ancestorId < 0) return false;
    let cur = candidateId, g = 0;
    while (cur != null && g++ < 200) {
      if (cur === ancestorId) return true;
      const p = s.tasks.find((x) => x.id === cur);
      cur = p ? p.parent_id : null;
    }
    return false;
  }
  function renderDepRows() {
    const box = m.body.querySelector('#dep-rows');
    if (!box) return;
    box.innerHTML = depRows.length ? depRows.map(depRowHTML).join('') : '<p class="cash-note">Belum ada predecessor.</p>';
    box.onchange = (e) => {
      const row = e.target.closest('.dep-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      const kind = e.target.dataset.kind;
      if (kind === 'pred') depRows[i].pred_id = Number(e.target.value) || null;
      if (kind === 'type') depRows[i].type = e.target.value;
      if (kind === 'lag') depRows[i].lag = Number(e.target.value) || 0;
    };
    box.onclick = (e) => {
      const btn = e.target.closest('button[data-del-dep]');
      if (!btn) return;
      depRows.splice(Number(btn.dataset.delDep), 1);
      renderDepRows();
    };
  }
  if (isLeaf) {
    depRows.push(...existingDeps);
    renderDepRows();
    m.body.querySelector('#btn-add-dep').addEventListener('click', () => { depRows.push({ pred_id: null, type: 'FS', lag: 0 }); renderDepRows(); });
  }

  const batal = document.createElement('button');
  batal.className = 'btn'; batal.textContent = 'Batal'; batal.addEventListener('click', m.close);
  const simpan = document.createElement('button');
  simpan.className = 'btn primary'; simpan.textContent = 'Simpan';
  simpan.addEventListener('click', async () => {
    const err = m.body.querySelector('#m-err');
    err.textContent = '';
    const nama = m.body.querySelector('#m-nama').value.trim();
    if (!nama) { err.textContent = 'Nama tugas wajib diisi.'; return; }
    const body = {
      project_id: s.project.id,
      parent_id: parentId,
      name: nama,
      priority: m.body.querySelector('#m-prio').value,
      notes: (m.body.querySelector('#m-notes') || {}).value || '',
      responsible_id: Number(m.body.querySelector('#m-pj').value) || null,
    };
    if (isLeaf) {
      body.duration = Number(m.body.querySelector('#m-dur').value) || 1;
      body.progress = Number((m.body.querySelector('#m-prog') || {}).value) || 0;
      body.start_date = deps.length ? null : ((m.body.querySelector('#m-start') || {}).value || null);
      if (body.duration < 1) { err.textContent = 'Durasi minimal 1 hari kerja.'; return; }
    } else { body.duration = 0; body.progress = 0; }
    // validasi deps dasar
    if (isLeaf && depRows.length) {
      const ids = depRows.map((d) => d.pred_id);
      if (ids.some((x) => !x)) { err.textContent = 'Ada baris predecessor tanpa tugas terpilih.'; return; }
      if (ids.some((x) => x === (task ? task.id : -1))) { err.textContent = 'Tugas tidak dapat menjadi predecessor dirinya sendiri.'; return; }
      if (new Set(ids).size !== ids.length) { err.textContent = 'Predecessor duplikat.'; return; }
    }
    try {
      let saved = task ? task : null;
      if (isNew) {
        saved = await post('/api/tasks', body);
      } else {
        await put('/api/tasks/' + task.id, body);
      }
      if (isLeaf && !isNew && depRows) {
        await put('/api/tasks/' + saved.id + '/deps', { deps: depRows });
      } else if (isLeaf && isNew && depRows.length) {
        await put('/api/tasks/' + saved.id + '/deps', { deps: depRows });
      }
      toast('Tugas tersimpan. Jadwal dihitung ulang.', 'ok');
      m.close();
      await refreshSchedule();
      done();
    } catch (e) { err.textContent = e.message; }
  });
  m.foot.append(batal, simpan);
}

export function openDepsEditor(state, task, done) { openTaskModal(state, task, null, done); }
