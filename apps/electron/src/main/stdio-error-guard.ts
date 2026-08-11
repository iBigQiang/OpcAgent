interface ErrorEventStream {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
}

export function installStdioEpipeGuard(
  stream: ErrorEventStream | undefined,
  onEpipe: () => void,
): void {
  stream?.on('error', (error) => {
    if (error?.code === 'EPIPE') {
      onEpipe()
      return
    }

    throw error
  })
}
