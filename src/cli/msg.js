"use strict";
/**
 * tx msg - View and interact with messages
 *
 * Features:
 * - Interactive mode with vim-style navigation
 * - Filter by type, agent, mesh, time
 * - Follow mode for real-time updates
 * - JSON output mode
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.msg = msg;
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var node_readline_1 = require("node:readline");
var chokidar_1 = require("chokidar");
var colors_ts_1 = require("../shared/colors.ts");
var time_ts_1 = require("../shared/time.ts");
// Message type colors
var typeColors = {
    'task': colors_ts_1.colors.cyan,
    'ask': colors_ts_1.colors.yellow,
    'ask-response': colors_ts_1.colors.green,
    'ask-human': colors_ts_1.colors.yellow,
    'task-complete': colors_ts_1.colors.magenta,
    'update': colors_ts_1.colors.blue,
    'error': colors_ts_1.colors.red
};
/**
 * Parse message file
 */
function readMessage(filepath) {
    return __awaiter(this, void 0, void 0, function () {
        var content, parts, frontmatter, body, rearmatter;
        return __generator(this, function (_a) {
            try {
                content = node_fs_1.default.readFileSync(filepath, 'utf-8');
                parts = content.split(/^---$/m);
                if (parts.length < 3)
                    return [2 /*return*/, null];
                frontmatter = parseFrontmatter(parts[1].trim());
                body = parts.length >= 4 ? parts[2].trim() : parts.slice(2).join('---').trim();
                rearmatter = parts.length >= 4 ? parseRearmatter(parts[3].trim()) : null;
                return [2 /*return*/, {
                        filepath: filepath,
                        filename: node_path_1.default.basename(filepath),
                        timestamp: frontmatter.timestamp || new Date().toISOString(),
                        from: frontmatter.from || '?',
                        to: frontmatter.to || '?',
                        type: frontmatter.type || 'unknown',
                        msgId: frontmatter['msg-id'] || 'unknown',
                        headline: frontmatter.headline || '',
                        status: frontmatter.status || '',
                        content: body,
                        rearmatter: rearmatter
                    }];
            }
            catch (_b) {
                return [2 /*return*/, null];
            }
            return [2 /*return*/];
        });
    });
}
function parseFrontmatter(yaml) {
    var data = {};
    for (var _i = 0, _a = yaml.split('\n'); _i < _a.length; _i++) {
        var line = _a[_i];
        var match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            data[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
        }
    }
    return data;
}
function parseRearmatter(yaml) {
    var data = {};
    for (var _i = 0, _a = yaml.split('\n'); _i < _a.length; _i++) {
        var line = _a[_i];
        var match = line.match(/^([^:]+):\s*(.*)$/);
        if (!match)
            continue;
        var key = match[1].trim();
        var raw = match[2].trim();
        if (/^-?\d+\.?\d*$/.test(raw)) {
            data[key] = parseFloat(raw);
        }
        else if (raw.startsWith('{') || raw.startsWith('[')) {
            try {
                data[key] = JSON.parse(raw);
            }
            catch (_b) {
                data[key] = raw;
            }
        }
        else {
            data[key] = raw;
        }
    }
    return data;
}
/**
 * Build the prompt that would be injected into the agent for this message
 * Mirrors sdk-runner.ts buildUserPrompt logic
 */
