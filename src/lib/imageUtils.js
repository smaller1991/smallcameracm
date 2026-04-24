export function compressImage(file, maxW = 1200, q = 0.82) {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width, h = img.height
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        canvas.toBlob(blob => {
          if (!blob) return rej(new Error('compress failed'))
          res(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
        }, 'image/jpeg', q)
      }
      img.onerror = rej
      img.src = e.target.result
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

export async function uploadImages(supabase, productId, files) {
  const urls = []
  for (const file of files) {
    const compressed = await compressImage(file)
    const path = `${productId}/${Date.now()}_${compressed.name}`
    const { error } = await supabase.storage.from('product-images').upload(path, compressed)
    if (error) throw error
    const { data } = supabase.storage.from('product-images').getPublicUrl(path)
    urls.push(data.publicUrl)
  }
  return urls
}

export async function deleteImage(supabase, url) {
  const path = url.split('/product-images/')[1]
  if (path) await supabase.storage.from('product-images').remove([path])
}
