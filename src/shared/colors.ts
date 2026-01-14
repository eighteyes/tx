/**
 * ANSI color codes and chalk-style helpers
 */

export const colors = {
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
  redBright: '\x1b[91m',
  greenBright: '\x1b[92m',
  yellowBright: '\x1b[93m',
  blueBright: '\x1b[94m',
  magentaBright: '\x1b[95m',
  cyanBright: '\x1b[96m'
};

// Chalk-style helper functions
export const chalk = {
  red: (text: string) => `${colors.red}${text}${colors.reset}`,
  yellow: (text: string) => `${colors.yellow}${text}${colors.reset}`,
  blue: (text: string) => `${colors.blue}${text}${colors.reset}`,
  cyan: (text: string) => `${colors.cyan}${text}${colors.reset}`,
  green: (text: string) => `${colors.green}${text}${colors.reset}`,
  magenta: (text: string) => `${colors.magenta}${text}${colors.reset}`,
  white: (text: string) => `${colors.white}${text}${colors.reset}`,
  gray: (text: string) => `${colors.gray}${text}${colors.reset}`,
  dim: (text: string) => `${colors.dim}${text}${colors.reset}`,
  bold: (text: string) => `${colors.bright}${text}${colors.reset}`,
  redBright: (text: string) => `${colors.redBright}${text}${colors.reset}`,
  greenBright: (text: string) => `${colors.greenBright}${text}${colors.reset}`,
  yellowBright: (text: string) => `${colors.yellowBright}${text}${colors.reset}`,
  blueBright: (text: string) => `${colors.blueBright}${text}${colors.reset}`,
  magentaBright: (text: string) => `${colors.magentaBright}${text}${colors.reset}`,
  cyanBright: (text: string) => `${colors.cyanBright}${text}${colors.reset}`,
};
