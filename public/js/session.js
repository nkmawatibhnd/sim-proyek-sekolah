'use strict';

// Helper sesi frontend: memastikan pengguna sudah masuk, menampilkan identitas
// di topbar, dan menangani logout (mengakhiri sesi server + pengalihan ke login).

export async function ensureAuth() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!r.ok) { location.replace('/login.html'); return null; }
    const data = await r.json();
    return data && data.user ? data.user : null;
  } catch (e) {
    location.replace('/login.html');
    return null;
  }
}

export function showUser(user) {
  const chip = document.getElementById('user-chip');
  if (!chip || !user) return;
  document.getElementById('user-name').textContent = user.name || user.username;
  document.getElementById('user-role').textContent = user.username || '';
  chip.hidden = false;
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (e) { /* tetap keluar meski jaringan bermasalah */ }
  location.replace('/login.html');
}
