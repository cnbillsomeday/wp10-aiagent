const fs = require('fs');
const path = require('path');

// 从 worker.js 提取内嵌 HTML，生成 public/index.html
// 页面内容的唯一来源是 worker.js 的 HTML 模板；修改页面后运行 npm run build 同步
const src = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
const m = src.match(/^const HTML = `([\s\S]*?)`;\n/m);
if (!m) throw new Error('worker.js 中未找到 HTML 常量');
const html = eval('`' + m[1] + '`');
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), html);
console.log('public/index.html written:', Buffer.byteLength(html), 'bytes');
