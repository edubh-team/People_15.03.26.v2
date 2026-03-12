import { spawn } from "node:child_process";

function quoteForCmd(arg) {
  if (!/[\s"]/u.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn(process.env.ComSpec || "cmd.exe", [
            "/d",
            "/s",
            "/c",
            [command, ...args].map(quoteForCmd).join(" "),
          ], {
            stdio: "inherit",
          })
        : spawn(command, args, {
            stdio: "inherit",
          });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

try {
  await run("node", ["node_modules/next/dist/bin/next", "typegen"]);
  await run("tsc", ["--noEmit", "--incremental", "false"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
