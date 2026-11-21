import { useCallback, useEffect, useRef, useState } from 'react'

export const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError'

type State<T> = {
  key: string | undefined
  data?: T
  error?: string
  pending: boolean
}

export function useResource<T>(
  key: string | undefined,
  fetchData: (signal: AbortSignal) => Promise<T>,
  interval?: number,
) {
  const [state, setState] = useState<State<T>>({ key, pending: Boolean(key) })
  const request = useRef<AbortController | null>(null)
  const refresh = useCallback(
    async (quiet = false) => {
      if (!key || (quiet && request.current)) return
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      setState((previous) => ({
        key,
        data: previous.key === key ? previous.data : undefined,
        pending: !quiet || (previous.key === key && previous.pending),
      }))
      try {
        const data = await fetchData(controller.signal)
        if (!controller.signal.aborted) setState({ key, data, pending: false })
      } catch (error) {
        if (!controller.signal.aborted) {
          setState((previous) => ({
            ...previous,
            pending: false,
            error: error instanceof Error ? error.message : '请求失败',
          }))
        }
      } finally {
        if (request.current === controller) request.current = null
      }
    },
    [key, fetchData],
  )

  useEffect(() => {
    void refresh()
    return () => {
      request.current?.abort()
      request.current = null
    }
  }, [refresh])
  useEffect(() => {
    if (!interval || !key) return
    const update = () => {
      if (document.visibilityState === 'visible') void refresh(true)
    }
    const timer = window.setInterval(update, interval)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [key, interval, refresh])

  return {
    ...(state.key === key
      ? state
      : { data: undefined, pending: Boolean(key), error: undefined }),
    refresh,
  }
}
