'use strict';

const express = require('express');
const path = require('path');
const { init } = require('./db');
const { authGuard } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

init();

// Proteksi API: semua endpoint selain /api/auth/* wajib sesi login yang valid.
app.use('/api', authGuard);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api', require('./routes/analysis'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/members', require('./routes/members'));

// Perbaikan: route detail anggota /api/members/:id beririsan dengan /api/members (OK);
// 404 API yang rapi selain route di atas:
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server: ' + (err && err.message ? err.message : 'tidak diketahui') });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Sistem Informasi Manajemen Proyek Pembangunan Sekolah');
  console.log('Server berjalan di http://localhost:' + PORT);
});
