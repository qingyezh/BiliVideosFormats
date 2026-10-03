"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAllVideos = fetchAllVideos;
exports.buildRows = buildRows;
const PAGE_SIZE = 40;
/** 翻页拉取 UP 主全部投稿，返回去重后的列表与总数 */
async function fetchAllVideos(client, mid, onPage) {
    const items = [];
    const seen = new Set();
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
        if (list.length === 0 || items.length >= total)
            break;
        pn++;
    }
    return { items, total };
}
/** 逐个抓取视频的最高支持规格与三连数据，每得到一条立即回调（供播报与实时写入） */
async function buildRows(client, items, onRow) {
    const rows = [];
    for (const item of items) {
        let quality = "未知";
        let like = null;
        let coin = null;
        let favorite = null;
        try {
            const data = await client.getVideoData(item.bvid);
            quality = data.quality ?? "未知";
            like = data.stat?.like ?? null;
            coin = data.stat?.coin ?? null;
            favorite = data.stat?.favorite ?? null;
        }
        catch {
            // 单个视频失败不中断整体爬取
        }
        const row = {
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
