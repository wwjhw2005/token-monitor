'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('Home showHomeLimitBars field stays read-tolerant in main.js (decision A: renderer UI removed, field kept)', () => {
  const main = read('src/electron/main.js');
  const app = read('src/electron/renderer/app.js');

  // Decision A: main.js keeps the field as read-tolerant backward-compat
  // (old settings carrying it must not error); the renderer checkbox UI is gone.
  assert.match(main, /showHomeLimitBars:\s*false/);
  assert.match(main, /merged\.showHomeLimitBars = parseBoolean\(merged\.showHomeLimitBars, false\)/);
  assert.match(main, /showHomeLimitBars:\s*parseBoolean\(patch\.showHomeLimitBars \?\? settings\.showHomeLimitBars, false\)/);
  // The renderer no longer wires a checkbox to showHomeLimitBars.
  assert.doesNotMatch(app, /showHomeLimitBars/);
});

test('Home limit meter shows a three-tone progress bar keyed on remaining quota', () => {
  const app = read('src/electron/renderer/app.js');
  const css = read('src/electron/renderer/styles.css');

  // Shared single-colour meter stays untouched (Limits panel still uses it).
  assert.match(app, /function limitMeterNode\(color, percent, tone = 1\)/);
  assert.match(app, /const meter = limitMeterNode\(color, fillPercent, tone\)/);
  // Home-only three-tone meter: colour by remaining, fill width by used.
  assert.match(app, /function homeLimitMeterColor\(remainingPercent\)/);
  assert.match(app, /if \(remaining < 10\) return 'var\(--red\)'/);
  assert.match(app, /if \(remaining < 30\) return 'var\(--yellow\)'/);
  assert.match(app, /return 'var\(--success\)'/);
  assert.doesNotMatch(app, /var\(--green\)/);
  assert.match(css, /--success:\s*#[0-9a-f]+/i);
  assert.match(app, /function homeLimitMeterNode\(window\)/);
  assert.match(app, /'home-limit-meter'/);
  assert.match(app, /'home-limit-meter-fill'/);
  assert.match(app, /const meter = homeLimitMeterNode\(window\)/);
  // Progress bar renders unconditionally (no showHomeLimitBars gate).
  assert.doesNotMatch(app, /state\.settings\?\.showHomeLimitBars === true && window\.remainingPercent != null/);
  // Value-text tone thresholds unified with the bar: < 10 critical, < 30 low.
  assert.match(app, /remainingPercent < 10/);
  assert.match(app, /value\.classList\.add\('home-limit-value-critical'\)/);
  assert.match(app, /remainingPercent < 30/);
  assert.match(app, /value\.classList\.add\('home-limit-value-low'\)/);
  assert.match(app, /line\.append\(label, value\)/);
  // CSS: independent home-limit-meter classes (not sharing .limit-meter).
  assert.match(css, /\.home-limit-meter\s*\{/);
  assert.match(css, /\.home-limit-meter-fill\s*\{[^}]*transform:\s*scaleX\(var\(--bar-scale/s);
  assert.match(css, /\.home-limit-value-low\s*\{[^}]*--home-limit-accent/s);
  assert.match(css, /\.home-limit-value-critical\s*\{[^}]*color:\s*var\(--red\)/s);
  assert.match(css, /\.home-limit-value-critical::before\s*\{[^}]*width:\s*4px;[^}]*height:\s*4px;/s);
  // reduced-motion covers the home meter fill too.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.limit-meter-fill,[\s\S]*?\.home-limit-meter-fill,[\s\S]*?\.tab-indicator\s*\{[^}]*transition:\s*none;/);
});

test('Home low-limit indicator setting is translated in every locale', () => {
  const { MESSAGES } = require('../../src/electron/renderer/i18n');
  for (const [locale, messages] of Object.entries(MESSAGES)) {
    assert.ok(messages['settings.home.showLimitBars'], `${locale} should translate the Home limit bar setting`);
  }
});

test('Home multi-account provider names are opt-in and persist through the settings boundary', () => {
  const main = read('src/electron/main.js');
  const app = read('src/electron/renderer/app.js');
  const css = read('src/electron/renderer/styles.css');

  assert.match(main, /showHomeLimitProviderNames:\s*false/);
  assert.match(main, /merged\.showHomeLimitProviderNames = parseBoolean\(merged\.showHomeLimitProviderNames, false\)/);
  assert.match(main, /showHomeLimitProviderNames:\s*parseBoolean\(patch\.showHomeLimitProviderNames \?\? settings\.showHomeLimitProviderNames, false\)/);
  assert.match(app, /providerEntries\.length > 1/);
  assert.match(app, /homeLimitAccountTitle\(id, provider, index\)/);
  assert.match(app, /state\.settings\?\.showHomeLimitProviderNames === true \|\| state\.settings\?\.showToolIcons === false/);
  assert.match(app, /`\$\{providerTitle\} · \$\{accountTitle\}`/);
  assert.match(app, /const providerNamesRequired = state\.settings\?\.showToolIcons === false/);
  assert.match(app, /providerNamesInput\.checked = providerNamesRequired \|\| state\.settings\?\.showHomeLimitProviderNames === true/);
  assert.match(app, /providerNamesInput\.disabled = providerNamesRequired/);
  assert.match(app, /settings\.home\.providerNamesRequiredWithoutIcons/);
  assert.match(app, /requiredReasonText\.className = 'home-limit-provider-names-reason'/);
  assert.match(app, /providerNamesInput\.setAttribute\('aria-describedby', requiredReasonText\.id\)/);
  assert.match(css, /\.home-limit-provider-names-copy\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.home-limit-provider-names-reason\s*\{[^}]*font-size:\s*10px/s);
  assert.match(app, /saveSettings\(\{ showHomeLimitProviderNames: providerNamesInput\.checked \}\)/);
  assert.match(app, /renderHomeIfVisible\(\)/);
  assert.match(app, /els\.toolIconsInput\.addEventListener\('change', async \(\) => \{\s*state\.settings\.showToolIcons = els\.toolIconsInput\.checked;\s*renderHomeIfVisible\(\);\s*await saveAppearanceFromControls\(\);\s*\}\);/);
});

test('Home provider name setting is translated in every locale', () => {
  const { MESSAGES } = require('../../src/electron/renderer/i18n');
  const expected = {
    en: 'Show provider names for multiple accounts',
    'zh-TW': '多帳號顯示提供者名稱',
    'zh-CN': '多账号显示提供商名称',
    ko: '여러 계정에 제공업체 이름 표시',
    ja: '複数アカウントでプロバイダー名を表示'
  };
  for (const [locale, label] of Object.entries(expected)) {
    assert.equal(MESSAGES[locale]['settings.home.showLimitProviderNames'], label);
    assert.ok(MESSAGES[locale]['settings.home.providerNamesRequiredWithoutIcons']);
  }
});

test('Home account display count defaults to three and is configurable', () => {
  const main = read('src/electron/main.js');
  const app = read('src/electron/renderer/app.js');
  const html = read('src/electron/renderer/index.html');

  assert.match(main, /HOME_LIMIT_ACCOUNT_COUNT_DEFAULT = 3/);
  assert.match(main, /homeLimitAccountCount: HOME_LIMIT_ACCOUNT_COUNT_DEFAULT/);
  assert.match(main, /merged\.homeLimitAccountCount = normalizeHomeLimitAccountCount\(merged\.homeLimitAccountCount\)/);
  assert.match(main, /homeLimitAccountCount: normalizeHomeLimitAccountCount\(patch\.homeLimitAccountCount \?\? settings\.homeLimitAccountCount\)/);
  assert.match(app, /limit: state\.settings\?\.homeLimitAccountCount \?\? 3/);
  const renderSettings = app.slice(app.indexOf('function renderHomeLimitProviderList'), app.indexOf('function renderHomeSettingsList'));
  assert.match(renderSettings, /countInput\.type = 'number'/);
  assert.match(renderSettings, /countInput\.min = '1'/);
  assert.match(renderSettings, /countInput\.max = '12'/);
  assert.match(renderSettings, /saveSettings\(\{ homeLimitAccountCount: Number\(countInput\.value\) \}\)/);
  assert.doesNotMatch(html, /homeLimitAccountCountInput|settings\.limits\.homeAccountCount/);
});

test('Home account display count setting is translated in every locale', () => {
  const { MESSAGES } = require('../../src/electron/renderer/i18n');
  for (const [locale, messages] of Object.entries(MESSAGES)) {
    assert.ok(messages['settings.home.limitAccountCount'], `${locale} should translate the Home account count setting`);
  }
});
