'use strict';

// Grok Build 0.4+ writes a stable per-turn usage breakdown to updates.jsonl,
// but tokscale 4.5.3 still follows the older cumulative-context counters and
// emits every Grok token as input. Reconcile those rows locally until the
// upstream parser consumes the stable usage object.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fileCache = new Map();

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function costUsd(value) {
  const ticks = Number(value || 0);
  return Number.isFinite(ticks) && ticks > 0 ? ticks / 1e10 : 0;
}

function normalizeModel(value) {
  const model = String(value || '').trim().toLowerCase();
  if (!model) return 'grok-unknown';
  // The API usage payload calls the served model `grok-4.5-build`, while the
  // session metadata and tokscale row call the same model `grok-4.5`.
  return model.startsWith('grok-') && model.endsWith('-build')
    ? model.slice(0, -'-build'.length)
    : model;
}

function usageRows(usage, fallbackModel) {
  if (!usage || typeof usage !== 'object') return [];
  const modelUsage = usage.modelUsage && typeof usage.modelUsage === 'object'
    ? Object.entries(usage.modelUsage)
    : [];
  const sources = modelUsage.length > 0 ? modelUsage : [[fallbackModel, usage]];
  return sources.map(([model, value]) => {
    const inputTotal = numberValue(value?.inputTokens ?? value?.input_tokens);
    const cacheRead = Math.min(inputTotal, numberValue(
      value?.cachedReadTokens ?? value?.cacheReadTokens ?? value?.cache_read_tokens
    ));
    const cacheWrite = Math.min(
      Math.max(0, inputTotal - cacheRead),
      numberValue(value?.cachedWriteTokens ?? value?.cacheWriteTokens ?? value?.cache_write_tokens)
    );
    return {
      model: normalizeModel(model || fallbackModel),
      input: Math.max(0, inputTotal - cacheRead - cacheWrite),
      output: numberValue(value?.outputTokens ?? value?.output_tokens),
      cacheRead,
      cacheWrite,
      reasoning: numberValue(value?.reasoningTokens ?? value?.reasoning_tokens),
      cost: costUsd(value?.costUsdTicks ?? value?.cost_usd_ticks)
    };
  });
}

function summaryModel(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(path.dirname(filePath), 'summary.json'), 'utf8'));
    return normalizeModel(value.current_model_id || value.currentModelId || value.model_id || value.modelId);
  } catch (_) {
    return 'grok-unknown';
  }
}

function parseUpdatesFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return [];
  }
  const cacheKey = `${stat.size}:${stat.mtimeMs}`;
  const cached = fileCache.get(filePath);
  if (cached?.key === cacheKey) return cached.turns;

  const fallbackSessionId = path.basename(path.dirname(filePath));
  const fallbackModel = summaryModel(filePath);
  const turns = new Map();
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return [];
  }

  for (const line of String(content).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      const params = value?.params;
      const update = params?.update;
      if (!update || update.sessionUpdate !== 'turn_completed') continue;
      const sessionId = String(params.sessionId || fallbackSessionId || '').trim();
      if (!sessionId) continue;
      const promptId = String(update.prompt_id || update.promptId || `${value.timestamp || ''}:${turns.size}`);
      const timestamp = timestampMs(value.timestamp);
      const usage = update.usage;
      const turn = {
        sessionId,
        promptId,
        timestamp,
        hasUsage: Boolean(usage && typeof usage === 'object'),
        rows: usageRows(usage, fallbackModel)
      };
      const key = `${sessionId}\u0000${promptId}`;
      const previous = turns.get(key);
      if (!previous || turn.timestamp >= previous.timestamp) turns.set(key, turn);
    } catch (_) {
      // Ignore incomplete lines while Grok is appending to an active session.
    }
  }

  const result = [...turns.values()];
  fileCache.set(filePath, { key: cacheKey, turns: result });
  return result;
}

function updateFiles(root) {
  const files = [];
  let workspaces;
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return files;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const workspacePath = path.join(root, workspace.name);
    let sessions;
    try {
      sessions = fs.readdirSync(workspacePath, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const filePath = path.join(workspacePath, session.name, 'updates.jsonl');
      try {
        if (fs.statSync(filePath).isFile()) files.push(filePath);
      } catch (_) {}
    }
  }
  return files;
}

function resolveRoots(options = {}) {
  if (Array.isArray(options.roots)) return options.roots;
  if (options.root) return [options.root];
  const grokHome = options.grokHome
    || process.env.GROK_HOME
    || path.join(options.homeDir || os.homedir(), '.grok');
  return [path.join(grokHome, 'sessions')];
}

function collectGrokTurns(options = {}) {
  const turns = [];
  for (const root of resolveRoots(options)) {
    for (const filePath of updateFiles(root)) turns.push(...parseUpdatesFile(filePath));
  }
  return turns;
}

