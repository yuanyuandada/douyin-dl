// CLI 与 GUI 共用的下载流水线：解析 -> 元信息 -> 下载（图集/视频/音乐），
// 通过 hooks 向调用方上报进度。

import fs from 'node:fs';
import path from 'node:path';
import { resolve, fetchInfo, normalizeItem } from './douyin.mjs';
import { fetchDetail } from './webapi.mjs';
import { downloadFirstAvailable, downloadTo } from './download.mjs';

/** 文件名安全化：去非法字符，截断到 max 字符 */
export function sanitize(s, max = 40) {
  const cleaned = String(s)
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, max).trim() || 'douyin';
}

/**
 * 下载单个作品。
 * opts:    { out = 'downloads', music = false, infoOnly = false }
 * hooks:   onInfo(info), onProgress(received, total),
 *          onFileStart({name,index,total}), onFileDone({name,size,index,total}),
 *          onSkip({name,index,total}), onMusic({name,size})
 */
export async function downloadOne(url, opts = {}, hooks = {}) {
  const { out = 'downloads', music = false, infoOnly = false } = opts;
  const target = await resolve(url);
  let info;
  try {
    info = await fetchInfo(target);
  } catch (err) {
    // 分享页拿不到数据（受限/风控）时，走 a_bogus 签名详情接口
    try {
      info = normalizeItem(await fetchDetail(target.id), target.id);
    } catch (err2) {
      throw new Error(`分享页与签名详情接口均未拿到数据：${err2.message}`);
    }
  }
  await hooks.onInfo?.(info);
  if (infoOnly) return { info };

  await fs.promises.mkdir(out, { recursive: true });
  const base = path.join(out, `${info.id}_${sanitize(info.desc)}`);

  if (info.isGallery) {
    const total = info.gallery.length;
    for (let i = 0; i < total; i++) {
      const p = `${base}_${String(i + 1).padStart(2, '0')}.jpg`;
      const name = path.basename(p);
      if (fs.existsSync(p)) {
        await hooks.onSkip?.({ name, index: i + 1, total });
        continue;
      }
      await hooks.onFileStart?.({ name, index: i + 1, total });
      const r = await downloadFirstAvailable(info.gallery[i], p, { onProgress: hooks.onProgress });
      await hooks.onFileDone?.({ name: path.basename(r.path), size: r.size, index: i + 1, total });
    }
    if (music && info.musicUrl) {
      const p = `${base}_music.m4a`;
      if (!fs.existsSync(p)) {
        const r = await downloadTo(info.musicUrl, p, { onProgress: hooks.onProgress });
        await hooks.onMusic?.({ name: path.basename(r.path), size: r.size });
      }
    }
    return { info };
  }

  if (!info.videoUrls.length && !info.wmUrls.length) throw new Error('未拿到可用的视频地址');
  const p = `${base}.mp4`;
  const name = path.basename(p);
  if (fs.existsSync(p)) {
    await hooks.onSkip?.({ name, index: 1, total: 1 });
    return { info };
  }
  await hooks.onFileStart?.({ name, index: 1, total: 1 });
  let r;
  try {
    r = await downloadFirstAvailable(info.videoUrls, p, { onProgress: hooks.onProgress });
  } catch (err) {
    const why = String(err?.message ?? err).slice(0, 80);
    // 签名详情接口兜底：受限作品的真实 CDN 直链只在这里给
    try {
      const fresh = normalizeItem(await fetchDetail(target.id), info.id);
      if (fresh.videoUrls.length) {
        await hooks.onWarn?.('分享页直链已失效，已通过签名详情接口获取新地址');
        r = await downloadFirstAvailable(fresh.videoUrls, p, { onProgress: hooks.onProgress });
      }
    } catch {
      /* 落入水印兜底 / 最终报错 */
    }
    if (!r) {
      if (!info.wmUrls.length) {
        throw new Error(
          `无水印地址全部失效（${why}）。作品可能已下架、仅自己可见或访问受限；稍后重试，或换同系列其他一集试试`,
        );
      }
      await hooks.onWarn?.(`无水印源不可用（${why}），已改用带水印源下载`);
      r = await downloadFirstAvailable(info.wmUrls, p, { onProgress: hooks.onProgress });
    }
  }
  await hooks.onFileDone?.({ name: path.basename(r.path), size: r.size, index: 1, total: 1 });
  return { info };
}
