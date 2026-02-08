const { createClient } = require('redis');

// Redis-backed rate limiter for CA_api
// Uses a fixed window counter (one key per API key per minute)
const WINDOW_SEC = 60;

// Lazy singleton Redis client
let redis;
let connectPromise;
function getRedis() {
  if (!redis) {
    // IMPORTANT:
    // - Always attach an 'error' handler. Otherwise redis socket errors can become
    //   uncaughtException and crash the process.
    // - Disable offline queue so we don't buffer commands in memory while Redis is down.
    redis = createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '5000', 10),
        keepAlive: parseInt(process.env.REDIS_SOCKET_KEEPALIVE_MS || '5000', 10),
      },
    });

    redis.on('error', (err) => {
      // Swallow transient disconnects; fail-open for rate limit.
      const msg = err && err.message ? String(err.message) : String(err);
      const name = err && err.name ? String(err.name) : '';
      const combined = `${name} ${msg}`;
      const isTransient = /SocketClosedUnexpectedly|Socket closed unexpectedly|ECONNRESET|EPIPE|ECONNABORTED/i.test(combined);
      if (isTransient) return;
      console.warn('[aiRedisRateLimit] Redis error:', combined);
    });
    redis.on('end', () => {
      // Connection ended; next request will attempt reconnect.
    });
  }

  // Ensure connect is attempted once; don't block requests on it (fail-open).
  try {
    if (redis && !redis.isOpen && !connectPromise) {
      connectPromise = redis.connect()
        .catch((err) => console.warn('[aiRedisRateLimit] Redis connect error:', err?.message || err))
        .finally(() => { connectPromise = null; });
    }
  } catch (_) {}
  return redis;
}

module.exports = async function aiRedisRateLimit(req, res, next) {
  // If Redis is not configured, skip rate limiting
  if (!process.env.REDIS_URL) return next();
  const apiKey = req.apiClient?.key;
  if (!apiKey) {
    return res.status(401).json({ error: true, message: 'Missing API key', code: 'UNAUTHORIZED' });
  }

  const limit = Math.max(1, parseInt(req.apiClient?.rate_limit || '100', 10) || 100);

  const redisClient = getRedis();
  // Fail-open if Redis isn't ready; don't hang requests.
  if (!redisClient || !redisClient.isReady) return next();
  try {
    // Bucket key: rate:<apiKey>:<epochMinute>
    const epochMinute = Math.floor(Date.now() / 1000 / WINDOW_SEC);
    const key = `rate:${apiKey}:${epochMinute}`;

    // Increment request count atomically
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, WINDOW_SEC);
    }

    // Headers for clients
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(limit - current, 0));
    const ttl = await redisClient.ttl(key);
    res.setHeader('X-RateLimit-Reset', ttl);

    if (current > limit) {
      return res.status(429).json({ error: true, message: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' });
    }

    return next();
  } catch (err) {
    console.error('[aiRedisRateLimit] Error:', err.message);
    // Fail open: allow request if Redis unavailable
    return next();
  }
};

