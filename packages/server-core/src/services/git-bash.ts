import { stat } from 'fs/promises'
import { win32 } from 'path'

/**
 * Basic file-name validation for Git Bash executable paths.
 * Accepts Windows-style and POSIX-style separators to support cross-platform tests.
 */
export function isGitBashExecutablePath(filePath: string): boolean {
  return /(?:^|[\\/])bash\.exe$/i.test(filePath.trim())
}

/**
 * Derive Git Bash locations from `where git` output on Windows.
 * Git for Windows exposes git.exe from <root>\cmd and bash.exe from <root>\bin.
 */
export function deriveGitBashPathsFromGitPaths(whereOutput: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  for (const line of whereOutput.split(/\r?\n/)) {
    const gitPath = line.trim()
    if (!/(?:^|[\\/])git\.exe$/i.test(gitPath)) continue

    const bashPath = win32.join(win32.dirname(gitPath), '..', 'bin', 'bash.exe')
    const key = bashPath.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    candidates.push(bashPath)
  }

  return candidates
}

/**
 * Validate a user-provided Git Bash executable path.
 * Enforces bash.exe filename and existence on disk.
 */
export async function validateGitBashPath(filePath: string): Promise<{ valid: true; path: string } | { valid: false; error: string }> {
  const trimmedPath = filePath.trim()

  if (!isGitBashExecutablePath(trimmedPath)) {
    return { valid: false, error: 'Path must point to bash.exe' }
  }

  try {
    const info = await stat(trimmedPath)
    if (!info.isFile()) {
      return { valid: false, error: 'Path must point to a file' }
    }
    return { valid: true, path: trimmedPath }
  } catch {
    return { valid: false, error: 'File does not exist at the specified path' }
  }
}

/**
 * Check if a Git Bash path is usable without returning UI-facing errors.
 */
export async function isUsableGitBashPath(filePath: string): Promise<boolean> {
  const result = await validateGitBashPath(filePath)
  return result.valid
}
