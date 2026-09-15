# QA Frontend — MELESAT v1.0.0

## Provider Apps Script
1. Gunakan datastore UAT dan Web App UAT.
2. Isi `public/melesat-config.js` dengan `backendProvider: "apps-script"` dan URL `/exec` UAT.
3. Build/preview frontend.
4. Uji empat role, realtime revision polling, form-safe refresh, responsive mobile, laporan, recovery Admin, dan annual cleanup gate.

## Provider Firebase
Gunakan Firebase Emulator/DEV seperti release Firebase v1.0.0, lalu set `backendProvider: "firebase"` dan konfigurasi Firebase DEV.

Checklist bisnis lengkap ada di `../docs/UAT_V1.md`.
