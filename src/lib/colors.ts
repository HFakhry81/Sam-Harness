export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
};

export function live(agent: string, action: string) {
  const t = new Date().toLocaleTimeString();
  console.log(
    `\n${colors.cyan}[LIVE @ ${t}]${colors.reset} ${colors.bright}${agent}${colors.reset} -> ${colors.dim}${action}${colors.reset}`
  );
}

export function ok(tag: string, msg: string) {
  console.log(`${colors.green}[OK] [${tag}]${colors.reset} ${msg}`);
}

export function warn(tag: string, msg: string) {
  console.log(`${colors.yellow}[!] [${tag}]${colors.reset} ${msg}`);
}

export function err(tag: string, msg: string) {
  console.log(`${colors.red}[Error] [${tag}]${colors.reset} ${msg}`);
}

export function sys(msg: string) {
  console.log(`${colors.blue}[System]${colors.reset} ${msg}`);
}
