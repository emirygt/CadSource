module.exports = {
  apps: [
    {
      name: "cad-search",
      script: "uvicorn",
      args: "main:app --host 127.0.0.1 --port 8000 --workers 4",
      cwd: "/home/ec2-user/CadSource/backend",
      interpreter: "/home/ec2-user/CadSource/backend/venv/bin/python3",
      interpreter_args: "-m",
      env: {
        DATABASE_URL: "postgresql://postgres:changeme@127.0.0.1:5432/cad_search",
        JWT_SECRET: "change-this-secret",
        ENVIRONMENT: "production",
      },
      // Otomatik restart
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // Log
      out_file: "/var/log/cad-search/out.log",
      error_file: "/var/log/cad-search/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
