// PM2 Ecosystem File — Production Configuration
// Chạy: pm2 start ecosystem.config.js --env production

module.exports = {
  apps: [
    {
      name: "backend-project",
      script: "src/server.js",

      /*
       * Cluster mode — tận dụng nhiều CPU cores cho load balancing.
       *
       * Tradeoff khi chọn số instances:
       *   - "max":  spawn theo số logical cores (vd 12) → tốn RAM, không cần thiết cho dev
       *   - 4:      sweet spot cho dev — vẫn multi-instance, tiết kiệm ~700MB RAM
       *   - 1-2:    chỉ nên dùng khi máy yếu hoặc test local đơn giản
       *
       * Production deploy (Render free 512MB) sẽ override = 1-2 qua env.
       *
       * Lý do chọn 4 cho local dev:
       *   - Vẫn demo được cluster + load balancing khi phỏng vấn
       *   - Restart nhanh hơn (4 process vs 12)
       *   - Còn buffer RAM cho VS Code, Chrome, MySQL Workbench, etc.
       */
      instances: 4,
      exec_mode: "cluster",

      // Tự restart khi crash
      autorestart: true,
      watch: false,

      // Restart nếu dùng quá 500MB RAM
      max_memory_restart: "500M",

      // Environment variables
      env: {
        NODE_ENV: "development",
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      },

      // Log files
      error_file: "logs/pm2-error.log",
      out_file:   "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // Graceful shutdown — đợi requests hiện tại xử lý xong
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};