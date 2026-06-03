import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = join(root, "data");
const pidPath = join(dataDir, "server.pid");
const logPath = join(dataDir, "dev-server.log");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const command = process.argv[2] || "start";

function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^path$/i.test(key)) {
      env.Path = value;
    } else {
      env[key] = value;
    }
  }
  return env;
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function readPid() {
  try {
    return Number(readFileSync(pidPath, "utf8").trim()) || null;
  } catch {
    return null;
  }
}

function removePid() {
  try {
    rmSync(pidPath, { force: true });
  } catch {
    // Nothing to clean up.
  }
}

function stopPid(pid) {
  if (!pid) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    removePid();
    return false;
  }
}

async function start() {
  mkdirSync(dataDir, { recursive: true });
  if (await isPortOpen()) {
    console.log(`Yarra server is already running at http://${host}:${port}`);
    return;
  }

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    detached: true,
    env: cleanEnv(),
    stdio: "ignore"
  });
  child.unref();
  writeFileSync(pidPath, `${child.pid}\n`, "utf8");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isPortOpen()) {
      console.log(`Yarra server started at http://${host}:${port} (pid ${child.pid})`);
      return;
    }
  }

  console.log(`Server launch requested (pid ${child.pid}), but port ${port} did not respond yet. Check ${logPath}`);
}

async function stop() {
  const pid = readPid();
  const stopped = stopPid(pid);
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (stopped || !(await isPortOpen())) {
    removePid();
    console.log("Yarra server stopped.");
    return;
  }
  console.log(`Port ${port} is still in use. Stop the process manually, then run this command again.`);
}

async function status() {
  if (await isPortOpen()) {
    console.log(`Yarra server is running at http://${host}:${port}`);
    return;
  }
  console.log("Yarra server is not running.");
}

if (command === "start") {
  await start();
} else if (command === "stop") {
  await stop();
} else if (command === "restart") {
  await stop();
  await start();
} else if (command === "status") {
  await status();
} else {
  console.error("Usage: node scripts/dev-server.js <start|stop|restart|status>");
  process.exitCode = 1;
}
