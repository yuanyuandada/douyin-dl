// 图形界面：启动本地 HTTP 服务并打开浏览器页面（零依赖，双击 exe 即用）。
// 只监听 127.0.0.1，不对局域网开放。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { extractUrls } from './lib/douyin.mjs';
import { downloadOne } from './lib/pipeline.mjs';

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>douyin-dl 抖音去水印下载</title>
<style>
*{box-sizing:border-box}
body{background:#101014;color:#ececf1;font:15px/1.6 system-ui,'Segoe UI','Microsoft YaHei',sans-serif;max-width:760px;margin:0 auto;padding:20px 16px 60px}
header{display:flex;align-items:baseline;gap:10px;margin-bottom:16px}
h1{font-size:22px;margin:0;color:#fe2c55}
.sub{color:#888;font-size:13px}
textarea{width:100%;background:#1a1a20;border:1px solid #2c2c34;border-radius:10px;color:#eee;padding:12px;font:inherit;resize:vertical}
textarea:focus{outline:none;border-color:#fe2c55}
.row{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;align-items:center}
label{color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px}
input[type=text]{flex:1;min-width:220px;background:#1a1a20;border:1px solid #2c2c34;border-radius:8px;color:#eee;padding:8px 10px}
input[type=text]:focus{outline:none;border-color:#fe2c55}
button{background:#fe2c55;color:#fff;border:0;border-radius:8px;padding:9px 22px;font:inherit;font-weight:600;cursor:pointer}
button:active{transform:scale(.98)}
button.ghost{background:transparent;border:1px solid #3a3a44;color:#bbb}
.err{color:#ff6b6b;font-size:13px;margin-top:8px;min-height:1.2em}
.job{background:#17171d;border:1px solid #26262e;border-radius:12px;padding:12px 14px;margin-top:10px}
.jt{display:flex;gap:8px;align-items:center}
.jt b{font-size:14px}
.tag{background:#2a2a33;color:#aaa;font-size:12px;border-radius:6px;padding:1px 8px}
.st{font-size:12px;font-weight:600;color:#888}
.st-done .st{color:#2fbf71}
.st-error .st{color:#ff6b6b}
.st-downloading .st,.st-resolving .st,.st-queued .st{color:#fe2c55}
.jd{color:#bbb;font-size:13px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{height:6px;background:#26262e;border-radius:3px;margin-top:8px;overflow:hidden}
.bar i{display:block;height:100%;background:linear-gradient(90deg,#fe2c55,#ff7a45);transition:width .3s}
small{color:#888;font-size:12px;display:block;margin-top:4px}
.je{color:#ff6b6b;font-size:13px;margin-top:4px;word-break:break-all}
.jw{color:#e6a23c;font-size:12px;margin-top:4px;word-break:break-all}
.disclaimer{color:#666;font-size:12px;margin-top:28px;text-align:center;line-height:1.8}
</style></head><body>
<header><h1>douyin-dl</h1><span class="sub">抖音视频 / 图集 去水印下载</span></header>
<main>
  <textarea id="text" rows="4" placeholder="粘贴分享文案或链接，支持一次粘贴多条，例如：&#10;8.63 复制打开抖音，看看...的作品 https://v.douyin.com/iAbCdEf/ 复制此链接..."></textarea>
  <div class="row">
    <label>保存到 <input id="out" type="text" spellcheck="false"></label>
    <label><input id="music" type="checkbox"> 图集同时下载音乐</label>
  </div>
  <div class="row">
    <button id="go">开始下载</button>
    <button id="open" class="ghost">打开下载文件夹</button>
  </div>
  <div id="err" class="err"></div>
  <div id="jobs"></div>
</main>
<footer class="disclaimer">本工具仅供学习与技术研究使用；请尊重视频原作者的著作权。<br>用户使用本工具进行的一切操作及产生的后果与作者无关。</footer>
<script>
function $(id){return document.getElementById(id)}
function fmtMB(n){n=Number(n)||0;return n>=1048576?(n/1048576).toFixed(1)+'MB':(n/1024).toFixed(0)+'KB'}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var ST={queued:'排队中',resolving:'解析中',downloading:'下载中',done:'完成',error:'失败'};
function render(list){
  $('jobs').innerHTML=list.map(function(j){
    var h='<div class="job st-'+j.status+'">';
    h+='<div class="jt"><span class="st">'+esc(ST[j.status]||j.status)+'</span>';
    if(j.type)h+='<span class="tag">'+esc(j.type)+'</span>';
    if(j.author)h+='<b>'+esc(j.author)+'</b>';
    h+='</div>';
    if(j.desc)h+='<div class="jd" title="'+esc(j.desc)+'">'+esc(j.desc)+'</div>';
    if(j.status==='downloading'){
      if(j.filesTotal>1){
        var pct=j.filesTotal?Math.round(j.filesDone/j.filesTotal*100):0;
        h+='<div class="bar"><i style="width:'+pct+'%"></i></div>';
        h+='<small>'+j.filesDone+' / '+j.filesTotal+' 张'+(j.total?'，当前 '+fmtMB(j.received)+' / '+fmtMB(j.total):'')+'</small>';
      }else if(j.total>0){
        h+='<div class="bar"><i style="width:'+Math.round(j.received/j.total*100)+'%"></i></div><small>'+fmtMB(j.received)+' / '+fmtMB(j.total)+'</small>';
      }else{
        h+='<small>已下载 '+fmtMB(j.received)+'</small>';
      }
    }
    if(j.warn)h+='<div class="jw">⚠ '+esc(j.warn)+'</div>';
    if(j.status==='done')h+='<small>已保存到下载文件夹</small>';
    if(j.status==='error')h+='<div class="je">'+esc(j.error)+'</div>';
    return h+'</div>';
  }).join('');
}
function poll(){fetch('/api/jobs').then(function(r){return r.json()}).then(render).catch(function(){})}
setInterval(poll,900);poll();
$('go').onclick=function(){
  $('err').textContent='';
  fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:$('text').value,out:$('out').value,music:$('music').checked})})
  .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})
  .then(function(x){if(x.ok){$('text').value='';poll()}else{$('err').textContent=x.d.error||'提交失败'}})
  .catch(function(e){$('err').textContent='请求失败：'+e});
};
$('open').onclick=function(){
  fetch('/api/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:$('out').value})}).catch(function(){});
};
fetch('/api/config').then(function(r){return r.json()}).then(function(c){if(!$('out').value)$('out').value=c.out}).catch(function(){});
</script></body></html>`;

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1048576) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function appDir() {
  try {
    const sea = await import('node:sea');
    if (sea.isSea()) return path.dirname(process.execPath);
  } catch {
    /* node:sea 不存在（旧版 Node 开发环境），用 cwd */
  }
  return process.cwd();
}

export async function startGui({ openBrowser = false } = {}) {
  const dir = await appDir();
  const defaultOut = path.join(dir, 'downloads');
  const resolveOut = (p) => {
    const s = String(p ?? '').trim();
    if (!s) return defaultOut;
    return path.isAbsolute(s) ? s : path.join(dir, s);
  };

  const jobs = new Map();
  const byUrl = new Map();
  let nextId = 1;

  // 下载排队执行（并发 2），避免并发请求过多触发风控
  const queue = [];
  let running = 0;
  function enqueue(job, outDir, music) {
    queue.push({ job, outDir, music });
    pump();
  }
  function pump() {
    while (running < 2 && queue.length) {
      const t = queue.shift();
      running++;
      runJob(t.job, t.outDir, t.music).finally(() => {
        running--;
        pump();
      });
    }
  }

  async function runJob(job, outDir, music) {
    const set = (patch) => Object.assign(job, patch);
    try {
      set({ status: 'resolving' });
      await downloadOne(
        job.url,
        { out: outDir, music },
        {
          onInfo: (info) =>
            set({
              status: 'downloading',
              type: info.isGallery ? '图集' : '视频',
              author: info.author,
              desc: info.desc.slice(0, 120),
              filesTotal: info.isGallery ? info.gallery.length : 1,
              filesDone: 0,
            }),
          onProgress: (received, total) => set({ received, total }),
          onWarn: (msg) => set({ warn: msg }),
          onFileDone: () => set({ filesDone: job.filesDone + 1, received: 0, total: 0 }),
          onSkip: () => set({ filesDone: job.filesDone + 1 }),
          onMusic: () => set({ filesDone: job.filesDone + 1 }),
        },
      );
      set({ status: 'done', received: 0, total: 0 });
    } catch (err) {
      set({ status: 'error', error: err.message });
    } finally {
      byUrl.delete(job.url);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && u.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/config') {
        json(res, 200, { out: defaultOut });
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/jobs') {
        json(res, 200, [...jobs.values()].sort((a, b) => b.id - a.id));
        return;
      }
      if (req.method === 'POST' && u.pathname === '/api/download') {
        const body = JSON.parse(await readBody(req));
        const urls = extractUrls(String(body.text ?? '')).slice(0, 50);
        if (!urls.length) {
          json(res, 400, { error: '未在输入中找到抖音链接' });
          return;
        }
        const outDir = resolveOut(body.out);
        const ids = [];
        for (const url of urls) {
          const existing = byUrl.get(url);
          if (existing) {
            ids.push(existing.id);
            continue;
          }
          const job = {
            id: nextId++, url, status: 'queued', type: '', author: '', desc: '',
            filesDone: 0, filesTotal: 0, received: 0, total: 0, error: '', warn: '',
          };
          jobs.set(job.id, job);
          byUrl.set(url, job);
          ids.push(job.id);
          enqueue(job, outDir, !!body.music);
        }
        json(res, 200, { ids });
        return;
      }
      if (req.method === 'POST' && u.pathname === '/api/open-folder') {
        const body = JSON.parse(await readBody(req).catch(() => '{}'));
        const p = path.resolve(resolveOut(body.path));
        fs.mkdirSync(p, { recursive: true });
        spawn('explorer', [p], { detached: true, stdio: 'ignore' }).unref();
        json(res, 200, { ok: true, path: p });
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`douyin-dl 图形界面已启动: ${url}`);
  console.log('在浏览器页面里粘贴分享链接即可下载；关闭本窗口（或 Ctrl+C）即退出。');
  console.log('本工具仅供学习使用，用户使用操作与作者无关。');
  if (openBrowser && process.env.DOUYIN_DL_NO_OPEN !== '1') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
  // 服务随事件循环常驻，不再返回
  await new Promise(() => {});
}
