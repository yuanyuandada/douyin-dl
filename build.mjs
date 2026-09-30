// 打包脚本：把 cli.mjs 打成单文件 CJS，再用 Node SEA 注入 node.exe 副本，
// 产出免安装的 dist/douyin-dl.exe。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// SEA 固定哨兵熔丝，postject 用它定位注入点
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// 1) ESM -> 单文件 CJS（SEA 入口要求 CJS）
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
