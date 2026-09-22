# wp10-aiagent

部署在 Cloudflare Workers 上的单文件 AI 聊天应用（OpenAI 兼容接口）。

## 功能

- **多会话聊天**：会话历史保存在浏览器本地（localStorage），支持角色预设（通用/自定义/程序员/翻译等）
- **联网搜索（RAG）**：发送消息前自动搜索网络并将结果注入上下文，回复带 `[1][2]` 引用与可折叠来源列表
  - 免费源：DuckDuckGo → 百度 → Yahoo 自动降级；付费源：Tavily / Serper / Brave
  - Worker 端 `/api-search` 统一代理，处理反爬与跳转链接还原，可选抓取网页正文
- **图片识别**：发送图片（本机压缩至 1024px），转换为 OpenAI 兼容 `image_url` 多模态请求（需视觉模型）
- **Skills 技能系统**：SKILL.md 格式（兼容 OpenClaw/Claude Code）指令包，按触发词自动匹配注入，支持内置模板/导入/导出
- **文件卡片**：模型回复中的代码块自动渲染为文件卡片（文件名推断 + 下载 + 复制 + 预览）
- **API 代理**：`/api-proxy/*` 转发任意 OpenAI 兼容 API，规避浏览器跨域限制

## 架构

单文件 `worker.js`（内嵌全部 HTML/CSS/JS，页面脚本保持 ES5 兼容旧 Edge），
`wrangler.jsonc` 为部署配置（无任何绑定）。

## 部署

```bash
npx wrangler deploy
```

首次使用需 `npx wrangler login`。部署后访问 `https://<worker-name>.<subdomain>.workers.dev/`，
在页面「设置」中填写 API Base URL / Key / 模型即可开始使用；所有配置仅保存在浏览器本地。
