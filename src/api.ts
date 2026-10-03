import { createHash } from "node:crypto";

const API_BASE = "https://api.bilibili.com";
const NAV_URL = `${API_BASE}/x/web-interface/nav`;
const CARD_URL = `${API_BASE}/x/web-interface/card`;
const ACC_INFO_URL = `${API_BASE}/x/space/wbi/acc/info`;
const SPACE_VIDEO_URL = `${API_BASE}/x/space/wbi/arc/search`;
const PAGE_LIST_URL = `${API_BASE}/x/player/pagelist`;
const PLAYURL_URL = `${API_BASE}/x/player/wbi/playurl`;
const ARCHIVE_STAT_URL = `${API_BASE}/x/web-interface/archive/stat`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// WBI 签名混淆表（与参考项目 CrawlerAnalysis-server 一致）
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21,
  56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export class BiliApiError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(`B站接口错误 [${code}] ${message}`);
    this.name = "BiliApiError";
  }
}

export interface SupportFormat {
  quality: number;
  format?: string;
  new_description?: string;
  display_desc?: string;
}

export interface SpaceVideoItem {
  bvid: string;
  title: string;
}

export interface SpaceListData {
  list: SpaceVideoItem[];
  page: { count: number; pn: number; ps: number };
}

export interface VideoStat {
  like: number | null;
  coin: number | null;
  favorite: number | null;
}

export interface VideoData {
  /** 支持的最高规格描述（如 "4K 超高清"），拿不到为 null */
  quality: string | null;
  /** 点赞/投币/收藏，拿不到为 null */
  stat: VideoStat | null;
}

