// Simplified Chinese, keyed by the English text. One file per part of the app, so translations of
// different screens don't collide; a later file wins for a key two files share.
import common from './common';
import routing from './routing';
import missions from './missions';
import goals from './goals';
import chat from './chat';
import settings from './settings';
import bots from './bots';
import tools from './tools';
import computer from './computer';

const parts: Record<string, string>[] = [missions, goals, chat, settings, bots, tools, computer, routing, common];

const zhCN: Record<string, string> = Object.assign({}, ...parts);
export default zhCN;
