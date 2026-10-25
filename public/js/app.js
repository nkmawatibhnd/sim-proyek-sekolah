'use strict';

import { get, post, esc, toast, notifyError } from './util.js';
import { render as renderProyek } from './views/proyek.js';
import { render as renderTugas } from './views/tugas.js';
import { render as renderKetergantungan } from './views/ketergantungan.js';
import { render as renderSumberDaya } from './views/sumberdaya.js';
import { render as renderPenugasan } from './views/penugasan.js';
import { render as renderGantt } from './views/gantt.js';
import { render as renderPert } from './views/pert.js';
import { render as renderCpm } from './views/cpm.js';
import { render as renderResource } from './views/resources.js';
import { render as renderPengaturan } from './views/pengaturan.js';
import { ensureAuth, showUser, logout } from './session.js';

export const state = {
  projects: [],
  activeId: Number(localStorage.getItem('simpro.activeId')) || null,
  schedule: null,
  members: [],
};

export const ROUTES = [
  { hash: '#/proyek', title: 'Proyek & Kalender Kerja', icon: '📅', view: renderProyek },
  { hash: '#/tugas', title: 'Tugas (WBS)', icon: '🗂️', view: renderTugas },
  { hash: '#/ketergantungan', title: 'Ketergantungan Tugas', icon: '🔗', view: renderKetergantungan },
  { hash: '#/sumber-daya', title: 'Sumber Daya', icon: '👷', view: renderSumberDaya },
  { hash: '#/penugasan', title: 'Penugasan', icon: '🧩', view: renderPenugasan },
  { hash: '#/gantt', title: 'Gantt Chart', icon: '📊', view: renderGantt },
  { hash: '#/pert', title: 'PERT / Network Diagram', icon: '🕸️', view: renderPert },
  { hash: '#/cpm', title: 'Analisis Jalur Kritis', icon: '🚦', view: renderCpm },
  { hash: '#/resource', title: 'Resource & Biaya', icon: '📈', view: renderResource },
  { hash: '#/pengaturan', title: 'Pengaturan', icon: '⚙️', view: renderPengaturan },
];

function currentRoute() {
  const hash = location.hash || '#/proyek';
  return ROUTES.find((r) => r.hash === hash) || ROUTES[0];
}

export async function loadProjects() {
  state.projects = await get('/api/projects');
  if (!state.projects.length) {
    state.activeId = null;
  } else if (!state.projects.some((p) => p.id === state.activeId)) {
    setActive(state.projects[0].id, false);
  }
  syncProjectSelect();
}

export function setActive(id, save = true) {
  state.activeId = id;
  if (save) localStorage.setItem('simpro.activeId', String(id));
  syncProjectSelect();
}

function syncProjectSelect() {
  const sel = document.getElementById('proj-select');
  sel.innerHTML = state.projects.map((p) =>
    `<option value="${p.id}" ${p.id === state.activeId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  sel.disabled = !state.projects.length;
}

export async function refreshSchedule() {
  if (!state.activeId) { state.schedule = null; return; }
  try {
    state.schedule = await get('/api/projects/' + state.activeId + '/schedule');
  } catch (e) {
    state.schedule = { error: true, message: e.message };
  }
  if (state.schedule && state.schedule.members) state.members = state.schedule.members;
}

export function activeProjectName() {
  const p = state.projects.find((x) => x.id === state.activeId);
  return p ? p.name : '—';
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = ROUTES.map((r) => `
    <a class="nav-item" data-hash="${r.hash}" href="${r.hash}">
      <span class="ico">${r.icon}</span><span class="txt">${esc(r.title)}</span>
    </a>`).join('');
}

async function render() {
  const route = currentRoute();
  document.getElementById('page-title').textContent = route.title;
  document.querySelectorAll('.nav-item').forEach((el) =>
    el.classList.toggle('active', el.getAttribute('data-hash') === route.hash));
  const content = document.getElementById('content');
  content.innerHTML = '<div style="color:var(--muted);padding:20px">Memuat data…</div>';
  try {
    await loadProjects();
    await refreshSchedule();
    await route.view(content, state);
  } catch (e) {
    content.innerHTML = `<div class="callout danger">Gagal memuat: ${esc(e.message)}</div>`;
    console.error(e);
  }
}

export function navigate(hash) {
  location.hash = hash;
}
// render() ialah dipanggil oleh hashchange
export function rerender() { render(); }

window.addEventListener('hashchange', render);

document.getElementById('proj-select').addEventListener('change', async (e) => {
  setActive(Number(e.target.value));
  const route = currentRoute();
  document.getElementById('content').innerHTML = '<div style="color:var(--muted)">Memuat data…</div>';
  try {
    await refreshSchedule();
    await route.view(document.getElementById('content'), state);
  } catch (err) { notifyError(err); }
  toast('Proyek aktif: ' + activeProjectName());
});

export async function resetDemo() {
  const r = await post('/api/reset');
  toast(r.message, 'ok');
  await loadProjects();
  setActive(r.project_id, true);
}

document.getElementById('btn-logout').addEventListener('click', logout);

buildNav();

// Gerbang autentikasi: tanpa sesi valid, pengguna dialihkan ke halaman login
// dan aplikasi tidak merender data apapun. Perlindungan utamanya tetap di server
// (middleware authGuard pada semua endpoint /api selain /api/auth/*).
(async function boot() {
  const user = await ensureAuth();
  if (user) {
    showUser(user);
    render();
  }
})();
