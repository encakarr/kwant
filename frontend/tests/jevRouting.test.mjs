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

test('with Jev on, screens say Jev picks the model instead of Laya', async () => {
  const s = await loadBundled(`
    export { loadJevActive, jevActive, autoPicker } from './src/jevStatus';
    export { engineTip } from './src/engines';
  `);
  const answer = (active) => async () => ({ ok: true, json: async () => ({ active }) });
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = answer(false);
    assert.equal(await s.loadJevActive(), false);
    assert.equal(s.autoPicker(), 'Laya');
    assert.equal(s.engineTip('auto'), 'Laya picks the model');
    globalThis.fetch = answer(true);
    assert.equal(await s.loadJevActive(), true);
    assert.equal(s.jevActive(), true);
    assert.equal(s.autoPicker(), 'Jev');
    assert.equal(s.engineTip('auto'), 'Jev picks the model');
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await s.loadJevActive(), false, 'a server it can’t reach means Laya');
  } finally {
    globalThis.fetch = saved;
  }
});

test('the routing card and the hints name Jev when Jev picks, Laya otherwise', async () => {
  const s = await loadBundled(`
    export { loadJevActive } from './src/jevStatus';
    export { LayaRoutingCard } from './src/components/ChatView';
    export { routingHint } from './src/channels';
    export { renderToStaticMarkup } from 'react-dom/server.browser';
    export { createElement } from 'react';
  `);
  const card = (routing) => s.renderToStaticMarkup(s.createElement(s.LayaRoutingCard, { routing }));
  const decided = (over) => ({ phase: 'decided', candidates: [], kwantName: 'Ada', kwantTitle: 'Lead', ...over });
  const header = (html) => html.match(/text-zinc-200">(Jev|Laya)</)?.[1];
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ active: false }) });
    await s.loadJevActive();
    assert.equal(header(card(decided({ basis: 'keywords', reason: 'Ada (Lead) does this kind of work' }))), 'Laya');
    assert.equal(header(card(decided({ basis: 'jev', reason: 'Jev matched this to Ada (Lead), 96% sure' }))), 'Jev', 'Jev decided this one');
    assert.match(s.routingHint(2), /^Laya picks/);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ active: true }) });
    await s.loadJevActive();
    assert.equal(header(card(decided({ basis: 'keywords', reason: 'Ada (Lead) was named in your message' }))), 'Jev', 'with Jev on, the router is Jev');
    assert.equal(header(card({ phase: 'deciding', candidates: [] })), 'Jev');
    assert.match(s.routingHint(2), /^Jev picks/);
  } finally {
    globalThis.fetch = saved;
  }
});
