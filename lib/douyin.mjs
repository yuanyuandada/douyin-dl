// 抖音解析：从分享文本/链接中提取作品 ID，再通过 iesdouyin 分享页内嵌的
// _ROUTER_DATA JSON 拿到无水印直链与元信息（不依赖第三方解析接口）。

import { httpGet } from './http.mjs';

const URL_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(douyin\.com|iesdouyin\.com)\/\S+/i;

const KIND_ID_RE = /(?:\/share\/)?\/?(video|note|slides)\/(\d{6,})/i;
const SHARE_KINDS = ['video', 'note', 'slides'];

/** 从任意分享文本里提取所有抖音链接（去重） */
export function extractUrls(text) {
  const out = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'，。、《》【】（）()]+/gi)) {
    const url = m[0].replace(/[),.!]+$/, '');
    if (URL_HOST_RE.test(url)) out.push(url);
  }
  return [...new Set(out)];
}

export function parseKindAndId(url) {
  const modal = url.match(/modal_id=(\d{6,})/);
  if (modal) return { kind: 'video', id: modal[1] };
  const m = url.match(KIND_ID_RE);
  if (m) return { kind: m[1].toLowerCase(), id: m[2] };
  return null;
}

/** 短链跟随跳转拿真实地址；长链直接解析 */
export async function resolve(url) {
  const direct = parseKindAndId(url);
  if (direct) return direct;
  if (!/douyin\.com/i.test(url)) throw new Error(`无法识别的链接：${url}`);
  const res = await httpGet(url);
  const parsed = parseKindAndId(res.url || '');
  if (!parsed) {
    throw new Error(`短链已失效或无法解析（跳转到了 ${res.url || '未知页面'}）：${url}`);
  }
  return parsed;
}

/** 从 HTML 里按花括号配平提取 _ROUTER_DATA 的 JSON（比正则截取更稳） */
function extractRouterData(html) {
  const idx = html.indexOf('_ROUTER_DATA');
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function deepFindItemList(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.item_list) && obj.item_list.length) return obj.item_list;
  for (const v of Object.values(obj)) {
    const found = deepFindItemList(v);
    if (found) return found;
  }
  return null;
}

// 分享页只有在带 ttwid Cookie 时才会在 SSR 里注入作品数据。
// ttwid 通过字节官方注册接口获取，进程内缓存复用。
let cachedTtwid = '';

export async function getTtwid() {
  if (cachedTtwid) return cachedTtwid;
  try {
    const res = await httpGet('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: 'cn',
        aid: 1768,
        needFid: false,
        service: 'www.ixigua.com',
        mss_info: { 'X-Bogus': '', _signature: '', bytegif: '' },
      }),
      timeoutMs: 15000,
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    const c = cookies.map((x) => x.split(';')[0]).find((x) => x.startsWith('ttwid='));
    if (c) {
      cachedTtwid = c;
      return c;
    }
    const j = await res.json().catch(() => null);
    if (j?.token) {
      cachedTtwid = `ttwid=${j.token}`;
      return cachedTtwid;
    }
  } catch {
    /* 注册失败则不带 Cookie 兜底请求 */
  }
  return '';
}

async function fetchItemList(kind, id) {
  const url = `https://www.iesdouyin.com/share/${kind}/${id}/`;
  const headers = { Referer: 'https://www.douyin.com/' };
  const ttwid = await getTtwid();
  if (ttwid) headers.Cookie = ttwid;
  const res = await httpGet(url, { headers });
  if (!res.ok) throw new Error(`分享页请求失败：HTTP ${res.status}`);
  const html = await res.text();

  let data = extractRouterData(html);
  if (data) {
    const list = deepFindItemList(data);
    if (list) return list;
  }
  // 兜底：老版页面的 RENDER_DATA（URL 编码的 JSON）
  const m = html.match(/id="RENDER_DATA"[^>]*>([^<]+)</);
  if (m) {
    try {
      const list = deepFindItemList(JSON.parse(decodeURIComponent(m[1])));
      if (list) return list;
    } catch {
      /* 忽略，走统一报错 */
    }
  }
  return null;
}

