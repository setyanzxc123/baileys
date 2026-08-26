#!/usr/bin/env bash
# Backup folder sesi WhatsApp (kredensial pairing) — dirancang untuk cron.
# Folder sesi hilang berarti pairing ulang manual, sehingga backup rutin
# adalah syarat go-live. Jalankan dari direktori root proyek.
#
# Variabel lingkungan (opsional):
#   SESSION_DIR  folder sesi yang dibackup   (default: ./sessions)
#   BACKUP_DIR   tujuan arsip                (default: ./backups)
#   RETENTION    jumlah backup tersimpan     (default: 14)
#
# Catatan: backup diambil saat gateway mungkin sedang menulis file
# kredensial — satu file bisa ter-capture setengah tertulis. Retensi
# beberapa backup menutup risiko ini; untuk backup 'dingin' pastikan
# jalankan: pm2 stop dprd-wa-gateway && ./scripts/backup-sessions.sh && pm2 start dprd-wa-gateway
set -euo pipefail

SESSION_DIR="${SESSION_DIR:-./sessions}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${RETENTION:-14}"

if [ ! -d "$SESSION_DIR" ]; then
  echo "[backup-sessions] FATAL: folder sesi '$SESSION_DIR' tidak ditemukan." >&2
  exit 1
fi

timestamp=$(date +%Y%m%d-%H%M%S)
target="wa-sessions-${timestamp}.tar.gz"

# Arsip berisi kredensial — cegah user lain di server membacanya.
umask 077
mkdir -p "$BACKUP_DIR"
tar -czf "${BACKUP_DIR}/${target}" -C "$(dirname "$SESSION_DIR")" "$(basename "$SESSION_DIR")"

# Simpan hanya RETENTION arsip terbaru.
ls -1t "${BACKUP_DIR}"/wa-sessions-*.tar.gz 2>/dev/null \
  | tail -n +"$((RETENTION + 1))" \
  | xargs -r rm -f

echo "[backup-sessions] ${BACKUP_DIR}/${target} dibuat (retensi ${RETENTION} arsip)."