function buildInjectedPrompt(msg, msgsDir) {
    var parts = [];
    // Read the original message file to extract command frontmatter
    var filepath = msg.filepath;
    var command;
    try {
        var content = node_fs_1.default.readFileSync(filepath, 'utf-8');
        var fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
            var commandMatch = fmMatch[1].match(/^command:\s*(.+)$/m);
            if (commandMatch) {
                command = commandMatch[1].trim().replace(/^["']|["']$/g, '');
            }
        }
    }
    catch (_a) {
        // File may not exist
    }
    // If command specified, prepend it as raw slash command
    if (command) {
        parts.push("".concat(colors_ts_1.colors.cyan, "[SLASH COMMAND]").concat(colors_ts_1.colors.reset));
        parts.push(command);
        parts.push('');
    }
    parts.push('## Incoming Task');
    parts.push('');
    parts.push("**From**: ".concat(msg.from));
    parts.push("**Type**: ".concat(msg.type));
    if (msg.headline) {
        parts.push("**Headline**: ".concat(msg.headline));
    }
    if (msg.content) {
        parts.push('');
        parts.push(msg.content);
    }
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push("Write response messages to: ".concat(msgsDir, "/"));
    parts.push('When done, write a task-complete message to core/core.');
    return parts.join('\n');
}
/**
 * Check if message matches filters
 */
function matchesFilter(msg, options) {
    if (options.type && msg.type !== options.type)
        return false;
    if (options.agent) {
        var agent = options.agent.toLowerCase();
        var fromMatch = msg.from.toLowerCase().includes(agent);
        var toMatch = msg.to.toLowerCase().includes(agent);
        if (!fromMatch && !toMatch)
            return false;
    }
    if (options.mesh) {
        var mesh = options.mesh.toLowerCase();
        var fromMatch = msg.from.toLowerCase().includes(mesh);
        var toMatch = msg.to.toLowerCase().includes(mesh);
        if (!fromMatch && !toMatch)
            return false;
    }
    if (options.errors && msg.type !== 'error')
        return false;
    if (options.since) {
        var since = (0, time_ts_1.parseTimeFilter)(options.since);
        if (new Date(msg.timestamp) < since)
            return false;
    }
    if (options.before) {
        var before = (0, time_ts_1.parseTimeFilter)(options.before);
        if (new Date(msg.timestamp) > before)
            return false;
    }
    return true;
}
/**
 * Get message badge
 */
function getMessageBadge(msg) {
    if (msg.type === 'error' || msg.status === 'failed') {
        return "".concat(colors_ts_1.colors.red, "\u2717").concat(colors_ts_1.colors.reset);
    }
    return ' ';
}
/**
 * Display a single message (list view)
 */
function displayMessage(msg, options) {
    if (options === void 0) { options = {}; }
    var badge = getMessageBadge(msg);
    var time = (0, time_ts_1.formatTime)(msg.timestamp);
    var typeColor = typeColors[msg.type] || colors_ts_1.colors.white;
    var type = msg.type.padEnd(14);
    var from = msg.from.padEnd(25);
    var to = msg.to.padEnd(25);
    var line = "".concat(badge, " ").concat(colors_ts_1.colors.dim).concat(time).concat(colors_ts_1.colors.reset, " ").concat(typeColor).concat(type).concat(colors_ts_1.colors.reset, " ").concat(from, " ").concat(colors_ts_1.colors.dim, "\u2192").concat(colors_ts_1.colors.reset, " ").concat(to);
    if (msg.headline) {
        line += " ".concat(colors_ts_1.colors.bright).concat(msg.headline).concat(colors_ts_1.colors.reset);
    }
    console.log(line);
    if (options.verbose && msg.content) {
        var preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
        console.log("  ".concat(colors_ts_1.colors.dim).concat(preview).concat(preview.length < msg.content.length ? '...' : '').concat(colors_ts_1.colors.reset));
    }
}
/**
 * Get all messages from directory
 */
function getAllMessages(logDir) {
    return __awaiter(this, void 0, void 0, function () {
        var files, messages, _i, files_1, file, msg_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!node_fs_1.default.existsSync(logDir))
                        return [2 /*return*/, []];
                    files = node_fs_1.default.readdirSync(logDir);
                    messages = [];
                    _i = 0, files_1 = files;
                    _a.label = 1;
                case 1:
                    if (!(_i < files_1.length)) return [3 /*break*/, 4];
                    file = files_1[_i];
                    if (!file.endsWith('.md'))
                        return [3 /*break*/, 3];
                    return [4 /*yield*/, readMessage(node_path_1.default.join(logDir, file))];
                case 2:
                    msg_1 = _a.sent();
                    if (msg_1)
                        messages.push(msg_1);
                    _a.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, messages.sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); })];
            }
        });
    });
}
/**
 * Interactive mode with vim-style navigation
 */
