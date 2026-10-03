import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { VideoRow } from "./crawl";

const HEADER = ["BV号", "标题", "支持的最高视频规格", "点赞", "投币", "收藏"];
const ILLEGAL_FILENAME_CHARS = '\\/:*?"<>|';

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatRow(row: VideoRow): string {
  const num = (v: number | null) => (v === null ? "" : String(v));
  const fields = [row.bvid, row.title, row.quality, num(row.like), num(row.coin), num(row.favorite)];
  return fields.map(escapeField).join(",");
}

/** 清洗 UP 主名称，使其可作为 Windows 文件名 */
export function sanitizeFileName(name: string): string {
  const cleaned = Array.from(name, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 32 || ILLEGAL_FILENAME_CHARS.includes(ch) ? "_" : ch;
  })
    .join("")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || "unknown";
}

/** CSV 文件路径：<dataDir>/<up主名称>.csv */
export function csvPath(dataDir: string, upName: string): string {
  return resolve(dataDir, `${sanitizeFileName(upName)}.csv`);
}

/** 创建（覆盖）CSV 并写入带 BOM 的表头，返回后可逐行 appendRow */
export function openCsv(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const headerLine = HEADER.map(escapeField).join(",");
  writeFileSync(filePath, "﻿" + headerLine + "\r\n", "utf8");
}

/** 追加一行数据（实时写入） */
export function appendRow(filePath: string, row: VideoRow): void {
  appendFileSync(filePath, formatRow(row) + "\r\n", "utf8");
}
