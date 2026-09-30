// 极薄的 HTTP 封装：统一 UA，并处理本机存在 TLS 中间人证书时 fetch 报错的情况。

export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const CERT_ERRORS = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
];

let certFallbackWarned = false;

export async function httpGet(url, { headers = {}, redirect = 'follow', timeoutMs = 30000, method = 'GET', body } = {}) {
  const opts = {
    method,
    body,
    headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
    redirect,
    signal: AbortSignal.timeout(timeoutMs),
  };
  try {
    return await fetch(url, opts);
  } catch (err) {
    const code = err?.cause?.code ?? err?.code ?? '';
    if (CERT_ERRORS.includes(code)) {
      if (!certFallbackWarned) {
        certFallbackWarned = true;
        console.error('! 本机 TLS 证书校验失败（可能存在代理/安全软件注入证书），本次运行跳过证书校验。');
      }
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      return await fetch(url, opts);
    }
    throw err;
  }
}
