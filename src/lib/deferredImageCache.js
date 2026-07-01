const CACHE_NAME = 'snapman-viewed-images-v1'
const META_KEY = 'snapman-viewed-images-meta-v1'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const canUseCacheStorage = () =>
  typeof window !== 'undefined' && 'caches' in window && typeof localStorage !== 'undefined'

function readMeta() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeMeta(meta) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

function isFresh(url, meta = readMeta()) {
  const ts = meta[url]
  return Boolean(ts && Date.now() - ts < MAX_AGE_MS)
}

async function responseToObjectUrl(response) {
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export async function getCachedImageObjectUrl(url) {
  if (!url || !canUseCacheStorage()) return null
  const meta = readMeta()
  if (!isFresh(url, meta)) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.delete(url)
    } catch {}
    if (meta[url]) {
      delete meta[url]
      writeMeta(meta)
    }
    return null
  }

  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(url)
  if (!cached) return null
  return responseToObjectUrl(cached)
}

export async function getOrFetchCachedImageObjectUrl(url) {
  if (!url) return null

  const cachedUrl = await getCachedImageObjectUrl(url)
  if (cachedUrl) return cachedUrl

  if (!canUseCacheStorage()) return url

  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`)

  const cache = await caches.open(CACHE_NAME)
  await cache.put(url, response.clone())

  const meta = readMeta()
  meta[url] = Date.now()
  writeMeta(meta)

  return responseToObjectUrl(response)
}
