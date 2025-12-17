"use strict";
/**
 * Time formatting utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTime = formatTime;
exports.formatDuration = formatDuration;
exports.getElapsedTime = getElapsedTime;
exports.formatTimeAgo = formatTimeAgo;
exports.parseTimeFilter = parseTimeFilter;
/**
 * Format ISO timestamp to HH:MM:SS
 */
function formatTime(isoString) {
    var date = new Date(isoString);
    var hours = String(date.getHours()).padStart(2, '0');
    var minutes = String(date.getMinutes()).padStart(2, '0');
    var seconds = String(date.getSeconds()).padStart(2, '0');
    return "".concat(hours, ":").concat(minutes, ":").concat(seconds);
}
/**
 * Format duration from milliseconds to human-readable string
 */
function formatDuration(ms) {
    var seconds = Math.floor(ms / 1000);
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);
    if (days > 0) {
        return "".concat(days, "d ").concat(hours % 24, "h");
    }
    else if (hours > 0) {
        return "".concat(hours, "h ").concat(minutes % 60, "m");
    }
    else if (minutes > 0) {
        return "".concat(minutes, "m ").concat(seconds % 60, "s");
    }
    else {
        return "".concat(seconds, "s");
    }
}
/**
 * Get elapsed time string from timestamp
 */
function getElapsedTime(timestamp) {
    var now = Date.now();
    var then = new Date(timestamp).getTime();
    var diffMs = now - then;
    return formatDuration(diffMs);
}
/**
 * Format time ago string
 */
function formatTimeAgo(timestamp) {
    var now = Date.now();
    var diffMs = now - timestamp;
    var diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) {
        return "".concat(diffSec, "s ago");
    }
    else if (diffSec < 3600) {
        return "".concat(Math.floor(diffSec / 60), "m ago");
    }
    else if (diffSec < 86400) {
        return "".concat(Math.floor(diffSec / 3600), "h ago");
    }
    else {
        return "".concat(Math.floor(diffSec / 86400), "d ago");
    }
}
/**
 * Parse time filter (e.g., "1h", "30m", "2025-11-03")
 */
function parseTimeFilter(str) {
    // Relative time: 1h, 30m, 2d
    var relativeMatch = str.match(/^(\d+)([hmd])$/);
    if (relativeMatch) {
        var value = parseInt(relativeMatch[1]);
        var unit = relativeMatch[2];
        var now = Date.now();
        switch (unit) {
            case 'h': return new Date(now - value * 3600000);
            case 'm': return new Date(now - value * 60000);
            case 'd': return new Date(now - value * 86400000);
        }
    }
    // Absolute time
    return new Date(str);
}
