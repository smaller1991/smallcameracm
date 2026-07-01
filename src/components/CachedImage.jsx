import { useEffect, useState } from 'react'
import { getOrFetchCachedImageObjectUrl } from '../lib/deferredImageCache'

export default function CachedImage({ src, alt = '', className = '', onClick }) {
  const [displaySrc, setDisplaySrc] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl = null
    setDisplaySrc(null)
    setFailed(false)

    if (src?.startsWith('blob:')) {
      setDisplaySrc(src)
      return () => {
        active = false
      }
    }

    getOrFetchCachedImageObjectUrl(src).then(url => {
      if (!active || !url) return
      objectUrl = url
      setDisplaySrc(url)
    }).catch(() => {
      if (active) setFailed(true)
    })

    return () => {
      active = false
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  if (failed) {
    return <div className={`cached-image-fallback ${className}`}>โหลดรูปไม่ได้</div>
  }

  if (!displaySrc) {
    return <div className={`cached-image-loading ${className}`}>กำลังโหลดรูป...</div>
  }

  return <img src={displaySrc} alt={alt} className={className} onClick={onClick}/>
}
