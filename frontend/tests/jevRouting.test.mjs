import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBundled } from './bundle.mjs';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

const m = await loadBundled(`
  export { JevRoutingRow, jevStatus, JEV_PRESETS } from './src/components/JevRouting';
  export { routeReasonText } from './src/routeReason';
  export { renderToStaticMarkup } from 'react-dom/server.browser';
  export { createElement } from 'react';
`);

const view = (over = {}) => ({
  enabled: false,
  url: 'https://opencode.ai/inference/systemone/v1/systemone',
  api_key: '',
  model: 'jev-1.13-free',
  active: false,
  default_url: 'https://opencode.ai/inference/systemone/v1/systemone',
  default_model: 'jev-1.13-free',
  ...over,
});

test('the status line says whether Jev routes and what it needs', () => {
  assert.equal(m.jevStatus(null), 'Loading…');
  assert.match(m.jevStatus(view()), /add an API key/);
  assert.match(m.jevStatus(view({ api_key: '••••••••' })), /^Off/);
  assert.match(m.jevStatus(view({ enabled: true, api_key: '••••••••', active: true })), /^On · jev-1\.13-free/);
});

test('the row offers presets, a masked key field and says what is sent', () => {
  const html = m.renderToStaticMarkup(m.createElement(m.JevRoutingRow));
  assert.match(html, /role="switch"/);
  assert.match(html, /type="password"/);
  for (const p of m.JEV_PRESETS) assert.ok(html.includes(p.label), p.label);
  assert.match(html, /sent to the URL below/);
});

test('a Jev pick shows the server’s sentence', () => {
  const text = m.routeReasonText({ kwantName: '小装', basis: 'jev', reason: 'Jev matched this to 小装 (装修顾问), 96% sure' });
  assert.equal(text, 'Jev matched this to 小装 (装修顾问), 96% sure.');
});
