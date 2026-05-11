const { createClient } = require("redis");
const logger = require("../utils/logger");
const { REFRESH_TOKEN_TTL_SECONDS: REFRESH_TOKEN_TTL } = require("./constants");

/*
 * ════════════════════════════════════════════════════════════════════════════
 * DUAL-MODE REDIS CONFIG
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Hỗ trợ 2 cách config (theo độ ưu tiên):
 *
 *   1. REDIS_URL  → connection string Railway/Upstash
 *      VD: redis://default:password@host:port
 *      VD TLS: rediss://default:password@host:port
 *
 *   2. REDIS_HOST + REDIS_PORT + REDIS_PASSWORD  → local development
 *
 * Logic: nếu có URL → dùng URL, không thì fallback từng env riêng.
 * ════════════════════════════════════════════════════════════════════════════
 */

const redisUrl = process.env.REDIS_URL;

const clientOptions = redisUrl
  ? { url: redisUrl } // Mode 1: Production
  : {
      // Mode 2: Local development
      socket: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
    };

const client = createClient(clientOptions);

client.on("error", (err) => {
  logger.error(`Redis error: ${err.message}`);
});

client.on("connect", () => {
  logger.info("Redis connected");
});

const connectRedis = async () => {
  try {
    await client.connect();
  } catch (err) {
    logger.warn(`Redis connection failed: ${err.message} — running without cache`);
  }
};

connectRedis();

// ════════════════════════════════════════════════════════════════════════════
// SESSION KEY HELPERS
// ════════════════════════════════════════════════════════════════════════════

/*
 * Session schema (multi-device):
 *   session:{userId}:{deviceId} = JSON {
 *     refreshToken,
 *     deviceName,
 *     userAgent,
 *     ip,
 *     createdAt,
 *     lastActive
 *   }
 *
 * TTL = 7 ngày, trùng với refreshToken expiry.
 * Mỗi user có thể có nhiều keys song song (1 key / device đang đăng nhập).
 */

const sessionKey = (userId, deviceId) => `session:${userId}:${deviceId}`;
const sessionPattern = (userId) => `session:${userId}:*`;

// ════════════════════════════════════════════════════════════════════════════
// SCAN HELPER — production-safe alternative to KEYS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Scan tất cả keys khớp pattern, dùng cursor-based SCAN thay vì KEYS.
 *
 * @param {string} pattern - Glob pattern (vd: "session:123:*")
 * @param {number} count   - Hint số keys mỗi batch (default 100). Redis có thể
 *                           trả ít hơn hoặc nhiều hơn, đây chỉ là gợi ý.
 * @returns {Promise<string[]>} Mảng keys khớp pattern.
 *
 * @design Dùng `scanIterator()` của node-redis v4+ — wrapper async iterator
 *         quanh raw SCAN command. Mỗi vòng lặp trả 1 batch, KHÔNG block Redis.
 *
 * @security Không dùng KEYS trong production:
 *           - KEYS block toàn bộ Redis (single-threaded) cho đến khi quét xong
 *           - SCAN chia nhỏ thành nhiều round-trips, mỗi round-trip O(count)
 *           - Trade-off: SCAN không đảm bảo consistent snapshot, nhưng với
 *             use case session/cache thì chấp nhận được.
 *
 * @note `scanIterator` tự xử lý cursor + lặp đến hết, caller chỉ cần await for-of.
 */
const scanKeys = async (pattern, count = 100) => {
  const keys = [];
  for await (const key of client.scanIterator({ MATCH: pattern, COUNT: count })) {
    // node-redis v4 trả về string đơn lẻ; v5+ có thể trả batch array — handle cả 2
    if (Array.isArray(key)) {
      keys.push(...key);
    } else {
      keys.push(key);
    }
  }
  return keys;
};