export async function fetchInfo({ kind, id }) {
  const kinds = [kind, ...SHARE_KINDS.filter((k) => k !== kind)];
  let lastErr = new Error('解析失败');
  for (const k of kinds) {
    let list;
    try {
      list = await fetchItemList(k, id);
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (list) return normalizeItem(list[0], id);
    lastErr = new Error('分享页未返回作品数据（作品可能已删除、仅自己可见，或抖音接口变更）');
  }
  throw lastErr;
}

function urlList(v) {
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

export function normalizeItem(item, fallbackId) {
  const video = item.video ?? {};
  const play = video.play_addr ?? {};
  const uri = play.uri ?? video.uri ?? '';

  const candidates = [];
  const push = (u) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };
  const playUrl = (ratio, line) =>
    uri ? `https://www.iesdouyin.com/aweme/v1/play/?video_id=${uri}&ratio=${ratio}&line=${line}` : null;

  // 候选顺序：详情接口返回的带签名 CDN 直链最可靠，优先；
  // 然后拼 1080p/default/720p（line=0）-> url_list -> 多码率/备用源 -> line=1 再试一轮
  const direct = urlList(play.url_list).filter((u) => !/playwm/.test(u));
  for (const u of direct) if (/douyinvod|aweme-eagle/.test(u)) push(u);
  for (const ratio of ['1080p', 'default', '720p']) push(playUrl(ratio, 0));
  for (const u of direct) if (!/douyinvod|aweme-eagle/.test(u)) push(u);
  // 经典改法：playwm -> play 去水印（部分受限作品只在 snssdk 域名给出 playwm 链接）
  for (const u of urlList(play.url_list)) if (/playwm/.test(u)) push(u.replace('playwm', 'play'));
  for (const br of Array.isArray(video.bit_rate) ? video.bit_rate : []) {
    for (const u of urlList(br.play_addr?.url_list)) if (!/playwm/.test(u)) push(u);
  }
  for (const key of ['play_addr_lowbr', 'play_addr_h264']) {
    for (const u of urlList(video[key]?.url_list)) if (!/playwm/.test(u)) push(u);
  }
  for (const ratio of ['1080p', 'default', '720p']) push(playUrl(ratio, 1));

  // 带水印源（playwm 原链接 + download_addr）仅作全部失效后的兜底
  const wmUrls = [
    ...urlList(play.url_list).filter((u) => /playwm/.test(u)),
    ...urlList(video.download_addr?.url_list),
  ].filter((u) => !candidates.includes(u));

  const info = {
    id: item.aweme_id ?? fallbackId,
    desc: (item.desc ?? '').trim(),
    author: item.author?.nickname ?? '',
    createTime: item.create_time ? new Date(item.create_time * 1000) : null,
    durationMs: Number(video.duration ?? item.duration ?? 0),
    stats: {
      likes: item.statistics?.digg_count ?? 0,
      comments: item.statistics?.comment_count ?? 0,
      collects: item.statistics?.collect_count ?? 0,
      shares: item.statistics?.share_count ?? 0,
    },
    cover: urlList(video.cover?.url_list).at(-1) ?? '',
    isGallery: Array.isArray(item.images) && item.images.length > 0,
    // 每张图给出一组 CDN 镜像地址，下载时逐个尝试
    gallery: (item.images ?? []).map((im) => urlList(im.url_list)).filter((a) => a.length > 0),
    musicUrl: urlList(item.music?.play_url?.url_list)[0] ?? '',
    videoUrls: candidates,
    wmUrls,
  };
  // 调试用（--debug）：保留原始 item，不参与 JSON 序列化
  Object.defineProperty(info, 'rawItem', { value: item, enumerable: false });
  return info;
}
