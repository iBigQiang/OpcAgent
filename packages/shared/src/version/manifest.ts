import { debug } from "../utils/debug";

const RELEASES_API_URL = 'https://api.github.com/repos/iBigQiang/OpcAgent/releases';
const RELEASE_DOWNLOAD_URL = 'https://github.com/iBigQiang/OpcAgent/releases/download';
const RELEASE_TAG_PREFIX = 'v';

export async function getLatestVersion(): Promise<string | null> {
    try {
      const response = await fetch(`${RELEASES_API_URL}/latest`);
      if (!response.ok) {
        debug(`[manifest] Latest release request failed: ${response.status}`);
        return null;
      }
      const data = await response.json();
      const tag = (data as { tag_name?: string }).tag_name;
      if (typeof tag !== 'string' || !tag.startsWith(RELEASE_TAG_PREFIX)) {
        debug('[manifest] Latest release tag is not a valid OPC Agent tag');
        return null;
      }
      return tag.slice(RELEASE_TAG_PREFIX.length) || null;
    } catch (error) {
      debug(`[manifest] Failed to get latest version: ${error}`);
    }
    return null;
}

export async function getManifest(version: string): Promise<VersionManifest | null> {
    try {
        const url = `${RELEASE_DOWNLOAD_URL}/${RELEASE_TAG_PREFIX}${version}/manifest.json`;
        debug(`[manifest] Getting manifest for version: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
          debug(`[manifest] Manifest request failed: ${response.status}`);
          return null;
        }
        const data = await response.json();
        return data as VersionManifest;
    } catch (error) {
        debug(`[manifest] Failed to get manifest: ${error}`);
    }
    return null;
}


export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  filename?: string;
}

export interface VersionManifest {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, BinaryInfo>;
}