// ════════════════════════════════════════════════════════════════════════════
// SESSION OPERATIONS — Multi-device
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tạo hoặc cập nhật 1 session cho user trên 1 device cụ thể.
 *
 * @param {Object} payload
 * @param {number} payload.userId
 * @param {string} payload.deviceId      - UUID của device
 * @param {string} payload.refreshToken
 * @param {string} payload.deviceName    - VD: "Chrome on Windows"
 * @param {string} payload.userAgent     - Raw User-Agent header
 * @param {string} payload.ip            - IP address
 * @returns {Promise<void>}
 *
 * @design TTL = 7 ngày trùng với refreshToken expiry → key tự xóa khi token hết hạn.
 */
const createSession = async ({
  userId,
  deviceId,
  refreshToken,
  deviceName,
  userAgent,
  ip,
}) => {
  const now = new Date().toISOString();
  const data = {
    refreshToken,
    deviceName,
    userAgent,
    ip,
    createdAt: now,
    lastActive: now,
  };
  await client.setEx(sessionKey(userId, deviceId), REFRESH_TOKEN_TTL, JSON.stringify(data));
};

/**
 * Lấy 1 session theo userId + deviceId.
 * @returns {Promise<Object|null>} Session data hoặc null nếu không tồn tại.
 */
const getSession = async (userId, deviceId) => {
  const raw = await client.get(sessionKey(userId, deviceId));
  return raw ? JSON.parse(raw) : null;
};

/**
 * Update lastActive của session (gọi mỗi khi user dùng refresh token).
 * Re-set TTL về 7 ngày để session active không bị expire.
 */
const touchSession = async (userId, deviceId) => {
  const session = await getSession(userId, deviceId);
  if (!session) return;
  session.lastActive = new Date().toISOString();
  await client.setEx(sessionKey(userId, deviceId), REFRESH_TOKEN_TTL, JSON.stringify(session));
};

/**
 * Xóa 1 session cụ thể (logout 1 device).
 */
const deleteSession = async (userId, deviceId) => {
  await client.del(sessionKey(userId, deviceId));
};

/**
 * List tất cả sessions của 1 user.
 * @returns {Promise<Array>} [{ deviceId, deviceName, ip, userAgent, createdAt, lastActive }]
 *
 * @note KHÔNG trả về refreshToken trong response (security).
 * @performance Dùng SCAN thay vì KEYS để tránh block Redis.
 */
const listSessions = async (userId) => {
  const keys = await scanKeys(sessionPattern(userId));
  if (keys.length === 0) return [];

  const sessions = await Promise.all(
    keys.map(async (key) => {
      const raw = await client.get(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const deviceId = key.split(":")[2]; // session:{userId}:{deviceId}
      return {
        deviceId,
        deviceName: data.deviceName,
        ip:         data.ip,
        userAgent:  data.userAgent,
        createdAt:  data.createdAt,
        lastActive: data.lastActive,
      };
    })
  );

  return sessions.filter(Boolean).sort((a, b) =>
    new Date(b.lastActive) - new Date(a.lastActive)
  );
};

/**
 * Xóa TẤT CẢ sessions của user (logout all devices).
 * Dùng cho: resetPassword, account compromise.
 *
 * @performance Dùng SCAN thay vì KEYS.
 */
const deleteAllSessions = async (userId) => {
  const keys = await scanKeys(sessionPattern(userId));
  if (keys.length > 0) {
    await client.del(keys);
  }
};

/**
 * Xóa tất cả sessions TRỪ 1 device cụ thể (logout other devices).
 * Dùng cho: "Đăng xuất khỏi tất cả thiết bị khác" trong Profile.
 *
 * @performance Dùng SCAN thay vì KEYS.
 */
const deleteOtherSessions = async (userId, keepDeviceId) => {
  const keys = await scanKeys(sessionPattern(userId));
  const keepKey = sessionKey(userId, keepDeviceId);
  const toDelete = keys.filter((k) => k !== keepKey);
  if (toDelete.length > 0) {
    await client.del(toDelete);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  client,

  // SCAN helper (export để cache.middleware dùng chung)
  scanKeys,

  // Multi-device session API
  createSession,
  getSession,
  touchSession,
  deleteSession,
  listSessions,
  deleteAllSessions,
  deleteOtherSessions,
};