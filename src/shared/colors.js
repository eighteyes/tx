"use strict";
/**
 * ANSI color codes and chalk-style helpers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.chalk = exports.colors = void 0;
exports.colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    redBright: '\x1b[91m'
};
// Chalk-style helper functions
exports.chalk = {
    red: function (text) { return "".concat(exports.colors.red).concat(text).concat(exports.colors.reset); },
    yellow: function (text) { return "".concat(exports.colors.yellow).concat(text).concat(exports.colors.reset); },
    blue: function (text) { return "".concat(exports.colors.blue).concat(text).concat(exports.colors.reset); },
    cyan: function (text) { return "".concat(exports.colors.cyan).concat(text).concat(exports.colors.reset); },
    green: function (text) { return "".concat(exports.colors.green).concat(text).concat(exports.colors.reset); },
    magenta: function (text) { return "".concat(exports.colors.magenta).concat(text).concat(exports.colors.reset); },
    white: function (text) { return "".concat(exports.colors.white).concat(text).concat(exports.colors.reset); },
    gray: function (text) { return "".concat(exports.colors.gray).concat(text).concat(exports.colors.reset); },
    dim: function (text) { return "".concat(exports.colors.dim).concat(text).concat(exports.colors.reset); },
    bold: function (text) { return "".concat(exports.colors.bright).concat(text).concat(exports.colors.reset); },
};
