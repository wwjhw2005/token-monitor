'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildGrokReconciliations,
  collectGrokTurns,
  reconcileGrokJson,
  resetGrokUsageCache
} = require('../../src/shared/grokUsage');
const { extractUsageFromTokscale } = require('../../src/shared/usage');
const { collectUsageOnce, localTodayKey } = require('../../src/shared/collector');

function writeSession(root, sessionId, turns, model = 'grok-4.5') {
  const dir = path.join(root, 'workspace', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ current_model_id: model }));
  fs.writeFileSync(
    path.join(dir, 'updates.jsonl'),
    `${turns.map((turn) => JSON.stringify(turn)).join('\n')}\n`
  );
}

function completedTurn({ sessionId, promptId, timestamp, usage }) {
  return {
    timestamp: timestamp / 1000,
    method: '_x.ai/session/update',
    params: {
      sessionId,
      update: {
        prompt_id: promptId,
        sessionUpdate: 'turn_completed',
        stop_reason: 'end_turn',
        ...(usage ? { usage } : {})
      }
    }
  };
}

function usage({ input, output, cacheRead, cost = 0, model = 'grok-4.5-build' }) {
  const value = {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cachedReadTokens: cacheRead,
    reasoningTokens: 3,
    ...(cost > 0 ? { costUsdTicks: cost * 1e10 } : {})
  };
  return { ...value, modelUsage: { [model]: value } };
}

function tokscaleJson(sessionId, input = 50) {
  return {
    groupBy: 'client,session,model',
    entries: [{
      client: 'grok', sessionId, model: 'grok-4.5', input,
      output: 0, cacheRead: 0, cacheWrite: 0,
      messageCount: 2, cost: input * 0.000002
    }]
  };
}

test('Grok reconciliation replaces complete new-format sessions with exact token categories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-usage-'));
  const now = new Date(2026, 6, 9, 12).getTime();
  const sessionId = 'session-complete';
  writeSession(root, sessionId, [
    completedTurn({ sessionId, promptId: 'p1', timestamp: now - 2000, usage: usage({ input: 100, output: 10, cacheRead: 80, cost: 0.00011 }) }),
    completedTurn({ sessionId, promptId: 'p2', timestamp: now - 1000, usage: usage({ input: 50, output: 5, cacheRead: 30, cost: 0.000055 }) })
  ]);

  resetGrokUsageCache();
  const reconciliation = buildGrokReconciliations({ now, allTimeSince: '2026-01-01', root });
  const patched = reconcileGrokJson(tokscaleJson(sessionId), reconciliation.today);
  const period = extractUsageFromTokscale(patched);

  assert.equal(patched.entries.length, 1);
  assert.equal(patched.entries[0].model, 'grok-4.5');
  assert.equal(patched.entries[0].input, 40);
  assert.equal(patched.entries[0].output, 15);
  assert.equal(patched.entries[0].cacheRead, 110);
  assert.equal(patched.totalInput, 40);
  assert.equal(patched.totalOutput, 15);
  assert.equal(patched.totalCacheRead, 110);
  assert.equal(period.totalTokens, 165);
  assert.equal(period.outputTokens, 15);
  assert.equal(period.cacheReadTokens, 110);
  assert.equal(period.clients.grok, 165);
  assert.equal(period.models['grok-4.5'], 165);
  assert.equal(period.sessions[`grok:${sessionId}`].messageCount, 2);
  assert.ok(Math.abs(period.costUsd - 0.000165) < 1e-12, 'provider-reported cost replaces input-only tokscale cost');
});

test('Grok reconciliation supplements mixed old/new sessions without dropping old turns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-usage-'));
  const now = new Date(2026, 6, 9, 12).getTime();
  const sessionId = 'session-mixed';
  writeSession(root, sessionId, [
    completedTurn({ sessionId, promptId: 'old', timestamp: now - 2000 }),
    completedTurn({ sessionId, promptId: 'new', timestamp: now - 1000, usage: usage({ input: 100, output: 5, cacheRead: 80, cost: 0.0002 }) })
  ]);

  resetGrokUsageCache();
  const reconciliation = buildGrokReconciliations({ now, allTimeSince: '2026-01-01', root });
  assert.equal(reconciliation.today.sessions.get(sessionId).complete, false);
  const patched = reconcileGrokJson(tokscaleJson(sessionId, 60), reconciliation.today);
  const period = extractUsageFromTokscale(patched);

  assert.equal(patched.entries.length, 2);
  assert.equal(period.totalTokens, 145);
  assert.equal(period.cacheReadTokens, 80);
  assert.equal(period.outputTokens, 5);
  assert.equal(period.sessions[`grok:${sessionId}`].messageCount, 2);
  // tokscale's $0.00012 covers fresh input for both turns. Subtract the new
  // turn's $0.00004 fresh-input share from its provider-reported $0.0002,
  // then supplement only the remaining output/cache cost.
  assert.ok(Math.abs(period.costUsd - 0.00028) < 1e-12);
});

