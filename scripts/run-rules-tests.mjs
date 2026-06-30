import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
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

const firebaseCliEntry = "node_modules/firebase-tools/lib/bin/firebase.js";
const localConfigRoot = path.join(process.cwd(), ".local-config");
const localConfigStore = path.join(localConfigRoot, "configstore");
mkdirSync(localConfigStore, { recursive: true });

const env = {
  ...process.env,
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  ALL_PROXY: "",
  NO_PROXY: "127.0.0.1,localhost",
  FIREBASE_SKIP_UPDATE_CHECK: "1",
  XDG_CONFIG_HOME: localConfigRoot,
};

const quotedNodePath = process.execPath.includes(" ")
  ? `"${process.execPath}"`
  : process.execPath;

try {
  await run(process.execPath, [
    firebaseCliEntry,
    "emulators:exec",
    "--project",
    "demo-people-rules",
    "--only",
    "firestore",
    `${quotedNodePath} --test tests/firestore.rules.test.mjs`,
  ], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
