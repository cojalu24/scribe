// Small shims for browser features that older Safari lacks. Loaded first so
// every library (pdf.js, the AI runtimes) sees them.

if (typeof (Promise as any).withResolvers !== 'function') {
  ;(Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// Safari < 26 can't `for await (… of stream)` over a ReadableStream — pdf.js
// relies on it in getTextContent. Teach it the async-iteration protocol.
const rsProto: any = typeof ReadableStream !== 'undefined' ? ReadableStream.prototype : null
if (rsProto && typeof rsProto[Symbol.asyncIterator] !== 'function') {
  rsProto[Symbol.asyncIterator] = function () {
    const reader = this.getReader()
    return {
      next: async () => {
        const r = await reader.read()
        if (r.done) reader.releaseLock()
        return r.done ? { done: true, value: undefined } : { done: false, value: r.value }
      },
      return: async (value: unknown) => {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
        return { done: true, value }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }
  if (typeof rsProto.values !== 'function') rsProto.values = rsProto[Symbol.asyncIterator]
}

export {}
