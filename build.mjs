// 打包脚本：把 cli.mjs 打成单文件 CJS，再用 Node SEA 注入 node.exe 副本，
// 产出免安装的 dist/douyin-dl.exe。
// 版本号唯一来源是根目录 VERSION 文件：`node build.mjs sync` 只同步版本号到
// installer.iss 和 AndroidManifest，不带参数则同步后继续完整打包。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// ---- 版本号集中管理 ----
const VERSION = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const [ma, mi, pa] = VERSION.split('.').map(Number);
const VERSION_CODE = ma * 10000 + mi * 100 + pa;

function syncVersion() {
  // installer.iss 是 UTF-8 带 BOM（Inno 编译器要求），改写后必须保留 BOM
  const issPath = path.join(root, 'installer', 'installer.iss');
  let iss = fs.readFileSync(issPath, 'utf8').replace(/^\uFEFF/, '');
  iss = iss.replace(/#define MyAppVersion ".*"/, `#define MyAppVersion "${VERSION}"`);
  fs.writeFileSync(issPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(iss, 'utf8')]));

  const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  let xml = fs.readFileSync(manifest, 'utf8');
  xml = xml
    .replace(/android:versionCode="\d+"/, `android:versionCode="${VERSION_CODE}"`)
    .replace(/android:versionName="[^"]*"/, `android:versionName="${VERSION}"`);
  fs.writeFileSync(manifest, xml);
  console.log(`版本号已同步: ${VERSION} (versionCode ${VERSION_CODE})`);
}

if (process.argv[2] === 'sync') {
  syncVersion();
  process.exit(0);
}
syncVersion();

// SEA 固定哨兵熔丝，postject 用它定位注入点
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// 1) ESM -> 单文件 CJS（SEA 入口要求 CJS）；esbuild 延迟加载，让 sync 模式零依赖可用
const esbuild = (await import('esbuild')).default;
await esbuild.build({
  entryPoints: [path.join(root, 'cli.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  charset: 'utf8',
  outfile: path.join(dist, 'entry.cjs'),
  logLevel: 'info',
});

// 2) 生成 SEA 资源 blob
fs.writeFileSync(
  path.join(root, 'sea-config.json'),
  JSON.stringify(
    {
      main: 'dist/entry.cjs',
      output: 'dist/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
    },
    null,
    2,
  ),
);
execSync('node --experimental-sea-config sea-config.json', { cwd: root, stdio: 'inherit' });

// 3) 复制 node.exe 并把 blob 注入进去
const exe = path.join(dist, 'douyin-dl.exe');
fs.copyFileSync(process.execPath, exe);
execSync(`npx postject "${exe}" NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse ${SENTINEL}`, {
  cwd: root,
  stdio: 'inherit',
});

console.log(`\n✓ 打包完成: ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(1)}MB)`);
