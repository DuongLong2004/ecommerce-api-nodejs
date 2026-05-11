const { client: redis, scanKeys } = require("../config/redis");
const logger = require("../utils/logger");

const DEFAULT_TTL = 60 * 5;

const cache = (ttl = DEFAULT_TTL) => {
  return async (req, res, next) => {
    if (!redis.isReady) {
      return next();
    }

    const key = `cache:${req.originalUrl}`;

    try {
      const cached = await redis.get(key);

      if (cached) {
        logger.info(`Cache HIT: ${key}`);
        return res.status(200).json({
          ...JSON.parse(cached),
          _cache: "HIT",
        });
      }

      logger.info(`Cache MISS: ${key}`);

      const originalJson = res.json.bind(res);
      res.json = async (data) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            await redis.setEx(key, ttl, JSON.stringify(data));
          } catch (err) {
            logger.warn(`Cache set failed: ${err.message}`);
          }
        }
        return originalJson(data);
      };

      next();
    } catch (err) {
      logger.warn(`Cache middleware error: ${err.message}`);
      next();
    }
  };
};

const clearCache = async (urlPrefix) => {
  if (!redis.isReady) return;

  try {
    const pattern = `cache:${urlPrefix}*`;
    const keys    = await scanKeys(pattern);

    if (keys.length > 0) {
      await redis.del(keys);
      logger.info(`Cache cleared: ${keys.length} keys với prefix "${urlPrefix}"`);
    }
  } catch (err) {
    logger.warn(`Cache clear failed: ${err.message}`);
  }
};

module.exports = { cache, clearCache };