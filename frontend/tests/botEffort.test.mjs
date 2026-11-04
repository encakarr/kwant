// A bot's thinking effort in its Edit form: the saved one shows, a change is sent with the form,
// and the helpers read and save it on its own route.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { loadBundled } from './bundle.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/s/s1/b/k_sandy', pretendToBeVisual: true });
const g = globalThis;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'SubmitEvent', 'HTMLFormElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'localStorage', 'sessionStorage', 'matchMedia']) {
  if (!(k in dom.window)) continue;
  Object.defineProperty(g, k, { value: dom.window[k], configurable: true, writable: true });
}
g.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
g.matchMedia = g.window.matchMedia;
// jsdom has no layout or audio; the modal only needs these not to throw.
g.window.HTMLElement.prototype.scrollIntoView ??= () => {};
g.window.HTMLMediaElement && (g.window.HTMLMediaElement.prototype.play = () => Promise.resolve());

let effortSaved = 'xhigh';
const posts = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
g.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('/api/settings/bot-effort/')) {
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(init.body);
      posts.push({ url: u, body });
      if (body.effort === 'turbo') return json({ error: 'effort must be auto, low, medium, high, xhigh, max' }, 400);
      effortSaved = body.effort;
      return json({ effort: body.effort });
    }
    return json({ effort: effortSaved });
  }
  return json([]);
};
g.window.fetch = g.fetch;

const { React, createRoot, NewAgentModal, botEffort } = await loadBundled(`
  export { default as React } from 'react';
  export { createRoot } from 'react-dom/client';
  export { NewAgentModal } from './src/components/NewAgentModal';
  export * as botEffort from './src/botEffort';
`);
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

test('the Edit form shows the saved effort, offers all six and sends a change with the form', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const submitted = [];
  root.render(
    React.createElement(NewAgentModal, {
      isOpen: true,
      kwantId: 'k_sandy',
      initial: { name: 'Sandy', title: 'Writer', persona_prompt: 'p', avatar_sprite: 'architect', preferred_model: 'auto' },
      onClose: () => {},
      onSubmit: (data) => {
        submitted.push(data);
      },
    }),
  );
  await settle();
  const select = host.querySelector('#agent-effort');
  assert.ok(select, 'the effort picker is in the form');
  assert.deepEqual([...select.options].map((o) => o.value), ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(select.value, 'xhigh', 'the saved effort shows');
  assert.match(host.querySelector('#agent-effort-hint').textContent, /Codex and Grok run xhigh/);

  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'max');
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  select.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].effort, 'max');
  root.unmount();
  host.remove();
});

test('the helpers read and save the effort, and say why a save failed', async () => {
  effortSaved = 'low';
  assert.equal(await botEffort.loadBotEffort('k1'), 'low');
  assert.equal(await botEffort.saveBotEffort('k1', 'high'), null);
  assert.deepEqual(posts.at(-1), { url: '/api/settings/bot-effort/k1', body: { effort: 'high' } });
  assert.match(await botEffort.saveBotEffort('k1', 'turbo'), /effort must be/);
  effortSaved = 'nonsense';
  assert.equal(await botEffort.loadBotEffort('k1'), 'auto', 'anything else reads as auto');
  assert.match(botEffort.effortHint('auto'), /low, medium or high/);
});
