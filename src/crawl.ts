import type { BiliClient, SpaceVideoItem } from "./api";

export interface VideoRow {
  bvid: string;
  title: string;
  quality: string;
  like: number | null;
  coin: number | null;
  favorite: number | null;
}

const PAGE_SIZE = 40;

/** 翻页拉取 UP 主全部投稿，返回去重后的列表与总数 */
export async function fetchAllVideos(
  client: BiliClient,
  mid: string,
  onPage?: (page: number, got: number, total: number) => void
): Promise<{ items: SpaceVideoItem[]; total: number }> {
  const items: SpaceVideoItem[] = [];
  const seen = new Set<string>();
  let total = 0;
  let pn = 1;

  for (;;) {
    const data = await client.getSpaceVideos(mid, pn, PAGE_SIZE);
    total = data.page?.count ?? total;
    const list = (data.list ?? []).filter((it) => it && it.bvid);
    for (const it of list) {
      if (!seen.has(it.bvid)) {
        seen.add(it.bvid);
        items.push(it);
      }
    }
    onPage?.(pn, items.length, total);
    if (list.length === 0 || items.length >= total) break;
    pn++;
  }

  return { items, total };
}

/** 逐个抓取视频的最高支持规格与三连数据，每得到一条立即回调（供播报与实时写入） */
export async function buildRows(
  client: BiliClient,
  items: SpaceVideoItem[],
  onRow?: (row: VideoRow) => void
): Promise<VideoRow[]> {
  const rows: VideoRow[] = [];
  for (const item of items) {
    let quality = "未知";
    let like: number | null = null;
    let coin: number | null = null;
    let favorite: number | null = null;
    try {
      const data = await client.getVideoData(item.bvid);
      quality = data.quality ?? "未知";
      like = data.stat?.like ?? null;
      coin = data.stat?.coin ?? null;
      favorite = data.stat?.favorite ?? null;
    } catch {
      // 单个视频失败不中断整体爬取
    }
    const row: VideoRow = {
      bvid: item.bvid,
      title: item.title ?? "",
      quality,
      like,
      coin,
      favorite,
    };
    rows.push(row);
    onRow?.(row);
  }
  return rows;
}
