# MELESAT Produksi V1 — Frontend

PWA resmi Farmasi, Kurir, Admin, dan Manajemen. Provider produksi adalah **Apps Script / FORM_POST_V4**.

Konfigurasi utama: `public/melesat-config.js` → `backendProvider: "apps-script"` dan URL Web App `/exec`.

Build:
```text
pnpm install --frozen-lockfile
pnpm run build
pnpm run verify
```

Catatan: PIN tidak ditulis pada source/config frontend. Dashboard Admin menerima PIN Vault hanya setelah sesi Admin terautentikasi.
