'use strict';

// Halaman login: cek sesi, validasi non-kosong di frontend, kirim POST /api/auth/login,
// tampilkan pesan kesalahan dan indikator loading. Pengalihan ke '/' bila berhasil.

const form = document.getElementById('login-form');
const userInput = document.getElementById('login-user');
const passInput = document.getElementById('login-pass');
const errUser = document.getElementById('err-user');
const errPass = document.getElementById('err-pass');
const errBox = document.getElementById('login-error');
const btn = document.getElementById('btn-login');
const btnLabel = btn.querySelector('.btn-label');
const btnSpinner = btn.querySelector('.btn-spinner');
const pwToggle = document.getElementById('pw-toggle');

// Sudah masuk? Langsung ke aplikasi.
(async () => {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (r.ok) location.replace('/');
  } catch (e) { /* server belum siap: biarkan halaman terbuka */ }
})();

// Toggle tampilkan/sembunyikan password.
pwToggle.addEventListener('click', () => {
  const show = passInput.type === 'password';
  passInput.type = show ? 'text' : 'password';
  pwToggle.textContent = show ? '🙈' : '👁';
});

function setLoading(on) {
  btn.disabled = on;
  btnLabel.textContent = on ? 'Memproses…' : 'Masuk';
  btnSpinner.hidden = !on;
}

function clearErrors() {
  errUser.textContent = '';
  errPass.textContent = '';
  errBox.hidden = true;
  errBox.textContent = '';
}

function showServerError(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearErrors();

  const user = userInput.value.trim();
  const pass = passInput.value;

  // Validasi frontend: input tidak boleh kosong.
  let ok = true;
  if (!user) { errUser.textContent = 'Email/username tidak boleh kosong.'; ok = false; }
  if (!pass) { errPass.textContent = 'Password tidak boleh kosong.'; ok = false; }
  if (!ok) {
    (user ? passInput : userInput).focus();
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: user, password: pass }),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* respon non-JSON */ }

    if (res.ok) {
      location.replace('/');
      return;
    }
    showServerError((data && data.error) || ('Gagal masuk (HTTP ' + res.status + ').'));
    passInput.value = '';
    passInput.focus();
  } catch (e) {
    showServerError('Tidak dapat menghubungi server. Pastikan server berjalan, lalu coba lagi.');
    console.error(e);
  } finally {
    setLoading(false);
  }
});
