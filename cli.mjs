#!/usr/bin/env node
// douyin-dl — 抖音视频/图集去水印下载
// 带参数：命令行模式；不带参数（如双击 exe）：启动图形界面。

import fs from 'node:fs';
import path from 'node:path';
import { extractUrls } from './lib/douyin.mjs';
import { downloadOne } from './lib/pipeline.mjs';
import { startGui } from './gui.mjs';

const HELP = `douyin-dl — 抖音视频/图集去水印下载

不带参数运行（如双击 exe）会打开图形界面；命令行用法：

  douyin-dl <分享文本或链接> [更多链接...] [选项]
  （分享文本带空格也没关系，会自动从中提取链接）

选项:
  -o, --out <目录>   输出目录（默认 ./downloads）
  -f, --file <文件>  从文本文件批量读取链接
      --info         只解析并显示信息，不下载
      --music        图集同时下载背景音乐
      --gui          强制打开图形界面
      --debug        失败时把解析到的原始数据存成 JSON 便于排查
  -q, --quiet        不显示下载进度
  -h, --help         显示本帮助

示例:
  douyin-dl "8.63 复制打开抖音... https://v.douyin.com/iAbCdEf/ ..."
  douyin-dl https://www.douyin.com/video/7xxxxxxxxxxxxxxxxxx -o ./dl
  douyin-dl -f links.txt --music

本工具仅供学习使用，用户使用操作与作者无关。
`;

function parseArgs(argv) {
  const opts = {
    out: './downloads', quiet: false, info: false, music: false, gui: false, debug: false,
    files: [], text: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '-o' || a === '--out') {
      opts.out = argv[++i] ?? opts.out;
    } else if (a === '-f' || a === '--file') {
      opts.files.push(argv[++i]);
    } else if (a === '--info') {
      opts.info = true;
    } else if (a === '--music') {
      opts.music = true;
    } else if (a === '--gui') {
      opts.gui = true;
    } else if (a === '--debug') {
      opts.debug = true;
    } else if (a === '-q' || a === '--quiet') {
      opts.quiet = true;
    } else {
      opts.text.push(a);
    }
  }
  return opts;
}

function fmtCount(n) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(n);
}

function fmtSize(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${(n / 1024).toFixed(0)}KB`;
}

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function printInfo(info) {
  const date = info.createTime
    ? info.createTime.toISOString().slice(0, 16).replace('T', ' ')
    : '未知时间';
  console.log(`  ${info.isGallery ? '图集' : '视频'} | ${info.author || '未知作者'} | ${date}`);
  console.log(`  ${info.desc || '(无标题)'}`);
  if (info.isGallery) {
    console.log(`  共 ${info.gallery.length} 张图 · 赞 ${fmtCount(info.stats.likes)}`);
  } else {
    console.log(
      `  时长 ${fmtDur(info.durationMs)} · 赞 ${fmtCount(info.stats.likes)} · 评 ${fmtCount(
        info.stats.comments,
      )} · 藏 ${fmtCount(info.stats.collects)}`,
    );
  }
}

// 进度行只写到 stderr 的 TTY 上，避免污染管道输出
let lastPrint = 0;
function printProgress(done, total, quiet) {
  if (quiet || !process.stderr.isTTY) return;
  if (Date.now() - lastPrint < 300) return;
  lastPrint = Date.now();
  const mb = (n) => (n / 1048576).toFixed(1) + 'MB';
  const pct = total ? ` ${Math.min(100, Math.round((done / total) * 100))}%` : '';
  process.stderr.write(`\r  ${pct} ${mb(done)}${total ? `/${mb(total)}` : ''}   `);
}
function clearProgress() {
  if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(40) + '\r');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const hasInput = opts.text.length > 0 || opts.files.length > 0;

  // 双击 exe / 无参数 / --gui：启动图形界面（常驻）
  if (opts.gui || !hasInput) {
    await startGui({ openBrowser: true });
    return;
  }

  let text = opts.text.join('\n');
  for (const f of opts.files) text += `\n${fs.readFileSync(f, 'utf8')}`;

  const urls = extractUrls(text);
  if (!urls.length) {
    console.error('未在输入中找到抖音链接。\n' + HELP);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (const url of urls) {
    console.log(`\n▶ ${url}`);
    let lastInfo = null;
    try {
      await downloadOne(
        url,
        { out: opts.out, music: opts.music, infoOnly: opts.info },
        {
          onInfo: (info) => {
            lastInfo = info;
            printInfo(info);
          },
          onProgress: (done, total) => printProgress(done, total, opts.quiet),
          onWarn: (msg) => {
            clearProgress();
            console.warn(`  ⚠ ${msg}`);
          },
          onFileDone: ({ name, size }) => {
            clearProgress();
            console.log(`  ✓ ${name} (${fmtSize(size)})`);
          },
          onSkip: ({ name }) => {
            clearProgress();
            console.log(`  已存在，跳过: ${name}`);
          },
          onMusic: ({ name, size }) => {
            clearProgress();
            console.log(`  ♪ ${name} (${fmtSize(size)})`);
          },
        },
      );
      ok++;
    } catch (err) {
      fail++;
      clearProgress();
      console.error(`  ✗ ${err.message}`);
      // --debug：把解析到的原始数据落盘，便于排查失效案例
      if (opts.debug && lastInfo?.rawItem) {
        const f = path.join(opts.out, `debug-${lastInfo.id}.json`);
        fs.writeFileSync(f, JSON.stringify(lastInfo.rawItem, null, 2));
        console.error(`  原始数据已保存: ${f}`);
      }
    }
  }
  console.log(`\n完成：成功 ${ok}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
