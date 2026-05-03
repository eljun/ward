const pty = require("node-pty");

const [, , command, ...args] = process.argv;

if (!command) {
  process.stderr.write("Usage: node pty-bridge.cjs <command> [...args]\n");
  process.exit(2);
}

const term = pty.spawn(command, args, {
  cols: Number(process.env.WARD_PTY_COLS ?? 100),
  rows: Number(process.env.WARD_PTY_ROWS ?? 30),
  cwd: process.cwd(),
  env: process.env
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => term.write(data));
process.stdin.resume();

term.onData((data) => process.stdout.write(data));
term.onExit(({ exitCode }) => process.exit(exitCode ?? 0));

const stop = () => {
  try {
    term.kill();
  } catch {
    process.exit(0);
  }
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
