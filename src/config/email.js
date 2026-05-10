const nodemailer = require("nodemailer");
const logger     = require("../utils/logger");

// ════════════════════════════════════════════════════════════════════════════
// NODEMAILER CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Nodemailer transporter cho Gmail SMTP.
 *
 * Có 2 cách config tùy môi trường:
 *
 *   1. PRODUCTION (Railway/Heroku/AWS): explicit host + port 465 + SSL
 *      → Nhiều cloud provider chặn port 587 (STARTTLS) nhưng cho qua 465 (SSL).
 *      → Railway nằm trong nhóm này, đã có log "Connection timeout" port 587.
 *
 *   2. DEVELOPMENT (local): service: "gmail" cho gọn
 *      → Nodemailer tự handle host/port, mạng nhà thường không chặn port nào.
 *
 * Free tier Gmail:
 *   - 500 emails/day
 *   - Đủ cho dev + demo + portfolio
 *
 * @security KHÔNG hardcode credentials. Đọc từ process.env.
 *           File .env phải có trong .gitignore (đã có).
 */
const isProduction = process.env.NODE_ENV === "production";

const transporter = nodemailer.createTransport(
  isProduction
    ? {
        // Production: explicit SSL trên port 465
        host:   "smtp.gmail.com",
        port:   465,
        secure: true, // true = dùng SSL (port 465); false = STARTTLS (port 587, có thể bị block)
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
        // Tăng timeout cho cloud network (latency cao hơn local)
        connectionTimeout: 10000, // 10s
        greetingTimeout:   10000,
        socketTimeout:     15000,
      }
    : {
        // Development: gọn nhẹ, Nodemailer tự handle
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
      }
);

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verify SMTP connection khi server khởi động.
 *
 * @note Không throw error nếu fail — server vẫn chạy được mà không cần email
 *       (graceful degradation). Logger sẽ warn để dev biết.
 *
 * Production tip: Có thể bỏ verify khi deploy để tránh delay startup.
 */
const verifyEmailConnection = async () => {
  try {
    await transporter.verify();
    logger.info("Email transporter ready");
  } catch (err) {
    logger.warn(`Email transporter failed: ${err.message}`);
    logger.warn("Email features will not work — check EMAIL_USER and EMAIL_PASSWORD in .env");
  }
};

// Auto-verify khi module được require lần đầu
// Trong test environment thì skip để tránh fake credentials gây error
if (process.env.NODE_ENV !== "test") {
  verifyEmailConnection();
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  transporter,
  verifyEmailConnection,
};