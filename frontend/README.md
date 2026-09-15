# MELESAT Golden Frontend v1.0.0

React/PWA resmi untuk Farmasi, Kurir, Admin, dan Manajemen. Frontend ini **tidak di-fork berdasarkan backend**.

Pilih provider melalui `public/melesat-config.js`:
- `backendProvider: "apps-script"` untuk pilot Google Apps Script + Sheets.
- `backendProvider: "firebase"` untuk Firestore + Cloud Functions.

Jangan menaruh PIN, pepper, receipt key, service-account key, atau secret server di frontend.

Perintah build:
```text
pnpm install --frozen-lockfile
pnpm run build
pnpm run verify
pnpm run preview
```

Build produksi berada di `dist/`. Workflow GitHub Pages tersedia di root repository.
