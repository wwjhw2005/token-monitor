'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { aggregateLimits, publicLimits, syncLimits } = require('../../src/shared/limits');
const { collectLimitsOnce } = require('../../src/shared/limitCollector');

function codexProvider(accountKey, accountEmail, remainingPercent, updatedAt) {
  return {
    provider: 'codex',
    accountKey,
    accountEmail,
    accountLabel: 'Plus',
    status: 'ok',
    source: 'rpc',
    sourceDetail: 'managed',
    updatedAt,
    windows: [
      {
        kind: 'session',
        usedPercent: 100 - remainingPercent,
        remainingPercent,
        resetsAt: '2026-06-14T18:00:00.000Z',
        windowMinutes: 300
      }
    ]
  };
}

test('aggregateLimits preserves distinct Codex accounts by hashed account key', () => {
  const aggregate = aggregateLimits([
    {
      deviceId: 'macbook',
      limits: {
        updatedAt: '2026-06-14T10:00:00.000Z',
        providers: [
          codexProvider('sha256:codex-a', 'a@example.com', 18, '2026-06-14T10:00:00.000Z'),
          codexProvider('sha256:codex-b', 'b@example.com', 72, '2026-06-14T10:01:00.000Z')
        ]
      }
    }
  ], 0, Date.parse('2026-06-14T10:02:00.000Z'));

  const codexProviders = aggregate.providers.filter((provider) => provider.provider === 'codex');
  assert.equal(codexProviders.length, 2);
  assert.deepEqual(
    new Set(codexProviders.map((provider) => provider.accountKey)),
    new Set(['sha256:codex-a', 'sha256:codex-b'])
  );
  assert.deepEqual(
    new Set(codexProviders.map((provider) => provider.accountEmail)),
    new Set(['a@example.com', 'b@example.com'])
  );
});

test('aggregateLimits merges the same Codex account across devices and keeps distinct ones', () => {
  const aggregate = aggregateLimits([
    {
      deviceId: 'macbook',
      limits: {
        updatedAt: '2026-06-14T10:01:00.000Z',
        providers: [
          codexProvider('sha256:codex-a', 'a@example.com', 18, '2026-06-14T10:00:00.000Z'),
          codexProvider('sha256:codex-b', 'b@example.com', 72, '2026-06-14T10:01:00.000Z')
        ]
      }
    },
    {
      deviceId: 'desktop',
      limits: {
        updatedAt: '2026-06-14T10:05:00.000Z',
        providers: [
          codexProvider('sha256:codex-a', 'a@example.com', 50, '2026-06-14T10:05:00.000Z'),
          codexProvider('sha256:codex-c', 'c@example.com', 30, '2026-06-14T10:03:00.000Z')
        ]
      }
    }
  ], 0, Date.parse('2026-06-14T10:06:00.000Z'));

  const codexProviders = aggregate.providers.filter((provider) => provider.provider === 'codex');
  assert.deepEqual(
    new Set(codexProviders.map((provider) => provider.accountKey)),
    new Set(['sha256:codex-a', 'sha256:codex-b', 'sha256:codex-c'])
  );
  // The account both devices report merges into one, keeping the freshest snapshot.
  const accountA = codexProviders.find((provider) => provider.accountKey === 'sha256:codex-a');
  assert.equal(accountA.windows[0].remainingPercent, 50);
  assert.equal(accountA.sourceDeviceId, 'desktop');
});

test('syncLimits carries Codex account key, email and plan label to the authenticated hub', () => {
  const payload = syncLimits({
    updatedAt: '2026-06-14T10:00:00.000Z',
    providers: [
      codexProvider('sha256:codex-a', 'a@example.com', 18, '2026-06-14T10:00:00.000Z')
    ]
  });

  assert.equal(payload.providers.length, 1);
  assert.equal(payload.providers[0].provider, 'codex');
  assert.equal(payload.providers[0].accountKey, 'sha256:codex-a');
  assert.equal(payload.providers[0].accountEmail, 'a@example.com');
  assert.equal(payload.providers[0].accountLabel, 'Plus');
});

test('publicLimits strips Codex account keys and local-only email', () => {
  const payload = publicLimits({
    updatedAt: '2026-06-14T10:00:00.000Z',
    providers: [
      codexProvider('sha256:codex-a', 'a@example.com', 18, '2026-06-14T10:00:00.000Z')
    ]
  });

  assert.equal(payload.providers.length, 1);
  assert.equal(payload.providers[0].provider, 'codex');
  assert.equal(Object.hasOwn(payload.providers[0], 'accountKey'), false);
  assert.equal(Object.hasOwn(payload.providers[0], 'accountEmail'), false);
});

test('collectLimitsOnce flattens multiple providers returned by a provider fetcher', async () => {
  const summary = await collectLimitsOnce({ limitProviders: 'codex' }, {
    now: () => Date.parse('2026-06-14T10:02:00.000Z'),
    providerFetchers: {
      codex: async () => [
        codexProvider('sha256:codex-a', 'a@example.com', 18, '2026-06-14T10:00:00.000Z'),
        codexProvider('sha256:codex-b', 'b@example.com', 72, '2026-06-14T10:01:00.000Z')
      ]
    }
  });

  assert.equal(summary.providers.length, 2);
  assert.deepEqual(
    new Set(summary.providers.map((provider) => provider.accountKey)),
    new Set(['sha256:codex-a', 'sha256:codex-b'])
  );
});
