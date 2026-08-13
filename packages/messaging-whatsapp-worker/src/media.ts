import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export async function writeMediaAttachment(buffer: Buffer, filename = 'attachment.bin'): Promise<{ localPath: string; filename: string; size: number }> {
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 20 MB limit')
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment.bin'
  const localPath = join(tmpdir(), `mkagent-wa-${randomUUID()}-${safe}`)
  await writeFile(localPath, buffer)
  return { localPath, filename: safe, size: buffer.byteLength }
}
