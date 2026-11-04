// Laya and Jev, the routers, in App settings.
const zh: Record<string, string> = {
  'On · {model} picks the model for each message and who answers in channels': '已开启 · 由 {model} 为每条消息选择模型，并决定频道里谁来回答',
  'Off · add an API key to turn it on': '已关闭 · 填写 API 密钥后即可开启',
  'Off · channels pick by keywords and Laya': '已关闭 · 频道按关键词和 Laya 分配',
  'Couldn’t save.': '保存失败。',
  'Couldn’t reach the server.': '无法连接服务器。',
  'Works: picked {choice} for a sample message in {ms} ms.': '连接正常：示例消息分给了 {choice}，用时 {ms} 毫秒。',
  'The test failed.': '测试失败。',
  'Jev, smarter routing': 'Jev 智能分配',
  'Picks each message’s engine and model, and who answers in a channel, in Laya’s place. It reads the meaning of a message, so Chinese and other languages written without spaces route well too. Messages, the channel name and your bots’ names, titles and Good for / Not for lists are sent to the URL below.':
    '代替 Laya，为每条消息选择引擎和模型，并决定频道里由谁来回答。它按消息的意思判断，中文等不用空格分词的语言也能准确分配。消息、频道名，以及机器人的名称、职位和“擅长 / 不擅长”列表，都会发送到下面的地址。',
  'OpenCode Zen (free)': 'OpenCode Zen（免费）',
  URL: '地址',
  Model: '模型',
  'API key': 'API 密钥',
  'Paste the key': '粘贴密钥',
  'Testing…': '测试中…',
  Test: '测试',
  'Laya is online · picks the best bot for each message': 'Laya 在线 · 为每条消息挑选最合适的机器人',
  'Laya is installing · picking by keywords meanwhile': 'Laya 正在安装 · 暂时按关键词分配',
  'Laya is loading its model · picking by keywords meanwhile': 'Laya 正在加载模型 · 暂时按关键词分配',
  'Laya is offline · picking by keywords': 'Laya 离线 · 按关键词分配',
  'Checking Laya…': '正在检查 Laya…',
  'Laya, the router': 'Laya 分配器',
  ' (started by the app)': '（由应用启动）',
  'Auto (Jev picks)': '自动（由 Jev 选择）',
  'Jev picks per task': '由 Jev 按子任务选择',
  'Jev picks the model': '由 Jev 选择模型',
  'Jev picks the engine for each message. Tools work with Claude Code, Ollama and API keys, but not through the Codex or Grok CLIs.':
    'Jev 会为每条消息挑选引擎。Claude Code、Ollama 和 API 密钥都能使用工具，但 Codex 和 Grok CLI 不行。',
};
export default zh;
