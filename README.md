# douyin-dl — 抖音视频/图集去水印下载

零依赖的 Node.js 命令行/图形界面工具：粘贴抖音分享文本或链接，直接下载**无水印**视频或图集原图。

## 图形界面（推荐）

直接**双击 `dist/douyin-dl.exe`**（或不带参数运行）：

- 自动启动本地服务并打开浏览器页面（只监听 127.0.0.1，不对局域网开放）
- 页面里粘贴分享文案/链接（支持多条），点"开始下载"，实时进度条
- 可改保存目录、图集是否带音乐、"打开下载文件夹"一键直达
- 黑色控制台窗口保持开着即可，关掉它服务就停了

命令行模式照旧可用（见下）。

## 功能

- ✅ 视频无水印下载（自动尝试 1080p，失败逐级降级）
- ✅ 图集（照片）批量下载原图
- ✅ 短链（`v.douyin.com`）、完整链接（`www.douyin.com/video/...`）、分享文案（带一堆数字前缀的那种）都能识别
- ✅ 批量下载（多个链接 / 从文件读取）、去重、断点续传（已存在自动跳过）
- ✅ 下载内容魔数校验，不会把风控页误存成 mp4
- ✅ 图集可同时下载背景音乐（`--music`）

## 命令行用法

需要 Node.js ≥ 18。

```bash
# 最常用：直接粘贴分享文案（不用手动清理）
node cli.mjs "8.63 复制打开抖音，看看...的作品 https://v.douyin.com/iAbCdEf/ 复制此链接..."

# 完整链接
node cli.mjs https://www.douyin.com/video/7660458559695921536

# 指定输出目录
node cli.mjs <链接> -o ./dl

# 只看信息不下载
node cli.mjs <链接> --info

# 批量：把链接（每行一个，或直接整段分享文案）放进 links.txt
node cli.mjs -f links.txt --music

# 安装为全局命令（可选）
npm link
douyin-dl <链接>
```

文件保存在输出目录，命名为 `作品ID_文案前40字.mp4`（图集为 `_01.jpg`…，扩展名按真实内容自动纠正）。

## 工作原理

不依赖任何第三方解析接口：

1. 从输入文本中提取抖音链接；短链跟随 302 拿到真实作品 ID 和类型（video/note/slides）。
2. 向字节官方接口注册一个 `ttwid` Cookie（`ttwid.bytedance.com/ttwid/union/register/`）。
3. 带 `ttwid` 请求 `iesdouyin.com` 的分享页 —— 此时页面 SSR 数据 `_ROUTER_DATA` 里会包含完整的 `item_list`（作者、文案、统计、`play_addr` 等）。
4. `play_addr` 里的直链本身就是无水印 CDN 地址（带 `playwm` 的才是有水印的，已过滤）；优先用 `video_id` 拼 1080p 直链，失败自动降级到候选列表。
5. **签名详情接口兜底**：分享页直链失效（如受限短剧、AI 标记推广内容）时，用 a_bogus 签名调用官方 `aweme/v1/web/aweme/detail/` 接口，拿带签名的 douyinvod 真实 CDN 直链。签名算法内联自开源项目 [ylcangel/douyin_sign](https://github.com/ylcangel/douyin_sign)（Apache-2.0），经 node:vm 隔离执行。
6. 流式下载到 `.part` 临时文件，校验魔数（ftyp/jpeg/png/webp）后落盘。

## 已知限制

- 依赖分享页 SSR 结构和 ttwid 接口，抖音改版可能失效 —— 到时优先检查 `_ROUTER_DATA` 结构是否变化（曾用 `debug` 思路：对比带/不带 ttwid 的页面内容）。
- 已删除 / 仅自己可见 / 需登录才能看的作品无法解析。
- 部分受限内容（下架短剧、AI 标记的推广等）分享页直链全部 404，会自动改走 a_bogus 签名详情接口拿真实直链；若接口签名被抖音更新打断，需更新内联的签名实现。
- 界面下载按 2 路并发排队执行，降低触发风控的概率；遇到风控时分享页可能返回空数据，稍后重试即可。
- 本机若存在 HTTPS 中间人（代理/安全软件注入证书），工具会提示并自动跳过证书校验。

## 打包为 EXE / 安装包

基于 Node 官方 SEA（Single Executable Application）方案，产出免安装的单文件程序：

```bash
npm install        # 只需 devDependencies: esbuild + postject
npm run build      # 产物: dist/douyin-dl.exe
```

`dist/douyin-dl.exe` 内嵌了完整 Node 运行时（约 90MB），拷到任何 Windows x64 机器上双击/命令行即可用，目标机器无需装 Node。打包时 postject 会提示"签名已损坏"——这是修改官方 node.exe 的预期现象，不影响使用。

**安装包**（分享给朋友用这个）：需要 [Inno Setup 6](https://jrsoftware.org/isinfo.php)（含 `Languages/ChineseSimplified.isl` 中文包，放在 `installer/` 目录）：

```bash
ISCC.exe installer/installer.iss   # 产物: dist/douyin-dl-setup-1.1.0.exe（约 24MB）
```

安装包行为：中文向导 + 许可页（展示免责声明）；免管理员权限安装到 `%LOCALAPPDATA%\Programs\douyin-dl`；可选桌面快捷方式、开始菜单与卸载入口；装完可直接勾选启动。

## 免责声明

仅供个人学习、备份自己有权限访问的内容使用。请尊重作者版权，不要用于批量爬取、二次分发或去除署名传播，下载内容的著作权归原作者所有。
