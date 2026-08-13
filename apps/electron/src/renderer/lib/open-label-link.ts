/** Open a label value only when it resolves to an allowed external URL. */
export function openLabelLink(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  void window.electronAPI.openUrl(url.toString())
  return true
}