function msgInteractive(logDir_1) {
    return __awaiter(this, arguments, void 0, function (logDir, options) {
        function clearScreen() {
            console.clear();
        }
        function displayList() {
            clearScreen();
            var header = "".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.cyan, "\uD83D\uDCE8 Messages").concat(colors_ts_1.colors.reset, " ").concat(colors_ts_1.colors.dim, "(").concat(messages.length, ")").concat(colors_ts_1.colors.reset);
            var controls = "".concat(colors_ts_1.colors.dim, "\u2191\u2193/jk nav  Enter/\u2192/l view  p prompt  f follow").concat(followMode ? ' ●' : ' ○', "  q quit").concat(colors_ts_1.colors.reset);
            console.log("\n".concat(header, "  ").concat(controls, "\n"));
            var visibleStart = Math.max(0, selectedIndex - 15);
            var visibleEnd = Math.min(messages.length, selectedIndex + 10);
            for (var i = visibleStart; i < visibleEnd; i++) {
                var msg_2 = messages[i];
                var isSelected = i === selectedIndex;
                if (isSelected) {
                    process.stdout.write("".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.cyan, "\u25B6 ").concat(colors_ts_1.colors.reset));
                }
                else {
                    process.stdout.write('  ');
                }
                var badge = getMessageBadge(msg_2);
                var time = (0, time_ts_1.formatTime)(msg_2.timestamp);
                var typeColor = typeColors[msg_2.type] || colors_ts_1.colors.white;
                var type = msg_2.type.padEnd(12);
                var from = msg_2.from.padEnd(20);
                var to = msg_2.to.padEnd(20);
                var headline = msg_2.headline ? " ".concat(msg_2.headline.substring(0, 40)) : '';
                console.log("".concat(badge, " ").concat(colors_ts_1.colors.dim).concat(time).concat(colors_ts_1.colors.reset, " ").concat(typeColor).concat(type).concat(colors_ts_1.colors.reset, " ").concat(from, " ").concat(colors_ts_1.colors.dim, "\u2192").concat(colors_ts_1.colors.reset, " ").concat(to).concat(headline));
            }
            console.log();
        }
        function displayDetail() {
            clearScreen();
            var msg = messages[selectedIndex];
            console.log("\n".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.cyan, "\uD83D\uDCE8 Message Detail").concat(colors_ts_1.colors.reset, " ").concat(colors_ts_1.colors.dim, "(").concat(selectedIndex + 1, "/").concat(messages.length, ")").concat(colors_ts_1.colors.reset));
            console.log("".concat(colors_ts_1.colors.dim, "\u2191\u2193/jk scroll  \u2190/h/Esc/q back  p prompt").concat(colors_ts_1.colors.reset, "\n"));
            // Metadata
            console.log("".concat(colors_ts_1.colors.dim, "Time:").concat(colors_ts_1.colors.reset, "     ").concat((0, time_ts_1.formatTime)(msg.timestamp)));
            console.log("".concat(colors_ts_1.colors.dim, "Type:").concat(colors_ts_1.colors.reset, "     ").concat(msg.type));
            console.log("".concat(colors_ts_1.colors.dim, "From:").concat(colors_ts_1.colors.reset, "     ").concat(msg.from));
            console.log("".concat(colors_ts_1.colors.dim, "To:").concat(colors_ts_1.colors.reset, "       ").concat(msg.to));
            if (msg.headline)
                console.log("".concat(colors_ts_1.colors.dim, "Headline:").concat(colors_ts_1.colors.reset, " ").concat(msg.headline));
            if (msg.msgId)
                console.log("".concat(colors_ts_1.colors.dim, "Msg ID:").concat(colors_ts_1.colors.reset, "   ").concat(msg.msgId));
            // Rearmatter
            if (msg.rearmatter) {
                console.log();
                console.log("".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.yellow, "Rearmatter").concat(colors_ts_1.colors.reset));
                if (msg.rearmatter.confidence !== undefined) {
                    var conf = msg.rearmatter.confidence;
                    var confColor = conf >= 0.9 ? colors_ts_1.colors.green : conf >= 0.7 ? colors_ts_1.colors.yellow : colors_ts_1.colors.red;
                    console.log("".concat(colors_ts_1.colors.dim, "Confidence:").concat(colors_ts_1.colors.reset, " ").concat(confColor).concat((conf * 100).toFixed(0), "%").concat(colors_ts_1.colors.reset));
                }
                if (msg.rearmatter.grade) {
                    var grade = msg.rearmatter.grade;
                    var gradeColor = ['A', 'B'].includes(grade) ? colors_ts_1.colors.green : ['C'].includes(grade) ? colors_ts_1.colors.yellow : colors_ts_1.colors.red;
                    console.log("".concat(colors_ts_1.colors.dim, "Grade:").concat(colors_ts_1.colors.reset, "      ").concat(gradeColor).concat(grade).concat(colors_ts_1.colors.reset));
                }
            }
            console.log();
            console.log(colors_ts_1.colors.dim + '─'.repeat(80) + colors_ts_1.colors.reset);
            console.log();
            // Content (scrollable)
            var content = msg.content || colors_ts_1.colors.dim + 'No content' + colors_ts_1.colors.reset;
            var contentLines = content.split('\n');
            var viewportHeight = Math.max(10, (process.stdout.rows || 40) - 20);
            var maxScroll = Math.max(0, contentLines.length - viewportHeight);
            detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));
            var visibleLines = contentLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
            visibleLines.forEach(function (line) { return console.log(line); });
            if (contentLines.length > viewportHeight) {
                var scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
                console.log();
                console.log("".concat(colors_ts_1.colors.dim, "[").concat(scrollPercent, "%] Line ").concat(detailScrollOffset + 1, "-").concat(Math.min(detailScrollOffset + viewportHeight, contentLines.length), " of ").concat(contentLines.length).concat(colors_ts_1.colors.reset));
            }
        }
        function displayPromptView() {
            clearScreen();
            var msg = messages[selectedIndex];
            console.log("\n".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.yellow, "\uD83D\uDCDD Injected Prompt").concat(colors_ts_1.colors.reset, " ").concat(colors_ts_1.colors.dim, "(").concat(selectedIndex + 1, "/").concat(messages.length, ")").concat(colors_ts_1.colors.reset));
            console.log("".concat(colors_ts_1.colors.dim, "\u2191\u2193/jk scroll  \u2190/h/Esc/q back").concat(colors_ts_1.colors.reset, "\n"));
            // Show what prompt would be injected for this message
            console.log("".concat(colors_ts_1.colors.dim, "To:").concat(colors_ts_1.colors.reset, " ").concat(msg.to));
            console.log("".concat(colors_ts_1.colors.dim, "Type:").concat(colors_ts_1.colors.reset, " ").concat(msg.type));
            console.log();
            console.log(colors_ts_1.colors.dim + '═'.repeat(80) + colors_ts_1.colors.reset);
            console.log("".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.yellow, "PROMPT THAT WOULD BE INJECTED:").concat(colors_ts_1.colors.reset));
            console.log(colors_ts_1.colors.dim + '═'.repeat(80) + colors_ts_1.colors.reset);
            console.log();
            // Build the injected prompt
            var prompt = buildInjectedPrompt(msg, logDir);
            var promptLines = prompt.split('\n');
            var viewportHeight = Math.max(10, (process.stdout.rows || 40) - 15);
            var maxScroll = Math.max(0, promptLines.length - viewportHeight);
            detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));
            var visibleLines = promptLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
            visibleLines.forEach(function (line) { return console.log(line); });
            if (promptLines.length > viewportHeight) {
                var scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
                console.log();
                console.log("".concat(colors_ts_1.colors.dim, "[").concat(scrollPercent, "%] Line ").concat(detailScrollOffset + 1, "-").concat(Math.min(detailScrollOffset + viewportHeight, promptLines.length), " of ").concat(promptLines.length).concat(colors_ts_1.colors.reset));
            }
        }
        function display() {
            if (viewingPrompt) {
                displayPromptView();
            }
            else if (viewingMessage) {
                displayDetail();
            }
            else {
                displayList();
            }
        }
        function setupWatcher() {
            var _this = this;
            if (watcher)
                return;
            watcher = (0, chokidar_1.watch)(logDir, {
                ignoreInitial: true,
                persistent: true,
                awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
            });
            watcher.on('add', function (filepath) { return __awaiter(_this, void 0, void 0, function () {
                var msg;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (!filepath.endsWith('.md'))
                                return [2 /*return*/];
                            return [4 /*yield*/, readMessage(filepath)];
                        case 1:
                            msg = _a.sent();
                            if (msg && matchesFilter(msg, options)) {
                                messages.push(msg);
                                messages.sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); });
                                selectedIndex = messages.length - 1;
                                if (!viewingMessage)
                                    display();
                            }
                            return [2 /*return*/];
                    }
                });
            }); });
        }
        function cleanup() {
            if (process.stdin.isTTY)
                process.stdin.setRawMode(false);
            process.stdin.pause();
            if (watcher)
                watcher.close();
            console.log("\n".concat(colors_ts_1.colors.dim, "Exited message viewer").concat(colors_ts_1.colors.reset, "\n"));
        }
        var messages, limit, selectedIndex, viewingMessage, viewingPrompt, detailScrollOffset, followMode, watcher;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getAllMessages(logDir)];
                case 1:
                    messages = _a.sent();
                    messages = messages.filter(function (msg) { return matchesFilter(msg, options); });
                    limit = parseInt(options.limit || '50');
                    messages = messages.slice(-limit);
                    if (messages.length === 0) {
                        console.log("".concat(colors_ts_1.colors.dim, "No messages found matching filters.").concat(colors_ts_1.colors.reset, "\n"));
                        return [2 /*return*/];
                    }
                    selectedIndex = messages.length - 1;
                    viewingMessage = false;
                    viewingPrompt = false;
                    detailScrollOffset = 0;
                    followMode = options.follow || false;
                    watcher = null;
                    if (followMode)
                        setupWatcher();
                    // Setup keyboard
                    node_readline_1.default.emitKeypressEvents(process.stdin);
                    if (process.stdin.isTTY)
                        process.stdin.setRawMode(true);
                    display();
                    process.stdin.on('keypress', function (_str, key) {
                        if (key.ctrl && key.name === 'c') {
                            cleanup();
                            process.exit(0);
                        }
                        if (viewingPrompt) {
                            // Prompt view navigation
                            var msg_3 = messages[selectedIndex];
                            var prompt_1 = buildInjectedPrompt(msg_3, logDir);
                            var promptLines = prompt_1.split('\n');
                            var viewportHeight = Math.max(10, (process.stdout.rows || 40) - 15);
                            var halfPage = Math.floor(viewportHeight / 2);
                            var maxScroll = Math.max(0, promptLines.length - viewportHeight);
                            switch (key.name) {
                                case 'up':
                                case 'k':
                                    detailScrollOffset = Math.max(0, detailScrollOffset - halfPage);
                                    display();
                                    break;
                                case 'down':
                                case 'j':
                                    detailScrollOffset = Math.min(maxScroll, detailScrollOffset + halfPage);
                                    display();
                                    break;
                                case 'left':
                                case 'h':
                                case 'escape':
                                case 'q':
                                    viewingPrompt = false;
                                    detailScrollOffset = 0;
                                    display();
                                    break;
                            }
                        }
                        else if (viewingMessage) {
                            var msg_4 = messages[selectedIndex];
                            var contentLines = (msg_4.content || '').split('\n');
                            var viewportHeight = Math.max(10, (process.stdout.rows || 40) - 20);
                            var halfPage = Math.floor(viewportHeight / 2);
                            var maxScroll = Math.max(0, contentLines.length - viewportHeight);
                            switch (key.name) {
                                case 'up':
                                case 'k':
                                    detailScrollOffset = Math.max(0, detailScrollOffset - halfPage);
                                    display();
                                    break;
                                case 'down':
                                case 'j':
                                    detailScrollOffset = Math.min(maxScroll, detailScrollOffset + halfPage);
                                    display();
                                    break;
                                case 'left':
                                case 'h':
                                case 'escape':
                                case 'q':
                                    viewingMessage = false;
                                    detailScrollOffset = 0;
                                    display();
                                    break;
                                case 'p':
                                    viewingMessage = false;
                                    viewingPrompt = true;
                                    detailScrollOffset = 0;
                                    display();
                                    break;
                            }
                        }
                        else {
                            switch (key.name) {
                                case 'up':
                                case 'k':
                                    if (selectedIndex > 0) {
                                        selectedIndex--;
                                        display();
                                    }
                                    break;
                                case 'down':
                                case 'j':
                                    if (selectedIndex < messages.length - 1) {
                                        selectedIndex++;
                                        display();
                                    }
                                    break;
                                case 'return':
                                case 'right':
                                case 'l':
                                    viewingMessage = true;
                                    detailScrollOffset = 0;
                                    display();
                                    break;
                                case 'p':
                                    viewingPrompt = true;
                                    detailScrollOffset = 0;
                                    display();
                                    break;
                                case 'f':
                                    followMode = !followMode;
                                    if (followMode)
                                        setupWatcher();
                                    else if (watcher) {
                                        watcher.close();
                                        watcher = null;
                                    }
                                    display();
                                    break;
                                case 'q':
                                    cleanup();
                                    process.exit(0);
                                    break;
                            }
                        }
                    });
                    process.on('SIGINT', cleanup);
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Simple list mode
 */
