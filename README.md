# B 站 UP 主视频 CSV 爬虫

输入 B 站 UP 主 UID，爬取其主页全部投稿，将每个视频的 **BV号、标题、支持的最高视频规格、点赞、投币、收藏** 实时逐行写入 CSV 文件。

## 功能

- 按 UID 分页拉取 UP 主主页全部视频（自动翻页、去重）
- 解析视频页 `window.__playinfo__` 的 `data.support_formats` 得到视频支持的最高规格（如 `4K 超高清`），失败时兜底 playurl 接口
- 解析视频页 `window.__INITIAL_STATE__` 得到点赞/投币/收藏，失败时兜底 archive/stat 接口
- 逐行实时播报并同步写入 CSV，中途异常也不会丢失已爬数据
- 配置文件驱动，`pnpm start` 一键构建并运行

## 环境要求

- Node.js ≥ 18（使用内置 fetch）
- pnpm

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 编辑配置 app/config/config.json
#    - uid:    目标 UP 主 UID（也接受 https://space.bilibili.com/xxx 形式）
#    - cookie: 你的 B 站登录 Cookie（含 SESSDATA，必填，否则接口返回 -101）
#    - delayMs: 每次请求的最小间隔（毫秒），默认 800

# 3. 一键构建并运行
pnpm start
```

运行过程：

1. 拉取投稿列表，打印分页进度（`第 N 页：已获取 x / total`）
2. 逐个视频播报一行：`最高规格 | 标题前30字符`，例如：

   ```
   4K 超高清 | 《绝区零》3.2 版本「她与她的隐秘往事」前
   ```

3. 每播报一行，该条数据立即追加写入 `app/data/<up主名称>.csv`

## 配置说明（app/config/config.json）

| 字段       | 必填 | 说明                                              |
| ---------- | ---- | ------------------------------------------------- |
| `uid`      | 是   | UP 主 UID 或 space 主页链接                       |
| `cookie`   | 是   | B 站登录 Cookie，从浏览器复制（需含 SESSDATA）    |
| `delayMs`  | 否   | 请求最小间隔，默认 800；遇到 412 限流时调大       |

> `app/config/config.json` 含 Cookie，已加入 `.gitignore`，不会被提交。

## 输出

- 路径：`app/data/<up主名称>.csv`（UP 主名称自动清洗为合法文件名）
- 编码：UTF-8 with BOM，Excel/WPS 可直接双击打开
- 列：`BV号,标题,支持的最高视频规格,点赞,投币,收藏`
- 每次运行会**覆盖**同名 CSV，从头写入

## 目录结构

```
├─ src/                    # TypeScript 源码
│   ├─ index.ts            # 入口：读配置、播报、实时写入
│   ├─ api.ts              # B站接口：WBI 签名、空间列表、视频页解析
│   ├─ crawl.ts            # 分页拉取与逐视频处理
│   └─ csv.ts              # CSV 表头与逐行追加
├─ app/
│   ├─ config/config.json  # 运行配置（uid/cookie/delayMs，不入库）
│   ├─ dist/               # tsc 构建产物（不入库）
│   └─ data/               # 输出 CSV（不入库）
├─ package.json
├─ tsconfig.json
├─ version.md              # 版本日志
└─ data.html               # 参考样例：B站视频页 HTML（support_formats 所在结构）
```

## 常用命令

| 命令          | 说明                                       |
| ------------- | ------------------------------------------ |
| `pnpm start`  | 重新编译 `src/` → `app/dist/` 并运行       |
| `pnpm build`  | 只编译不运行                               |

改了 TS 源码后直接再跑 `pnpm start` 即可，每次都先 `tsc` 再执行；编译报错会直接中断，不会运行旧代码。

## 常见问题

- **接口报 `-101 账号未登录`**：Cookie 缺失或过期，重新从浏览器复制填入 `config.json`。
- **报 `412` 被限流**：调大 `delayMs`（如 1500~2000），稍后重试。
- **某行规格为「未知」/ 互动数据为空**：该视频页面解析失败，属个别现象，可重新运行补齐（CSV 会整体重写）。
- **获取 Cookie**：浏览器登录 B 站 → F12 → Network → 任意请求 → Request Headers → 复制 `Cookie` 全部内容。

## 实现参考

爬取与 WBI 签名逻辑参考 `CrawlerAnalysis-server` 项目（`x/space/wbi/arc/search` 分页接口、WBI 混淆表、请求头与限速策略）。