test('Grok reconciliation filters turns independently for today, month, and all-time', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-usage-'));
  const now = new Date(2026, 6, 9, 12).getTime();
  const today = new Date(2026, 6, 9, 10).getTime();
  const thisMonth = new Date(2026, 6, 2, 10).getTime();
  const beforeCutoff = new Date(2025, 11, 31, 10).getTime();
  writeSession(root, 'today', [completedTurn({ sessionId: 'today', promptId: 'p1', timestamp: today, usage: usage({ input: 10, output: 1, cacheRead: 5 }) })]);
  writeSession(root, 'month', [completedTurn({ sessionId: 'month', promptId: 'p2', timestamp: thisMonth, usage: usage({ input: 20, output: 2, cacheRead: 10 }) })]);
  writeSession(root, 'old', [completedTurn({ sessionId: 'old', promptId: 'p3', timestamp: beforeCutoff, usage: usage({ input: 30, output: 3, cacheRead: 15 }) })]);

  resetGrokUsageCache();
  const result = buildGrokReconciliations({ now, allTimeSince: '2026-01-01', root });
  assert.deepEqual([...result.today.sessions.keys()], ['today']);
  assert.deepEqual([...result.month.sessions.keys()].sort(), ['month', 'today']);
  assert.deepEqual([...result.allTime.sessions.keys()].sort(), ['month', 'today']);
});

test('Grok parser deduplicates repeated prompt completions and ignores malformed lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-usage-'));
  const now = new Date(2026, 6, 9, 12).getTime();
  const sessionId = 'session-duplicate';
  const dir = path.join(root, 'workspace', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ current_model_id: 'grok-4.5' }));
  const first = completedTurn({ sessionId, promptId: 'same', timestamp: now - 2000, usage: usage({ input: 10, output: 1, cacheRead: 5 }) });
  const latest = completedTurn({ sessionId, promptId: 'same', timestamp: now - 1000, usage: usage({ input: 20, output: 2, cacheRead: 10 }) });
  fs.writeFileSync(path.join(dir, 'updates.jsonl'), `${JSON.stringify(first)}\n{unfinished\n${JSON.stringify(latest)}\n`);

  resetGrokUsageCache();
  const turns = collectGrokTurns({ root });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].rows[0].input, 10);
  assert.equal(turns[0].rows[0].output, 2);
  assert.equal(turns[0].rows[0].cacheRead, 10);
});

test('collector reconciles Grok usage before deriving anchored month and all-time periods', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-usage-'));
  const now = new Date(2026, 6, 9, 12).getTime();
  const sessionId = 'session-anchor';
  writeSession(root, sessionId, [
    completedTurn({ sessionId, promptId: 'p1', timestamp: now - 1000, usage: usage({ input: 100, output: 10, cacheRead: 80 }) })
  ]);
  const runTokscale = async () => tokscaleJson(sessionId, 25);
  const baseOptions = {
    clients: 'grok', allTimeSince: '2026-01-01', commandTimeoutMs: 1000,
    deviceId: 'grok-test', agentVersion: 'test', now,
    grokUsageRoot: root, runTokscale, limitsEnabled: false, historyEnabled: false,
    wslScanEnabled: false
  };

  resetGrokUsageCache();
  const first = await collectUsageOnce(baseOptions);
  assert.equal(first.today.totalTokens, 110);
  assert.equal(first.today.cacheReadTokens, 80);
  assert.equal(first.today.outputTokens, 10);

  writeSession(root, sessionId, [
    completedTurn({ sessionId, promptId: 'p1', timestamp: now - 2000, usage: usage({ input: 100, output: 10, cacheRead: 80 }) }),
    completedTurn({ sessionId, promptId: 'p2', timestamp: now - 1000, usage: usage({ input: 50, output: 5, cacheRead: 30 }) })
  ]);
  const anchor = {
    dateKey: localTodayKey(new Date(now)),
    today: first.today,
    month: { ...first.month, totalTokens: 500, clients: { grok: 500 } },
    allTime: { ...first.allTime, totalTokens: 1000, clients: { grok: 1000 } }
  };
  const next = await collectUsageOnce({ ...baseOptions, todayOnlyAnchor: anchor });
  assert.equal(next.today.totalTokens, 165);
  assert.equal(next.today.cacheReadTokens, 110);
  assert.equal(next.today.outputTokens, 15);
  assert.equal(next.month.totalTokens, 555);
  assert.equal(next.allTime.totalTokens, 1055);
});