function msgList(logDir, options) {
    return __awaiter(this, void 0, void 0, function () {
        var messages, limit;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getAllMessages(logDir)];
                case 1:
                    messages = _a.sent();
                    messages = messages.filter(function (msg) { return matchesFilter(msg, options); });
                    limit = parseInt(options.limit || '50');
                    messages = messages.slice(-limit);
                    if (messages.length === 0) {
                        console.log("".concat(colors_ts_1.colors.dim, "No messages found matching filters.").concat(colors_ts_1.colors.reset, "\n"));
                        return [2 /*return*/];
                    }
                    console.log("\n".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.cyan, "\uD83D\uDCE8 Messages").concat(colors_ts_1.colors.reset, " ").concat(colors_ts_1.colors.dim, "(").concat(messages.length, ")").concat(colors_ts_1.colors.reset, "\n"));
                    messages.forEach(function (msg) { return displayMessage(msg, options); });
                    console.log();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * JSON output mode
 */
function msgJson(logDir, options) {
    return __awaiter(this, void 0, void 0, function () {
        var messages, limit;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getAllMessages(logDir)];
                case 1:
                    messages = _a.sent();
                    messages = messages.filter(function (msg) { return matchesFilter(msg, options); });
                    limit = parseInt(options.limit || '50');
                    messages = messages.slice(-limit);
                    console.log(JSON.stringify(messages, null, 2));
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Follow mode (tail -f style)
 */
function msgFollow(logDir, options) {
    return __awaiter(this, void 0, void 0, function () {
        var messages, limit, lastTimestamp, watcher;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("".concat(colors_ts_1.colors.bright).concat(colors_ts_1.colors.cyan, "\uD83D\uDCE8 Messages").concat(colors_ts_1.colors.reset, " ").concat(colors_ts_1.colors.dim, "(follow mode)").concat(colors_ts_1.colors.reset, "\n"));
                    return [4 /*yield*/, getAllMessages(logDir)];
                case 1:
                    messages = _a.sent();
                    messages = messages.filter(function (msg) { return matchesFilter(msg, options); });
                    limit = parseInt(options.limit || '20');
                    messages = messages.slice(-limit);
                    messages.forEach(function (msg) { return displayMessage(msg, options); });
                    console.log("\n".concat(colors_ts_1.colors.dim, "Watching for new messages... (Ctrl+C to exit)").concat(colors_ts_1.colors.reset, "\n"));
                    lastTimestamp = messages.length > 0 ? new Date(messages[messages.length - 1].timestamp).getTime() : 0;
                    watcher = (0, chokidar_1.watch)("".concat(logDir, "/*.md"), {
                        ignoreInitial: true,
                        persistent: true,
                        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
                    });
                    watcher.on('add', function (filepath) { return __awaiter(_this, void 0, void 0, function () {
                        var msg, msgTime;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, readMessage(filepath)];
                                case 1:
                                    msg = _a.sent();
                                    if (msg && matchesFilter(msg, options)) {
                                        msgTime = new Date(msg.timestamp).getTime();
                                        if (msgTime > lastTimestamp) {
                                            displayMessage(msg, options);
                                            lastTimestamp = msgTime;
                                        }
                                    }
                                    return [2 /*return*/];
                            }
                        });
                    }); });
                    process.on('SIGINT', function () {
                        watcher.close();
                        console.log("\n".concat(colors_ts_1.colors.dim, "Stopped watching messages").concat(colors_ts_1.colors.reset, "\n"));
                        process.exit(0);
                    });
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Main msg command
 */
function msg() {
    return __awaiter(this, arguments, void 0, function (options) {
        var logDir;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            logDir = '.ai/tx/msgs';
            if (!node_fs_1.default.existsSync(logDir)) {
                console.log("".concat(colors_ts_1.colors.yellow, "\u26A0").concat(colors_ts_1.colors.reset, " Message directory not found: ").concat(logDir));
                console.log("".concat(colors_ts_1.colors.dim, "No messages yet.").concat(colors_ts_1.colors.reset, "\n"));
                return [2 /*return*/];
            }
            // JSON output mode
            if (options.json) {
                return [2 /*return*/, msgJson(logDir, options)];
            }
            // Follow mode (non-interactive)
            if (options.follow && options.interactive === false) {
                return [2 /*return*/, msgFollow(logDir, options)];
            }
            // Interactive mode (default)
            if (options.interactive !== false) {
                return [2 /*return*/, msgInteractive(logDir, options)];
            }
            // Simple list mode
            return [2 /*return*/, msgList(logDir, options)];
        });
    });
}
