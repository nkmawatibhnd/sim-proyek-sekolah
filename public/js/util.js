'use strict';

// Utilitas tampilan bersama.

export async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth')) {
      // Sesi berakhir/pengguna belum masuk: kembali ke halaman login.
      const err = new Error('Sesi tidak valid. Silakan masuk kembali.');
      err.status = 401;
      setTimeout(() => { location.replace('/login.html'); }, 600);
      throw err;
    }
    const msg = (data && data.error) || ('Kesalahan HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b);
export const put = (u, b) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function fmtDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '-';
  const [y, m, d] = ymd.split('-');
  return Number(d) + ' ' + BULAN[Number(m) - 1] + ' ' + y;
}

export function fmtDateFull(ymd) {
  if (!ymd) return '-';
  const [y, m, d] = ymd.split('-');
  return Number(d) + ' ' + BULAN_FULL[Number(m) - 1] + ' ' + y;
}

export function hariNama(ymd) {
  if (!ymd) return '';
  const dt = new Date(ymd + 'T00:00:00Z');
  return HARI[dt.getUTCDay()];
}

export function rupiah(n) {
  const v = Math.round(Number(n) || 0);
  return 'Rp' + v.toLocaleString('id-ID');
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function esc(s) { return escapeHtml(s); }

export function addDays(y, n) {
  const d = new Date(y + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function toast(msg, type) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3400);
  setTimeout(() => el.remove(), 3800);
}

export function notifyError(e) {
  console.error(e);
  toast(e && e.message ? e.message : 'Terjadi kesalahan.', 'err');
}

// Modal sederhana. Kembalikan fungsi close.
export function openModal(title, bodyHTML, opts) {
  opts = opts || {};
  const root = document.getElementById('modal-root');
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal ${opts.wide ? 'wide' : ''}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="btn ghost" data-close title="Tutup">✕</button>
      </div>
      <div class="modal-body" data-body>${bodyHTML}</div>
      <div class="modal-foot" data-foot></div>
    </div>`;
  root.appendChild(ov);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && opts.dismissable !== false) close(); });
  function close() { ov.remove(); if (opts.onClose) opts.onClose(); }
  ov.querySelector('[data-close]').addEventListener('click', close);
  return { overlay: ov, close, foot: ov.querySelector('[data-foot]'), body: ov.querySelector('[data-body]') };
}

export function confirmDialog(message, okLabel) {
  return new Promise((resolve) => {
    const m = openModal('Konfirmasi', `<p style="margin:4px 0">${esc(message)}</p>`, { onClose: () => resolve(false) });
    const no = document.createElement('button');
    no.className = 'btn'; no.textContent = 'Batal';
    no.addEventListener('click', () => { m.close(); });
    const yes = document.createElement('button');
    yes.className = 'btn danger'; yes.textContent = okLabel || 'Ya, lanjutkan';
    yes.addEventListener('click', () => { resolve(true); m.close(); });
    m.foot.append(no, yes);
    void m.foot;
  });
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function pctBar(p) {
  const v = Math.max(0, Math.min(100, Number(p) || 0));
  return `<div class="progress-cell"><div class="progressbar"><div class="${v >= 100 ? 'full' : ''}" style="width:${v}%"></div></div><span class="progress-num">${v.toFixed(0)}%</span></div>`;
}
