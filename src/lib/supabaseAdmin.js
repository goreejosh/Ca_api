const { createClient } = require('@supabase/supabase-js');

// NOTE: dotenv is loaded in src/index.js, but keep this for safety when used standalone.
try {
  // eslint-disable-next-line global-require
  require('dotenv').config();
} catch (_) {}

// Provide a fetch with timeout so admin queries never hang indefinitely
const DEFAULT_FETCH_TIMEOUT_MS = parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS || '60000', 10);
function createFetchWithTimeout(timeoutMs) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
    }, timeoutMs);
    try {
      const merged = { ...options, signal: options.signal || controller.signal };
      try {
        return await fetch(url, merged);
      } catch (err) {
        // Add helpful diagnostics without leaking keys.
        let origin = '';
        try {
          origin = typeof url === 'string' ? new URL(url).origin : '';
        } catch (_) {}
        const code = err?.cause?.code ? String(err.cause.code) : (err?.code ? String(err.code) : '');
        const msg = err?.cause?.message ? String(err.cause.message) : (err?.message ? String(err.message) : 'fetch failed');
        const extra = [origin ? `origin=${origin}` : null, code ? `code=${code}` : null].filter(Boolean).join(' ');
        const wrapped = new Error(`[supabaseAdmin] fetch failed${extra ? ` (${extra})` : ''}: ${msg}`);
        wrapped.cause = err;
        throw wrapped;
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
  // Fail fast with a clear error; this service is not useful without these.
  // Throwing here keeps startup honest rather than failing later in random endpoints.
  throw new Error('[CA_api] Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
}

const sharedFetch = createFetchWithTimeout(DEFAULT_FETCH_TIMEOUT_MS);

const supabaseAdmin = createClient(
  supabaseUrl,
  secretKey,
  {
    global: { fetch: sharedFetch },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }
);

module.exports = supabaseAdmin;

