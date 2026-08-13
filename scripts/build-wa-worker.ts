import { spawn } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const workerDir = join(rootDir, "packages/messaging-whatsapp-worker");
const source = join(workerDir, "src/worker.ts");
const distDir = join(workerDir, "dist");
const output = join(distDir, "worker.cjs");

async function main(): Promise<void> {
  if (!existsSync(source)) throw new Error(`WhatsApp worker source not found: ${source}`);
  mkdirSync(distDir, { recursive: true });

  const process = spawn({
    cmd: [
      "bun",
      "run",
      "esbuild",
      source,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      `--outfile=${output}`,
      "--external:electron",
      "--external:link-preview-js",
      "--external:qrcode-terminal",
      "--external:jimp",
    ],
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) process.exit(exitCode);
  if (!existsSync(output) || statSync(output).size === 0) {
    throw new Error(`WhatsApp worker build produced no output: ${output}`);
  }

  const syntaxCheck = spawn({
    cmd: ["node", "--check", output],
    stdout: "inherit",
    stderr: "inherit",
  });
  const syntaxExitCode = await syntaxCheck.exited;
  if (syntaxExitCode !== 0) process.exit(syntaxExitCode);
}

await main();
