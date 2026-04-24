const path = require("path");

const PROJECT_ROOT = __dirname;
const BACKEND_DIR = path.join(PROJECT_ROOT, "backend");
const UVICORN_BIN = path.join(BACKEND_DIR, "venv", "bin", "uvicorn");

module.exports = {
  apps: [
    {
      // CLAUDE.md operasyon notu ile hizali isim
      name: "cadsearch",
      cwd: BACKEND_DIR,
      script: UVICORN_BIN,
      args: "main:app --host 127.0.0.1 --port 8000 --workers 2",
      interpreter: "none",
      env: {
        // DB/JWT degerleri backend/.env dosyasindan okunur
        ENVIRONMENT: "production",
        PYTHONUNBUFFERED: "1",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      time: true,
    },
  ],
};
