import { spawn } from "node:child_process";

function withBuildNodeOptions(env = process.env) {
  const heapFlag = "--max-old-space-size=6144";
  const existing = env.NODE_OPTIONS?.trim();
  const nodeOptions = existing?.includes(heapFlag)
    ? existing
    : [existing, heapFlag].filter(Boolean).join(" ");

  return {
    ...env,
    NODE_OPTIONS: nodeOptions,
  };
}

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
            env: withBuildNodeOptions(),
          })
        : spawn(command, args, {
            stdio: "inherit",
            env: withBuildNodeOptions(),
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
  await run("next", ["build", "--webpack"]);
  await run("next-css-obfuscator", []);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
