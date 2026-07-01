import { useEffect, useRef, useState } from 'react'
import { getCachedImageObjectUrl, getOrFetchCachedImageObjectUrl } from '../lib/deferredImageCache'

export default function DeferredImageButton({
  imageUrl,
  count = 1,
  label = 'ดูรูป',
  className = '',
  onClick,
}) {
  const [previewSrc, setPreviewSrc] = useState(null)
  const [loading, setLoading] = useState(false)
  const previewObjectUrlRef = useRef(null)

  const updatePreview = src => {
    if (previewObjectUrlRef.current?.startsWith('blob:') && previewObjectUrlRef.current !== src) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
    }
    previewObjectUrlRef.current = src
    setPreviewSrc(src)
  }

  useEffect(() => {
    let active = true
    let objectUrl = null

    getCachedImageObjectUrl(imageUrl).then(src => {
      if (!active || !src) return
      objectUrl = src
      updatePreview(src)
    }).catch(() => {})

    return () => {
      active = false
      if (objectUrl?.startsWith('blob:') && objectUrl !== previewObjectUrlRef.current) URL.revokeObjectURL(objectUrl)
    }
  }, [imageUrl])

  useEffect(() => () => {
    if (previewObjectUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(previewObjectUrlRef.current)
  }, [])

  const handleClick = async event => {
    if (!imageUrl) {
      onClick?.(event)
      return
    }

    setLoading(true)
    try {
      const src = await getOrFetchCachedImageObjectUrl(imageUrl)
      if (src) updatePreview(src)
      onClick?.(event, src || imageUrl)
    } catch {
      onClick?.(event, imageUrl)
    } finally {
      setLoading(false)
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleClick(event)
        }
      }}
      className={`deferred-image-button ${className}`}
      aria-label={count > 1 ? `${label} ${count} รูป` : label}
    >
      {previewSrc && (
        <img
          src={previewSrc}
          alt=""
          className="deferred-image-button__preview"
          draggable="false"
        />
      )}
      <span className="deferred-image-button__icon">{loading ? '...' : 'รูป'}</span>
      {count > 1 && <span className="deferred-image-button__count">{count}</span>}
    </span>
  )
}