export interface ClientOptions {
  /** 每次请求前的最小间隔（毫秒） */
  delayMs: number;
  /** 登录 Cookie（B 站空间/播放接口需要登录态，必填） */
  cookie?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const toNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function extractKeyFromUrl(url?: string): string {
  if (!url) return "";
  const last = url.split("/").pop() ?? "";
  return last.split(".")[0] ?? "";
}

/**
 * 从 HTML 中提取 `window.__xxx__ = {...}` 形式的 JSON 对象文本。
 * 用括号配对而非正则，避免被字符串里的花括号干扰。
 */
function extractWindowObject(html: string, marker: string): string | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const after = html.slice(at + marker.length);
  const assign = after.match(/^\s*=\s*\{/);
  if (!assign) return null;
  const start = at + marker.length + assign[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

/** 从 support_formats 中取 quality 最高的一档，返回可读描述 */
function pickHighestFormat(formats?: SupportFormat[]): string | null {
  if (!formats || formats.length === 0) return null;
  let best = formats[0];
  for (const f of formats) {
    if (f.quality > best.quality) best = f;
  }
  return best.new_description || best.display_desc || `qn${best.quality}`;
}

/** 解析 window.__INITIAL_STATE__ 中 videoData 的三连数据 */
function parseInitialStateStat(html: string): VideoStat | null {
  const text = extractWindowObject(html, "window.__INITIAL_STATE__");
  if (!text) return null;
  try {
    // INITIAL_STATE 是 JS 对象字面量，可能含 undefined，先替换为 null 再按 JSON 解析
    const jsonText = text.replace(/:undefined\b/g, ":null").replace(/\[undefined\b/g, "[null");
    const state = JSON.parse(jsonText);
    const stat = state?.videoData?.stat;
    if (!stat) return null;
    const result: VideoStat = {
      like: toNumber(stat.like),
      coin: toNumber(stat.coin),
      favorite: toNumber(stat.favorite),
    };
    return result.like === null && result.coin === null && result.favorite === null ? null : result;
  } catch {
    return null;
  }
}

export class BiliClient {
  private keys: { imgKey: string; subKey: string } | null = null;

  constructor(private readonly options: ClientOptions) {}

  private headers(referer: string): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: referer,
    };
    if (this.options.cookie) headers["Cookie"] = this.options.cookie;
    return headers;
  }

  /** GET 原始文本，带请求间隔、412 限流退避与 3 次网络层重试 */
  private async request(url: string, referer = "https://www.bilibili.com/"): Promise<string> {
    await sleep(this.options.delayMs);
    let lastError: unknown;
    let saw412 = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: this.headers(referer),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 412) saw412 = true;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (err) {
        lastError = err;
        if (attempt < 3) await sleep((saw412 ? 5000 : 1000) * attempt);
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`请求失败 ${url} —— ${reason}`);
  }

  /** GET JSON 并解包 data 字段，业务 code 非 0 时抛 BiliApiError */
  private async getJson(url: string, referer?: string): Promise<any> {
    const text = await this.request(url, referer);
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`响应不是合法 JSON：${url}`);
    }
    if (json.code !== 0) throw new BiliApiError(json.code, json.message ?? "未知错误");
    return json.data;
  }

  // ==================== WBI 签名 ====================

  private async getWbiKeys(force = false): Promise<{ imgKey: string; subKey: string }> {
    if (!force && this.keys) return this.keys;
    const data = await this.getJson(NAV_URL);
    const img = data?.wbi_img ?? {};
    const imgKey = extractKeyFromUrl(img.img_url);
    const subKey = extractKeyFromUrl(img.sub_url);
    if (!imgKey || !subKey) throw new Error("获取 WBI 签名密钥失败");
    this.keys = { imgKey, subKey };
    return this.keys;
  }

  private buildWbiQuery(
    params: Record<string, string | number>,
    keys: { imgKey: string; subKey: string }
  ): string {
    const orig = keys.imgKey + keys.subKey;
    const mixinKey = MIXIN_KEY_ENC_TAB.reduce((s, i) => s + orig[i], "").slice(0, 32);

    const entries: [string, string][] = Object.entries(params).map(([k, v]) => [
      k,
      String(v).replace(/[!'()*]/g, ""),
    ]);
    entries.push(["wts", String(Math.round(Date.now() / 1000))]);
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    const query = entries.map(([k, v]) => `${k}=${v}`).join("&");
    const wRid = createHash("md5").update(query + mixinKey).digest("hex");

    const search = new URLSearchParams();
    for (const [k, v] of entries) search.append(k, v);
    search.append("w_rid", wRid);
    return search.toString();
  }

  /** 带 WBI 签名的 JSON 请求；遇 -403（签名失效）自动刷新密钥重试一次 */
  private async getJsonWbi(
    url: string,
    params: Record<string, string | number>,
    referer?: string
  ): Promise<any> {
    try {
      const keys = await this.getWbiKeys();
      return await this.getJson(`${url}?${this.buildWbiQuery(params, keys)}`, referer);
    } catch (err) {
      if (err instanceof BiliApiError && err.code === -403) {
        const keys = await this.getWbiKeys(true);
        return await this.getJson(`${url}?${this.buildWbiQuery(params, keys)}`, referer);
      }
      throw err;
    }
  }

  // ==================== 业务接口 ====================

  /** 用户空间投稿视频列表（分页，WBI 签名），返回 data（含 list.vlist 与 page.count） */
  async getSpaceVideos(mid: string | number, pn: number, ps = 40): Promise<SpaceListData> {
    const data = await this.getJsonWbi(
      SPACE_VIDEO_URL,
      {
        pn,
        ps,
        tid: 0,
        special_type: "",
        order: "pubdate",
        mid,
        index: 0,
        keyword: "",
        order_avoided: "true",
        platform: "web",
      },
      `https://space.bilibili.com/${mid}/upload/video`
    );
    const rawList = data?.list;
    const vlist = Array.isArray(rawList?.vlist)
      ? rawList.vlist
      : Array.isArray(rawList)
        ? rawList
        : null;
    if (!vlist) throw new Error("视频列表响应缺少 vlist 字段");
    return { list: vlist, page: data.page ?? { count: 0, pn, ps } };
  }

  /** 获取 UP 主名称：优先 card 接口，失败再试 WBI acc/info，最终返回 null */
  async getUpName(mid: string | number): Promise<string | null> {
    try {
      const data = await this.getJson(`${CARD_URL}?mid=${mid}&photo=false`);
      const name = data?.card?.name;
      if (typeof name === "string" && name) return name;
    } catch {
      // 继续尝试备用接口
    }
    try {
      const data = await this.getJsonWbi(ACC_INFO_URL, { mid, platform: "web" });
      const name = data?.name;
      if (typeof name === "string" && name) return name;
    } catch {
      // 全部失败时由调用方兜底
    }
    return null;
  }

  /**
   * 获取单个视频的互动数据（点赞/投币/收藏），兜底走 archive/stat 接口。
   */
  async getVideoStat(bvid: string): Promise<VideoStat | null> {
    try {
      const data = await this.getJson(`${ARCHIVE_STAT_URL}?bvid=${bvid}`);
      if (!data) return null;
      const result: VideoStat = {
        like: toNumber(data.like),
        coin: toNumber(data.coin),
        favorite: toNumber(data.favorite),
      };
      return result.like === null && result.coin === null && result.favorite === null
        ? null
        : result;
    } catch {
      return null;
    }
  }

  /**
   * 获取单个视频的完整数据。
   * 主路径：抓一次视频页 HTML，同时解析
   *   - head 中 window.__playinfo__ 的 data.support_formats → 支持的最高规格
   *   - window.__INITIAL_STATE__ 的 videoData.stat → 点赞/投币/收藏
   * 兜底：stat 走 archive/stat 接口；规格走 pagelist + playurl 接口。
   */
  async getVideoData(bvid: string): Promise<VideoData> {
    const pageUrl = `https://www.bilibili.com/video/${bvid}/`;
    let quality: string | null = null;
    let stat: VideoStat | null = null;

    try {
      const html = await this.request(pageUrl, pageUrl);
      const playinfoText = extractWindowObject(html, "window.__playinfo__");
      if (playinfoText) {
        try {
          quality = pickHighestFormat(JSON.parse(playinfoText)?.data?.support_formats);
        } catch {
          // playinfo 解析失败，走兜底
        }
      }
      stat = parseInitialStateStat(html);
    } catch {
      // 页面抓取失败，全部走兜底
    }

    if (stat === null) stat = await this.getVideoStat(bvid);
    if (quality === null) quality = await this.getQualityByPlayurl(bvid, pageUrl);
    return { quality, stat };
  }

  /** 规格兜底：pagelist 取 cid 后调 playurl 接口读 support_formats */
  private async getQualityByPlayurl(bvid: string, pageUrl: string): Promise<string | null> {
    try {
      const pages = await this.getJson(`${PAGE_LIST_URL}?bvid=${bvid}&jsonp=jsonp`, pageUrl);
      const cid = Array.isArray(pages) ? pages[0]?.cid : undefined;
      if (!cid) return null;
      const data = await this.getJsonWbi(
        PLAYURL_URL,
        { bvid, cid, qn: 127, fnval: 1, fourk: 1 },
        pageUrl
      );
      return pickHighestFormat(data?.support_formats);
    } catch {
      return null;
    }
  }
}
