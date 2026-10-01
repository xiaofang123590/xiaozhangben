/**
 * server.js —— 可选的本地预览服务器（零依赖）
 * 用法：node server.js [端口]   默认 8765，然后浏览器打开 http://localhost:8765
 * 说明：直接双击 index.html 也能使用本应用，此文件只是备用入口。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = __dirname;
const port = parseInt(process.argv[2], 10) || 8765;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(root, urlPath));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, () => {
  console.log('==============================================');
  console.log('  XiaoZhangBen server is running  (Ctrl+C to stop)');
  console.log('  This PC : http://localhost:' + port);
  // 列出所有局域网 IPv4，手机连同一 Wi-Fi 后任选一个访问
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    nets[name].forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) {
        console.log('  Phone   : http://' + net.address + ':' + port + '   <- ' + name);
      }
    });
  });
  console.log('  Phone must use the same Wi-Fi as this PC.');
  console.log('==============================================');
});
