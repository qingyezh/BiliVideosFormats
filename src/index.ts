import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BiliApiError, BiliClient } from "./api";
import { buildRows, fetchAllVideos, type VideoRow } from "./crawl";
import { appendRow, csvPath, openCsv } from "./csv";

// 运行时 __dirname 为 app/dist，故配置在 app/config，数据在 app/data
const CONFIG_PATH = resolve(__dirname, "..", "config", "config.json");
const DATA_DIR = resolve(__dirname, "..", "data");

const DEFAULT_DELAY_MS = 800;

interface Config {
  uid?: string | number;
  cookie?: string;
  delayMs?: number;
}

function fail(message: string): never {
  console.error(`错误：${message}`);
  process.exit(1);
}

function loadConfig(): Config {
  let text: string;
  try {
    text = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    fail(`未找到配置文件 ${CONFIG_PATH}，请创建并填写 uid、cookie`);
  }
  try {
    return JSON.parse(text) as Config;
  } catch {
    fail(`配置文件不是合法 JSON：${CONFIG_PATH}`);
  }
}

function normalizeUid(input: string | number): string {
  const text = String(input).trim();
  const fromUrl = text.match(/space\.bilibili\.com\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  if (/^\d+$/.test(text)) return text;
  return fail(`配置中的 uid 无法识别：${text}`);
}

/** 标题取前 30 个字符（按码点截取，避免拆开表情符号） */
function shortTitle(title: string): string {
  return Array.from(title).slice(0, 30).join("");
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.uid === undefined) fail(`配置文件缺少 uid：${CONFIG_PATH}`);
  const uid = normalizeUid(config.uid);
  const cookie = config.cookie ?? "";
  const delayMs = config.delayMs ?? DEFAULT_DELAY_MS;
  if (!cookie) {
    console.log("提示：配置中没有 cookie，空间列表接口大概率返回 -101，请在 config.json 中填写。");
  }

  const client = new BiliClient({ delayMs, cookie });

  console.log(`目标 UP 主 UID：${uid}（请求间隔 ${delayMs}ms）`);
  const upName = (await client.getUpName(uid)) ?? uid;
  console.log(`UP 主名称：${upName}`);

  console.log("正在拉取投稿列表……");
  const { items, total } = await fetchAllVideos(client, uid, (page, got, count) => {
    console.log(`  第 ${page} 页：已获取 ${got} / ${count} 个视频`);
  });
  console.log(`投稿列表完成，共 ${total} 个视频（去重后 ${items.length} 个）。`);

  if (items.length === 0) {
    const file = csvPath(DATA_DIR, upName);
    openCsv(file);
    console.log(`该 UP 主没有投稿，已生成空表：${file}`);
    return;
  }

  const file = csvPath(DATA_DIR, upName);
  openCsv(file);
  console.log(`开始逐个获取数据（每行格式：最高规格 + | + 标题前30字符），实时写入 ${file}`);
  
  const rows = await buildRows(client, items, (row: VideoRow) => {
    console.log(`${row.quality} | ${shortTitle(row.title)}`);
    appendRow(file, row);
  });

  const unknown = rows.filter((r) => r.quality === "未知").length;
  const noStat = rows.filter((r) => r.like === null || r.coin === null || r.favorite === null).length;
  console.log(`完成：${rows.length} 个视频已写入 ${file}`);
  if (unknown > 0) console.log(`其中 ${unknown} 个视频规格获取失败，已标记为"未知"`);
  if (noStat > 0) console.log(`其中 ${noStat} 个视频点赞/投币/收藏获取失败，已留空`);
}

main().catch((err: unknown) => {
  if (err instanceof BiliApiError) {
    if (err.code === -412 || err.code === -509) {
      console.error(
        `被 B 站限流了（${err.message}）。请稍后重试，或调大 config.json 的 delayMs、检查 cookie 是否有效。`
      );
    } else {
      console.error(err.message);
    }
  } else if (err instanceof Error) {
    console.error(`运行失败：${err.message}`);
  } else {
    console.error("运行失败：未知错误");
  }
  process.exit(1);
});
