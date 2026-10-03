# 版本日志

## v0.2.1.0 (2026-10-03)
- feat: 播报格式调整为「最高规格 | 标题前30字符」
- docs: 新增 README.md

## v0.2.0.0 (2026-10-03)
- feat: 配置化运行：app/config/config.json 存放 uid/cookie/delayMs，pnpm start 一键构建并运行
- feat: 逐行播报进度（标题前16字符+2空格+最高规格），每条数据实时追加写入 app/data/<up主名称>.csv
- refactor: 构建产物移入 app/dist 子目录，数据移入 app/data

## v0.1.0.0 (2026-10-03)
- feat: 首版 B 站 UP 主视频 CSV 爬虫：按 UID 分页拉取全部投稿，解析视频页 window.__playinfo__.data.support_formats 取最高规格、window.__INITIAL_STATE__ 取点赞/投币/收藏，导出 app/<up主名称>.csv
