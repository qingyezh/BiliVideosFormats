"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeFileName = sanitizeFileName;
exports.csvPath = csvPath;
exports.openCsv = openCsv;
exports.appendRow = appendRow;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const HEADER = ["BV号", "标题", "支持的最高视频规格", "点赞", "投币", "收藏"];
const ILLEGAL_FILENAME_CHARS = '\\/:*?"<>|';
function escapeField(value) {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function formatRow(row) {
    const num = (v) => (v === null ? "" : String(v));
    const fields = [row.bvid, row.title, row.quality, num(row.like), num(row.coin), num(row.favorite)];
    return fields.map(escapeField).join(",");
}
/** 清洗 UP 主名称，使其可作为 Windows 文件名 */
function sanitizeFileName(name) {
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
function csvPath(dataDir, upName) {
    return (0, node_path_1.resolve)(dataDir, `${sanitizeFileName(upName)}.csv`);
}
/** 创建（覆盖）CSV 并写入带 BOM 的表头，返回后可逐行 appendRow */
function openCsv(filePath) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(filePath), { recursive: true });
    const headerLine = HEADER.map(escapeField).join(",");
    (0, node_fs_1.writeFileSync)(filePath, "﻿" + headerLine + "\r\n", "utf8");
}
/** 追加一行数据（实时写入） */
function appendRow(filePath, row) {
    (0, node_fs_1.appendFileSync)(filePath, formatRow(row) + "\r\n", "utf8");
}
