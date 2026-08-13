#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export function generateReleaseManifest(
  archivePath: string,
  outputPath: string,
  version: string,
): void {
  const archive = readFileSync(archivePath);
  const filename = basename(archivePath);
  const tag = `v${version}`;
  const url = `https://github.com/iBigQiang/OpcAgent/releases/download/${tag}/${filename}`;
  const binary = {
    url,
    sha256: createHash("sha256").update(archive).digest("hex"),
    size: archive.byteLength,
    filename,
  };
  const now = new Date();
  const manifest = {
    version,
    build_time: now.toISOString(),
    build_timestamp: now.getTime(),
    binaries: {
      "darwin-arm64": binary,
      "darwin-x64": binary,
      "linux-x64": binary,
    },
  };
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  const [archiveArg, outputArg, versionArg] = Bun.argv.slice(2);
  if (!archiveArg || !outputArg || !versionArg) {
    throw new Error(
      "usage: generate-release-manifest.ts <cli-archive> <output> <version>",
    );
  }
  generateReleaseManifest(resolve(archiveArg), resolve(outputArg), versionArg);
}
