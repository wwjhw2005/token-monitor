'use strict';

const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');

// WeCode is Weibo's internal AI coding assistant. The quota endpoint reports a
// per-user billing allowance: {"user_quota":743,"user_usage":30.38,
// "user_usage_rate":0.0409,"username":"..."} — usage_rate is a 0..1 fraction.
const WECODE_QUOTA_URL = 'https://copilot.weibo.com/v1/wecode_quota/user_aigc_model_quota_detail';

// Mirror the headers the real WeCode for Xcode plugin sends, so the request is
// indistinguishable from the IDE's own quota poll.
const WECODE_BASE_HEADERS = {
  accept: '*/*',
  'accept-language': 'zh-CN,zh-Hans;q=0.9',
  'content-type': 'application/json',
  'user-agent': 'WeCodeForXcodeExtensionService/3050500 CFNetwork/3890.100.1 Darwin/27.0.0',
  'wecode-client': 'Xcode 27.0.0, WeCode for Xcode 3.5.5.3050500',
  'wecode-ide-name': 'Xcode',
  'wecode-ide-version': '27.0.0',
  'wecode-plugin-name': 'WeCode for Xcode',
  'wecode-plugin-version': '3.5.5.3050500',
  'wecode-retry': '0'
};

function wecodeHeaders(user) {
  return { ...WECODE_BASE_HEADERS, 'wecode-user': user };
}

function cleanValue(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

// WECODE_USER accepts one username or a comma-separated list; each user shows
// as its own account entry.
function wecodeUsers(env = process.env, explicit = '') {
  const raw = cleanValue(explicit) || cleanValue(env.WECODE_USER);
  const seen = new Set();
  const users = [];
  for (const part of raw.split(',')) {
    const user = part.trim();
    if (!user || seen.has(user)) continue;
    seen.add(user);
    users.push(user);
  }
  return users;
}

// copilot.weibo.com is intranet-only; WECODE_PROXY (e.g. http://localhost:9090)
// tunnels the request through an HTTP proxy when the host is not directly
// reachable from this machine.
function wecodeProxy(env = process.env, explicit = '') {
  return cleanValue(explicit) || cleanValue(env.WECODE_PROXY);
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseWecodeQuota(rawBody) {
  const body = rawBody?.data && typeof rawBody.data === 'object' ? rawBody.data : rawBody;
  const limit = numberOrNull(body?.user_quota);
  const used = numberOrNull(body?.user_usage);
  const rate = numberOrNull(body?.user_usage_rate);
  const usedPercent = used !== null && limit !== null && limit > 0
    ? Math.max(0, Math.min(100, (used / limit) * 100))
    : rate !== null ? Math.max(0, Math.min(100, rate * 100)) : null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  if (usedPercent === null && used === null && limit === null) return { username, windows: [] };
  return {
    username,
    windows: [{
      kind: 'billing',
      label: 'Quota',
      used,
      limit,
      remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
      usedPercent,
      showMeter: true
    }]
  };
}

// CONNECT tunnel through an HTTP proxy. ponytail: no Proxy-Authorization
// support — add it here if the proxy ever requires auth.
function connectThroughProxy(proxyUrl, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    let proxy;
    try {
      proxy = new URL(proxyUrl);
    } catch (_) {
      reject(new Error(`Invalid WECODE_PROXY url: ${proxyUrl}`));
      return;
    }
    const request = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}` },
      timeout: timeoutMs
    });
    request.on('connect', (response, socket) => {
      if (response.statusCode === 200) resolve(socket);
      else {
        socket.destroy();
        reject(new Error(`proxy CONNECT returned ${response.statusCode}`));
      }
    });
    request.on('timeout', () => request.destroy(new Error('proxy CONNECT timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function postWecodeQuota(user, { proxyUrl = '', timeoutMs = 12000 } = {}) {
  const target = new URL(WECODE_QUOTA_URL);
  const port = Number(target.port) || 443;
  let tunnelSocket = null;
  let createConnection;
  if (proxyUrl) {
    tunnelSocket = await connectThroughProxy(proxyUrl, target.hostname, port, timeoutMs);
    const socket = tunnelSocket;
    createConnection = () => tls.connect({ socket, servername: target.hostname });
  }
  const body = JSON.stringify({ user_name: user });
  try {
    return await new Promise((resolve, reject) => {
      const request = https.request({
        host: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          ...wecodeHeaders(user),
          'content-length': Buffer.byteLength(body),
          connection: 'close'
        },
        ...(createConnection ? { agent: false, createConnection } : {}),
        timeout: timeoutMs
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      });
      request.on('timeout', () => request.destroy(new Error('WeCode quota request timed out')));
      request.on('error', reject);
      request.end(body);
    });
  } finally {
    // The CONNECT tunnel socket outlives the TLS session and would otherwise
    // keep one socket per probe (and the process) alive.
    tunnelSocket?.destroy();
  }
}

async function fetchWecodeUserLimits(user, proxyUrl, updatedAt, deps = {}) {
  try {
    const post = deps.postWecodeQuota || postWecodeQuota;
    const { status, text } = await post(user, {
      proxyUrl,
      timeoutMs: Number(deps.fetchTimeoutMs || 12000)
    });
    if (status !== 200) {
      const error = new Error(`WeCode quota returned ${status}`);
      error.status = status === 401 || status === 403 ? 'unauthorized'
        : status === 429 ? 'sourceRateLimited' : 'unavailable';
      throw error;
    }
    const parsed = parseWecodeQuota(JSON.parse(text));
    return normalizeLimitProvider({
      provider: 'wecode',
      accountKey: hashKey('wecode', parsed.username || user),
      accountName: parsed.username || user,
      source: 'api',
      status: parsed.windows.length ? 'ok' : 'unavailable',
      updatedAt,
      windows: parsed.windows
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'wecode',
      accountKey: hashKey('wecode', user),
      accountName: user,
      source: 'api',
      status: error?.status || 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

async function fetchWecodeLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const users = wecodeUsers(env, options.wecodeUser ?? options.wecodeUsers);
  if (users.length === 0) {
    return normalizeLimitProvider({
      provider: 'wecode',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  const proxyUrl = wecodeProxy(env, options.wecodeProxy);
  return Promise.all(users.map((user) => fetchWecodeUserLimits(user, proxyUrl, updatedAt, deps)));
}

module.exports = {
  WECODE_QUOTA_URL,
  wecodeHeaders,
  wecodeUsers,
  wecodeProxy,
  parseWecodeQuota,
  fetchWecodeLimits
};
