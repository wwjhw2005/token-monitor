'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  wecodeHeaders,
  wecodeUsers,
  wecodeProxy,
  parseWecodeQuota,
  fetchWecodeLimits
} = require('../../src/shared/wecodeLimits');
const { parseLimitProviders } = require('../../src/shared/limitCollector');
const { hashKey } = require('../../src/shared/hashKey');

const SAMPLE_RESPONSE = {
  user_quota: 743,
  user_usage: 30.38676965,
  user_usage_details: { wecode: 30.38676965 },
  user_usage_rate: 0.0409,
  username: 'weiwei33'
};

test('parseLimitProviders includes WeCode in the default provider set', () => {
  assert.ok(parseLimitProviders().includes('wecode'));
});

test('wecodeHeaders mirror the WeCode for Xcode plugin request', () => {
  const headers = wecodeHeaders('weiwei33');
  assert.equal(headers['wecode-user'], 'weiwei33');
  assert.equal(headers['wecode-plugin-name'], 'WeCode for Xcode');
  assert.equal(headers['wecode-plugin-version'], '3.5.5.3050500');
  assert.equal(headers['wecode-ide-name'], 'Xcode');
  assert.equal(headers['wecode-ide-version'], '27.0.0');
  assert.equal(headers['wecode-client'], 'Xcode 27.0.0, WeCode for Xcode 3.5.5.3050500');
  assert.equal(headers['wecode-retry'], '0');
  assert.equal(headers['user-agent'], 'WeCodeForXcodeExtensionService/3050500 CFNetwork/3890.100.1 Darwin/27.0.0');
  assert.equal(headers['accept-language'], 'zh-CN,zh-Hans;q=0.9');
  assert.equal(headers.accept, '*/*');
  assert.equal(headers['content-type'], 'application/json');
});

test('wecodeUsers parses a comma-separated list, dedupes, and prefers explicit settings', () => {
  assert.deepEqual(wecodeUsers({ WECODE_USER: 'a, b ,a,' }), ['a', 'b']);
  assert.deepEqual(wecodeUsers({ WECODE_USER: '  "solo"  ' }), ['solo']);
  assert.deepEqual(wecodeUsers({ WECODE_USER: 'env-user' }, 'x,y'), ['x', 'y']);
  assert.deepEqual(wecodeUsers({}), []);
});

test('wecodeProxy reads WECODE_PROXY', () => {
  assert.equal(wecodeProxy({ WECODE_PROXY: 'http://localhost:9090' }), 'http://localhost:9090');
  assert.equal(wecodeProxy({}), '');
});

test('parseWecodeQuota maps quota/usage to a billing window', () => {
  const parsed = parseWecodeQuota(SAMPLE_RESPONSE);
  assert.equal(parsed.username, 'weiwei33');
  assert.equal(parsed.windows.length, 1);
  const window = parsed.windows[0];
  assert.equal(window.kind, 'billing');
  assert.equal(window.used, 30.38676965);
  assert.equal(window.limit, 743);
  assert.ok(Math.abs(window.remaining - 712.61323035) < 1e-9);
  assert.ok(Math.abs(window.usedPercent - 4.09) < 0.01);
});

test('parseWecodeQuota falls back to user_usage_rate when quota is missing', () => {
  const parsed = parseWecodeQuota({ user_usage_rate: 0.5, username: 'x' });
  assert.equal(parsed.windows[0].usedPercent, 50);
  assert.equal(parsed.windows[0].used, null);
});

test('parseWecodeQuota returns no windows for an empty body', () => {
  assert.deepEqual(parseWecodeQuota({}).windows, []);
  assert.deepEqual(parseWecodeQuota(null).windows, []);
});

test('fetchWecodeLimits reports notConfigured without a username', async () => {
  const provider = await fetchWecodeLimits({}, { env: {}, now: () => 0 });
  assert.equal(provider.provider, 'wecode');
  assert.equal(provider.status, 'notConfigured');
  assert.deepEqual(provider.windows, []);
});

test('fetchWecodeLimits returns one provider per configured user', async () => {
  const calls = [];
  const providers = await fetchWecodeLimits({}, {
    env: { WECODE_USER: 'weiwei33,teammate', WECODE_PROXY: 'http://localhost:9090' },
    now: () => 1_700_000_000_000,
    postWecodeQuota: async (user, options) => {
      calls.push({ user, proxyUrl: options.proxyUrl });
      return {
        status: 200,
        text: JSON.stringify({ ...SAMPLE_RESPONSE, username: user })
      };
    }
  });
  assert.deepEqual(calls.map((call) => call.user), ['weiwei33', 'teammate']);
  assert.ok(calls.every((call) => call.proxyUrl === 'http://localhost:9090'));
  assert.equal(providers.length, 2);
  assert.equal(providers[0].status, 'ok');
  assert.equal(providers[0].accountKey, hashKey('wecode', 'weiwei33'));
  assert.equal(providers[0].accountName, 'weiwei33');
  assert.equal(providers[1].accountName, 'teammate');
  assert.notEqual(providers[0].accountKey, providers[1].accountKey);
  assert.equal(providers[0].source, 'api');
  assert.equal(providers[0].windows.length, 1);
  assert.equal(providers[0].windows[0].kind, 'billing');
  assert.equal(providers[0].windows[0].limit, 743);
});

test('fetchWecodeLimits keeps other accounts when one user fails', async () => {
  const providers = await fetchWecodeLimits({}, {
    env: { WECODE_USER: 'good,bad' },
    now: () => 0,
    postWecodeQuota: async (user) => {
      if (user === 'bad') throw new Error('ECONNREFUSED');
      return { status: 200, text: JSON.stringify(SAMPLE_RESPONSE) };
    }
  });
  assert.equal(providers.length, 2);
  assert.equal(providers[0].status, 'ok');
  assert.equal(providers[1].status, 'unavailable');
  assert.equal(providers[1].accountName, 'bad');
});

test('fetchWecodeLimits maps HTTP failures to provider statuses', async () => {
  const statusFor = async (httpStatus) => {
    const [provider] = await fetchWecodeLimits({}, {
      env: { WECODE_USER: 'weiwei33' },
      now: () => 0,
      postWecodeQuota: async () => ({ status: httpStatus, text: '' })
    });
    return provider.status;
  };
  assert.equal(await statusFor(401), 'unauthorized');
  assert.equal(await statusFor(429), 'sourceRateLimited');
  assert.equal(await statusFor(500), 'unavailable');
});
