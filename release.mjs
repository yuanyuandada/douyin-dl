#!/usr/bin/env node
// 一键发版：读取 VERSION，打 tag 并把产物上传到 GitHub Releases。
// 用法:
//   node release.mjs            # 上传 安装包 + APK
//   node release.mjs --all      # 额外上传便携版 exe（约 90MB）
//   node release.mjs --force    # 同名资产已存在时删除后重传
// 前置: 本机已登录 GitHub（git push 过一次或 gh auth login）；产物已构建。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { httpGet } from './lib/http.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'yuanyuandada/douyin-dl';
const FORCE = process.argv.includes('--force');
const ALL = process.argv.includes('--all');

const V = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const TAG = `v${V}`;
console.log(`发版 ${TAG} (${REPO})`);

function ghToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/password=(.*)/);
  if (!m) throw new Error('未找到 GitHub 凭据：请先 git push 一次或 gh auth login');
  return m[1].trim();
}
const token = ghToken();
const H = () => ({ 'User-Agent': 'douyin-dl', Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const candidates = [
  { name: `douyin-dl-setup-${V}.exe`, file: path.join(root, 'dist', `douyin-dl-setup-${V}.exe`) },
  { name: `douyin-dl-${V}.apk`, file: path.join(root, 'android', `douyin-dl-${V}.apk`) },
  ...(ALL ? [{ name: `douyin-dl-${V}-portable.exe`, file: path.join(root, 'dist', 'douyin-dl.exe') }] : []),
].filter((a) => fs.existsSync(a.file));
if (!candidates.length) throw new Error('没有找到产物：先跑 npm run build / bash android/build.sh / ISCC installer.iss');

const body = [
  `douyin-dl ${TAG} —— 抖音视频/图集去水印下载（仅供学习使用，用户使用操作与作者无关）`,
  '',
  '## 下载',
  ...candidates.map((a) => `- **[${a.name}](https://github.com/${REPO}/releases/download/${TAG}/${a.name})**`),
  '',
  '## 校验 (SHA256)',
  ...candidates.map((a) => `- \`${sha256(a.file)}\`  ${a.name}`),
  '',
  '## 注意',
  '- Windows：SmartScreen 首次提示"未知发布者"，点"仍要运行"即可',
  '- Android 10+：允许"安装未知应用"后安装，文件保存到 手机下载/douyin-dl/',
  '- 下载内容版权归原作者所有，请勿用于商业用途或二次分发',
].join('\n');

// 已存在则校对资产，不存在则创建
let rel = await (await httpGet(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: H() })).json();
if (rel.id) {
  console.log(`release ${TAG} 已存在 (${rel.html_url})`);
} else {
  const res = await httpGet(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { ...H(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: TAG, target_commitish: 'main', name: TAG, body }),
  });
  rel = await res.json();
  if (res.status !== 201) throw new Error(`创建 release 失败: ${res.status} ${rel.message}`);
  console.log(`release 已创建: ${rel.html_url}`);
}

const existing = new Set((rel.assets ?? []).map((a) => a.name));
for (const a of candidates) {
  if (existing.has(a.name)) {
    if (!FORCE) {
      console.log(`= 已存在，跳过: ${a.name}（--force 可重传）`);
      continue;
    }
    const old = rel.assets.find((x) => x.name === a.name);
    await httpGet(`https://api.github.com/repos/${REPO}/releases/assets/${old.id}`, { method: 'DELETE', headers: H() });
    console.log(`- 已删除旧资产: ${a.name}`);
  }
  const size = fs.statSync(a.file).size;
  const up = await httpGet(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${a.name}`, {
    method: 'POST',
    timeoutMs: 900000,
    headers: { 'User-Agent': 'douyin-dl', Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': size },
    body: fs.readFileSync(a.file),
  });
  const ud = await up.json();
  if (up.status !== 201) throw new Error(`上传失败 ${a.name}: ${up.status} ${ud.message}`);
  console.log(`✓ 已上传: ${a.name} (${(size / 1048576).toFixed(1)}MB)`);
}
console.log(`\n完成: ${rel.html_url ?? `https://github.com/${REPO}/releases/tag/${TAG}`}`);
