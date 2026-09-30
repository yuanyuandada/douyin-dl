// 流式下载 + 内容嗅探：写临时文件，校验魔数后再落盘，避免把风控页当成视频保存。

import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { httpGet } from './http.mjs';
import { getTtwid } from './douyin.mjs';

const MAGICS = [
  { ext: 'mp4', test: (b) => b.length > 7 && b.toString('ascii', 4, 8) === 'ftyp' },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e },
  {
    ext: 'webp',
    test: (b) => b.length > 11 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

function sniffExt(buf) {
  for (const m of MAGICS) if (m.test(buf)) return m.ext;
  return null;
}

async function downloadTo(url, filePath, { onProgress } = {}) {
  // 部分受限内容要求播放接口带 ttwid Cookie
  const cookie = await getTtwid();
  const res = await httpGet(url, {
    headers: { Referer: 'https://www.douyin.com/', ...(cookie ? { Cookie: cookie } : {}) },
    timeoutMs: 600000,
  });
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length') || 0);
  const tmp = `${filePath}.part`;
  let done = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      onProgress?.(done, total);
      cb(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));

  const fd = await fs.promises.open(tmp, 'r');
  const head = Buffer.alloc(16);
  await fd.read(head, 0, 16, 0);
  await fd.close();

  let ext = sniffExt(head);
  if (!ext) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw new Error('下载内容不是视频/图片（可能触发风控或链接已失效）');
  }
  // 音频类容器魔数同为 ftyp，保留用户传入的音频扩展名
  const curExt = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'mp4' && ['m4a', 'mp3'].includes(curExt)) ext = curExt;

  const finalPath =
    curExt === ext ? filePath : filePath.replace(/\.[a-z0-9]+$/i, '') + '.' + ext;
  await fs.promises.rename(tmp, finalPath);
  return { path: finalPath, size: done };
}

/** 依次尝试候选地址，返回第一个校验通过的结果 */
export async function downloadFirstAvailable(urls, filePath, opts = {}) {
  let lastErr = new Error('没有可用的下载地址');
  for (const url of urls) {
    try {
      return await downloadTo(url, filePath, opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export { downloadTo };
