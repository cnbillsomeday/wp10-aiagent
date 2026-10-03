# wp10-aiagent

部署在 Cloudflare Workers 上的单文件 AI 聊天应用（OpenAI 兼容接口）。

## 功能

- **多会话聊天**：会话历史保存在浏览器本地（localStorage），支持角色预设（通用/自定义/程序员/翻译等）
- **联网搜索（RAG）**：发送消息前自动搜索网络并将结果注入上下文，回复带 `[1][2]` 引用与可折叠来源列表
  - 免费源：DuckDuckGo → Brave → 百度 自动降级（各源带超时与广告过滤）；付费源：Tavily / Serper / Brave API
  - Worker 端 `/api-search` 统一代理，处理反爬与跳转链接还原，可选抓取网页正文
- **图片识别**：发送图片（本机压缩至 1024px），转换为 OpenAI 兼容 `image_url` 多模态请求（需视觉模型）
- **Skills 技能系统**：SKILL.md 格式（兼容 OpenClaw/Claude Code）指令包，按触发词自动匹配注入，支持内置模板/导入/导出
- **全局记忆**：跨会话长期记忆库（手动增删改/启用开关/导出），支持点按钮让 AI 从当前会话提取候选事实；始终注入对话上下文，预算自动截断
- **文件卡片**：模型回复中的代码块自动渲染为文件卡片（文件名推断 + 下载 + 复制 + 预览）
- **API 代理**：`/api-proxy/*` 转发任意 OpenAI 兼容 API，规避浏览器跨域限制

## 架构

单文件 `worker.js`（内嵌全部 HTML/CSS/JS，页面脚本保持 ES5 兼容旧 Edge），
`wrangler.jsonc` 为部署配置（无任何绑定）。

## 部署方式

### 方式一：Cloudflare Workers（原版）

```bash
npx wrangler deploy
```

首次使用需 `npx wrangler login`。部署后访问 `https://<worker-name>.<subdomain>.workers.dev/`，
在页面「设置」中填写 API Base URL / Key / 模型即可开始使用；所有配置仅保存在浏览器本地。

### 方式二：nginx + Node 后端（自托管）

前提：Node ≥ 18（需内置 fetch）。后端逻辑在运行时从 `worker.js` 提取，无需依赖安装。

```bash
npm run build        # 从 worker.js 生成 public/index.html
node server.js       # 默认监听 127.0.0.1:8787（可用 PORT/HOST 环境变量覆盖）
```

`server.js` 可独立使用（自带静态托管）；生产建议 nginx 托管静态文件并将
`/api-search`、`/api-proxy` 反代到 Node 进程，参考 `nginx.conf.example`：

```nginx
root /opt/wp10-aiagent/public;
location / { try_files $uri $uri/ /index.html; }
location = /api-search { proxy_pass http://127.0.0.1:8787; }
location /api-proxy/   { proxy_pass http://127.0.0.1:8787; proxy_read_timeout 300s; }
```

注意：页面使用根路径下的 `/api-search` 与 `/api-proxy`，请部署在域名根路径；
客户端配置的 API Key 通过 `/api-proxy` 请求头转发给用户自己填写的上游 API，服务器不持久化任何数据。
