// Web 详情接口客户端：a_bogus 签名调用官方 aweme/v1/web/aweme/detail/，
// 拿带签名的真实 CDN 直链（分享页 SSR 对受限作品给不出可用地址时的兜底）。
// 签名与请求必须使用同一个 UA。

import { httpGet } from './http.mjs';
import { getTtwid, normalizeItem } from './douyin.mjs';
import { makeABogus } from './abogus.mjs';

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function fakeMsToken(len = 116) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

export async function fetchDetail(id) {
  const ua = DESKTOP_UA;
  const msToken = fakeMsToken();

  const params = new URLSearchParams({
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    aweme_id: id,
    pc_client_type: '1',
    support_h265: '1',
    support_dash: '1',
    version_code: '170400',
    version_name: '17.4.0',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '126.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '126.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    cpu_core_num: '12',
    device_memory: '8',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '50',
    msToken,
  });
  const query = params.toString();
  const aBogus = await makeABogus(query, ua);

  const ttwid = await getTtwid();
  const cookie = [ttwid, `msToken=${msToken}`].filter(Boolean).join('; ');
  const res = await httpGet(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${query}&a_bogus=${encodeURIComponent(aBogus)}`, {
    headers: {
      'User-Agent': ua,
      Referer: 'https://www.douyin.com/',
      Accept: 'application/json, text/plain, */*',
      Cookie: cookie,
    },
  });
  if (!res.ok) throw new Error(`详情接口 HTTP ${res.status}`);
  const data = await res.json().catch(() => {
    throw new Error('详情接口返回非 JSON（可能触发风控）');
  });
  if (data.status_code && data.status_code !== 0) {
    throw new Error(`详情接口错误 status_code=${data.status_code}${data.status_msg ? ' ' + data.status_msg : ''}`);
  }
  const item = data.aweme_detail ?? data.item_list?.[0];
  if (!item) throw new Error('详情接口未返回作品数据');
  return item;
}
