// The app in Simplified Chinese: with the language set to zh-CN, screens render their Chinese text
// (and nothing breaks for want of a translation).
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBundled } from './bundle.mjs';

// Before the bundle loads: the language is read once, at load
globalThis.localStorage = { getItem: (k) => (k === 'kwnt:locale' ? 'zh-CN' : null), setItem: () => {} };

const m = await loadBundled(`
  export { locale, t, tc } from './src/i18n';
  export { InboxPage } from './src/components/InboxPage';
  export { ModernApprovalCard } from './src/components/ModernApprovalCard';
  export { JevRoutingRow } from './src/components/JevRouting';
  export { LanguageRow } from './src/components/LanguageSetting';
  export { COLUMNS } from './src/missions';
  export { renderToStaticMarkup } from 'react-dom/server.browser';
  export { createElement } from 'react';
`);
const html = (el, props = {}) => m.renderToStaticMarkup(m.createElement(el, props));

test('the saved choice switches the app to Chinese', () => {
  assert.equal(m.locale, 'zh-CN');
  assert.equal(m.t('Save'), '保存');
  assert.equal(m.t('Not a key anyone translated'), 'Not a key anyone translated');
});

test('one English word reads by its context', () => {
  assert.equal(m.t('Review'), '查看');
  assert.equal(m.tc('task status', 'Review'), '待审核');
  assert.equal(m.t('Open'), '打开');
  assert.equal(m.tc('status', 'Open'), '待处理');
  assert.equal(m.tc('a context with no translation', 'Save'), '保存', 'falls back to the plain word');
});

test('screens render in Chinese', () => {
  const inbox = html(m.InboxPage, { tab: 'new', onTab: () => {}, newPage: null, loosePage: null });
  assert.match(inbox, /新消息/);
  assert.match(inbox, /未了事项/);

  const approval = html(m.ModernApprovalCard, {
    approval: {
      id: 'a1',
      tool_name: 'execute_shell',
      details: { source: 'local_shell', tool: 'execute_shell', arguments: { command: 'ls', cwd: '/tmp' }, kwant_id: 'k1' },
    },
    onResolve: () => {},
  });
  assert.match(approval, /允许一次/);
  assert.match(approval, /拒绝/);
  assert.doesNotMatch(approval, />Allow Once</);

  const jev = html(m.JevRoutingRow);
  assert.match(jev, /Jev 智能分配/);
  assert.match(jev, /OpenCode Zen（免费）/);

  assert.match(html(m.LanguageRow), /跟随浏览器/);
  assert.ok(m.COLUMNS.some((c) => c.label === '待审核'), 'the board’s Review column');
});
