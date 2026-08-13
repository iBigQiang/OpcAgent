#!/usr/bin/env bun

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { generateReleaseManifest } from "./generate-release-manifest";

const [inputArg, outputArg, versionArg] = Bun.argv.slice(2);
if (!inputArg || !outputArg || !versionArg) {
  throw new Error(
    "usage: collect-release-assets.ts <artifact-dir> <output-dir> <version>",
  );
}

const ignored = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);
const files: string[] = [];
function walk(path: string): void {
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) walk(child);
    else if (!ignored.has(entry)) files.push(child);
  }
}
walk(inputArg);

const grouped = new Map<string, string[]>();
for (const path of files) {
  const name = basename(path);
  grouped.set(name, [...(grouped.get(name) ?? []), path]);
}

rmSync(outputArg, { recursive: true, force: true });
mkdirSync(outputArg, { recursive: true });

for (const [name, paths] of grouped) {
  const destination = join(outputArg, name);
  if (paths.length === 1) {
    copyFileSync(paths[0]!, destination);
    continue;
  }
  if (name !== "latest-mac.yml")
    throw new Error(`duplicate release asset name: ${name}`);

  const manifests = paths.map(
    (path) => yaml.load(readFileSync(path, "utf8")) as Record<string, unknown>,
  );
  const allFiles = manifests.flatMap((manifest) =>
    Array.isArray(manifest.files) ? manifest.files : [],
  );
  const uniqueFiles = [
    ...new Map(
      allFiles.map((file) => [(file as { url?: string }).url, file]),
    ).values(),
  ];
  const expectedMacUrls = [
    `OPC-Agent-${versionArg}-arm64.dmg`,
    `OPC-Agent-${versionArg}-arm64.zip`,
    `OPC-Agent-${versionArg}-x64.dmg`,
    `OPC-Agent-${versionArg}-x64.zip`,
  ];
  const macUrls = new Set(
    uniqueFiles.map((file) => (file as { url?: string }).url),
  );
  const missingMacUrls = expectedMacUrls.filter((url) => !macUrls.has(url));
  if (
    uniqueFiles.length !== expectedMacUrls.length ||
    missingMacUrls.length > 0
  )
    throw new Error(
      `invalid macOS update entries: expected ${expectedMacUrls.join(", ")}; ` +
        `found ${[...macUrls].join(", ")}`,
    );
  const first = manifests[0]!;
  const preferred =
    uniqueFiles.find(
      (file) =>
        (file as { url?: string }).url === `OPC-Agent-${versionArg}-arm64.zip`,
    ) ?? uniqueFiles[0];
  writeFileSync(
    destination,
    yaml.dump(
      {
        version: first.version,
        files: uniqueFiles,
        path: (preferred as { url?: string }).url,
        sha512: (preferred as { sha512?: string }).sha512,
        releaseDate: manifests
          .map((item) => item.releaseDate)
          .filter(Boolean)
          .sort()
          .at(-1),
      },
      { lineWidth: -1, noRefs: true },
    ),
  );
}

const required = [
  `OPC-Agent-${versionArg}-arm64.dmg`,
  `OPC-Agent-${versionArg}-arm64.zip`,
  `OPC-Agent-${versionArg}-x64.dmg`,
  `OPC-Agent-${versionArg}-x64.zip`,
  `OPC-Agent-${versionArg}-x64.exe`,
  `OPC-Agent-${versionArg}-x86_64.AppImage`,
  "latest-mac.yml",
  "latest.yml",
  "latest-linux.yml",
  "OPC-Agent-cli-bun.tar.gz",
];
const collectedNames = readdirSync(outputArg).sort();
for (const name of required) {
  if (!existsSync(join(outputArg, name)))
    throw new Error(`missing required release asset: ${name}`);
}
for (const platform of [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "linux-x64",
]) {
  if (
    !collectedNames.some((name) =>
      name.startsWith(`OPC-Agent-server-${versionArg}-${platform}.`),
    )
  ) {
    throw new Error(`missing headless server archive for ${platform}`);
  }
}

generateReleaseManifest(
  join(outputArg, "OPC-Agent-cli-bun.tar.gz"),
  join(outputArg, "manifest.json"),
  versionArg,
);
const names = readdirSync(outputArg).sort();

const checksums = names
  .map(
    (name) =>
      `${createHash("sha256")
        .update(readFileSync(join(outputArg, name)))
        .digest("hex")}  ${name}`,
  )
  .join("\n");
writeFileSync(join(outputArg, "SHA256SUMS"), `${checksums}\n`);
console.log(`Collected ${names.length} release assets for v${versionArg}`);