function aggregateWindow(turns, sinceMs) {
  const bySession = new Map();
  for (const turn of turns) {
    if (!turn.timestamp || (sinceMs && turn.timestamp < sinceMs)) continue;
    if (!bySession.has(turn.sessionId)) bySession.set(turn.sessionId, []);
    bySession.get(turn.sessionId).push(turn);
  }

  const sessions = new Map();
  for (const [sessionId, sessionTurns] of bySession) {
    const withUsage = sessionTurns.filter((turn) => turn.hasUsage);
    if (withUsage.length === 0) continue;
    const models = new Map();
    for (const turn of withUsage) {
      turn.rows.forEach((row, index) => {
        if (!models.has(row.model)) {
          models.set(row.model, {
            client: 'grok', sessionId, model: row.model,
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
            messageCount: 0, cost: 0, startedAt: '', lastUsedAt: ''
          });
        }
        const target = models.get(row.model);
        target.input += row.input;
        target.output += row.output;
        target.cacheRead += row.cacheRead;
        target.cacheWrite += row.cacheWrite;
        target.reasoning += row.reasoning;
        target.cost += row.cost;
        if (index === 0) target.messageCount += 1;
        if (!target.startedAt || turn.timestamp < Date.parse(target.startedAt)) {
          target.startedAt = new Date(turn.timestamp).toISOString();
        }
        if (!target.lastUsedAt || turn.timestamp > Date.parse(target.lastUsedAt)) {
          target.lastUsedAt = new Date(turn.timestamp).toISOString();
        }
      });
    }
    sessions.set(sessionId, {
      complete: withUsage.length === sessionTurns.length,
      rows: [...models.values()]
    });
  }
  return { sessions };
}

function buildGrokReconciliations(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const turns = Array.isArray(options.turns) ? options.turns : collectGrokTurns(options);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const allTimeStart = timestampMs(options.allTimeSince);
  return {
    today: aggregateWindow(turns, todayStart),
    month: aggregateWindow(turns, monthStart),
    allTime: aggregateWindow(turns, allTimeStart)
  };
}

function rowClient(row) {
  return String(row?.client || row?.source || row?.platform || '').trim().toLowerCase();
}

function rowSessionId(row) {
  return String(row?.sessionId || row?.session_id || row?.session || '').trim();
}

function rowTokens(row) {
  return numberValue(row?.input) + numberValue(row?.output)
    + numberValue(row?.cacheRead) + numberValue(row?.cacheWrite);
}

function reconcileGrokJson(json, reconciliation) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.entries) || !reconciliation?.sessions) return json;
  const original = json.entries;
  const grokBySession = new Map();
  for (const row of original) {
    if (!rowClient(row).includes('grok')) continue;
    const sessionId = rowSessionId(row);
    if (!sessionId) continue;
    if (!grokBySession.has(sessionId)) grokBySession.set(sessionId, []);
    grokBySession.get(sessionId).push(row);
  }

  const replaceIds = new Set();
  for (const [sessionId, exact] of reconciliation.sessions) {
    if (exact.complete || !grokBySession.has(sessionId)) replaceIds.add(sessionId);
  }
  const entries = original.filter((row) => {
    if (!rowClient(row).includes('grok')) return true;
    return !replaceIds.has(rowSessionId(row));
  });

  for (const [sessionId, exact] of reconciliation.sessions) {
    const oldRows = grokBySession.get(sessionId) || [];
    const replacing = replaceIds.has(sessionId);
    const oldCost = oldRows.reduce((sum, row) => sum + Number(row.cost || 0), 0);
    const exactTotal = exact.rows.reduce((sum, row) => sum + rowTokens(row), 0);
    const exactCost = exact.rows.reduce((sum, row) => sum + Number(row.cost || 0), 0);
    for (const row of exact.rows) {
      const template = oldRows.find((old) => normalizeModel(old.model) === row.model) || oldRows[0] || {};
      if (replacing) {
        entries.push({
          ...template,
          ...row,
          cost: exactCost > 0
            ? row.cost
            : (exactTotal > 0 ? oldCost * (rowTokens(row) / exactTotal) : 0)
        });
      } else {
        // A mixed-format session has completed turns without a stable usage
        // object. Preserve tokscale's aggregate input for those turns and add
        // only categories that the new records prove.
        entries.push({
          ...row,
          input: 0,
          messageCount: 0,
          cost: Math.max(0, row.cost - (
            numberValue(template.input) > 0
              ? row.input * (Number(template.cost || 0) / numberValue(template.input))
              : 0
          ))
        });
      }
    }
  }

  return {
    ...json,
    entries,
    totalInput: entries.reduce((sum, row) => sum + numberValue(row.input), 0),
    totalOutput: entries.reduce((sum, row) => sum + numberValue(row.output), 0),
    totalCacheRead: entries.reduce((sum, row) => sum + numberValue(row.cacheRead), 0),
    totalCacheWrite: entries.reduce((sum, row) => sum + numberValue(row.cacheWrite), 0),
    totalMessages: entries.reduce((sum, row) => sum + numberValue(row.messageCount ?? row.messages), 0),
    totalCost: entries.reduce((sum, row) => sum + Number(row.cost || 0), 0)
  };
}

function resetGrokUsageCache() {
  fileCache.clear();
}

module.exports = {
  aggregateWindow,
  buildGrokReconciliations,
  collectGrokTurns,
  normalizeModel,
  parseUpdatesFile,
  reconcileGrokJson,
  resetGrokUsageCache,
  timestampMs,
  usageRows
};
