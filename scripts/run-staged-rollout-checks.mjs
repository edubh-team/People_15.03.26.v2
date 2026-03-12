import { spawnSync } from "node:child_process";

const PREFIX = readArg("--prefix") ?? "staging_q2";
const SKIP_BUILD = process.argv.includes("--skip-build");

function readArg(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).trim() : null;
}

function runStep(step) {
  console.log(`\n[${step.id}] ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    shell: true,
  });
  const code = typeof result.status === "number" ? result.status : 1;
  if (code !== 0) {
    throw new Error(`${step.id} failed with exit code ${code}.`);
  }
}

function main() {
  const steps = [
    {
      id: "CP-1",
      label: "Rules + typing gate",
      command: "npm",
      args: ["run", "typecheck"],
    },
    {
      id: "CP-2",
      label: "Rules regression suite",
      command: "npm",
      args: ["run", "test:rules"],
    },
    ...(SKIP_BUILD
      ? []
      : [
          {
            id: "CP-3",
            label: "Production build gate",
            command: "npm",
            args: ["run", "build"],
          },
        ]),
    {
      id: "CP-4",
      label: "Role-wise UAT data readiness",
      command: "npm",
      args: ["run", "verify:uat", "--", `--prefix=${PREFIX}`],
    },
    {
      id: "CP-5",
      label: "Bi-weekly dry-run simulation (2 cycles)",
      command: "npm",
      args: ["run", "simulate:biweekly", "--", "--cycles=2", `--prefix=${PREFIX}`],
    },
  ];

  console.log(`Running staged rollout gates with prefix=${PREFIX}${SKIP_BUILD ? " (build skipped)" : ""}`);
  for (const step of steps) {
    runStep(step);
  }
  console.log("\nAll staged rollout checkpoints passed.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
