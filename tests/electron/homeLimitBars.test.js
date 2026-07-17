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
  assert.match(app, /return 'var\(--green\)'/);
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
