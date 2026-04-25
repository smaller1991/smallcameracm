// ─── compress ────────────────────────────────────────────────
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

// ─── ตั้งชื่อไฟล์ตาม spec: YYYYMMDD_ชื่อสินค้า_Serial ──────────
function safeStr(s) {
  return (s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '_').slice(0, 30)
}
function dateStr(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}

/**
 * สร้าง storage path สำหรับรูปสินค้า
 * format: product-images/{productId}/{buy_date}_{sell_date}_{model}_{serial}_{timestamp}.jpg
 */
function makeProductPath(productId, meta, idx) {
  const buyDate  = dateStr(meta.created_at)
  const sellDate = meta.sold_date ? dateStr(meta.sold_date) : 'notsold'
  const model    = safeStr(meta.model)
  const serial   = safeStr(meta.serial_number)
  const ts       = Date.now() + idx
  return `${productId}/${buyDate}_${sellDate}_${model}_${serial}_${ts}.jpg`
}

// ─── upload สินค้า ────────────────────────────────────────────
export async function uploadImages(supabase, productId, files, meta = {}) {
  const urls = []
  for (let i = 0; i < files.length; i++) {
    const compressed = await compressImage(files[i])
    const path = makeProductPath(productId, meta, i)
    const { error } = await supabase.storage.from('product-images').upload(path, compressed, { upsert: false })
    if (error) throw error
    const { data } = supabase.storage.from('product-images').getPublicUrl(path)
    urls.push(data.publicUrl)
  }
  return urls
}

// ─── upload ใบเสร็จ (transaction) พร้อมตั้งชื่อตาม spec ─────
export async function uploadReceiptImages(supabase, txId, files, meta = {}) {
  const urls = []

  // ดึงรายการไฟล์ที่มีอยู่แล้วใน folder เพื่อตรวจชื่อซ้ำ
  const { data: existingFiles } = await supabase.storage
    .from('receipt-images').list(String(txId))
  const existingNames = new Set((existingFiles||[]).map(f => f.name))

  for (let i = 0; i < files.length; i++) {
    const compressed = await compressImage(files[i])

    // ตั้งชื่อ: buyDate_sellDate_model_serial
    const buyDate  = dateStr(meta.created_at)
    const sellDate = meta.sold_date ? dateStr(meta.sold_date) : dateStr(new Date().toISOString())
    const model    = safeStr(meta.model)
    const serial   = safeStr(meta.serial_number)
    const baseName = `${buyDate}_${sellDate}_${model}_${serial}`

    // ตรวจชื่อซ้ำ ถ้าซ้ำให้ใส่ (1), (2), ...
    let fileName = `${baseName}.jpg`
    let counter  = 1
    while (existingNames.has(fileName)) {
      fileName = `${baseName}(${counter}).jpg`
      counter++
    }
    existingNames.add(fileName) // กัน race condition ในลูปเดียวกัน

    const path = `${txId}/${fileName}`
    const { error } = await supabase.storage
      .from('receipt-images').upload(path, compressed, { upsert: false })
    if (error) throw error
    const { data } = supabase.storage.from('receipt-images').getPublicUrl(path)
    urls.push(data.publicUrl)
  }
  return urls
}

// ─── delete รูปสินค้า ──────────────────────────────────────────
export async function deleteImage(supabase, url) {
  const path = url.split('/product-images/')[1]
  if (path) await supabase.storage.from('product-images').remove([decodeURIComponent(path)])
}

// ─── delete รูปใบเสร็จ ─────────────────────────────────────────
export async function deleteReceiptImage(supabase, url) {
  const path = url.split('/receipt-images/')[1]
  if (path) await supabase.storage.from('receipt-images').remove([decodeURIComponent(path)])
}

// ─── delete รูปทั้งหมดใน folder ของสินค้า (ตอนลบสินค้า) ──────
export async function deleteAllProductImages(supabase, productId) {
  const { data: files } = await supabase.storage.from('product-images').list(productId)
  if (files?.length) {
    const paths = files.map(f => `${productId}/${f.name}`)
    await supabase.storage.from('product-images').remove(paths)
  }
}
