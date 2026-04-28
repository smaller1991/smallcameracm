import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { thDate } from './dateUtils'

const STATUS_TH = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว' }
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
const safeStr = s => (s || '').replace(/[/\\:*?"<>|]/g, '_')

// ─── Generate Import Template ─────────────────────────────────
export function downloadImportTemplate() {
  const wb = XLSX.utils.book_new()

  // Sheet 1: Products
  const pData = [
    ['ชื่อรุ่น *','Serial Number *','ประเภท *','เกรดสภาพ * (1-5)','ราคาซื้อ (บาท) *','สถานะ *','ราคาขาย (บาท)','ช่องทางชำระ','วันที่รับเข้า (DD/MM/YYYY HH.mm)','วันที่ขาย (DD/MM/YYYY HH.mm)','หมายเหตุ'],
    ['Fujifilm X100V','AB12345','กล้อง',4,28000,'Available','','','01/04/2568 10.00','','ตัวอย่าง — ลบแถวนี้ออก'],
    ['Sony A7III','CD67890','กล้อง',5,55000,'Sold',65000,'โอน','15/03/2568 09.00','20/03/2568 15.30','ตัวอย่าง — ลบแถวนี้ออก'],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(pData)
  ws1['!cols'] = [20,18,12,16,18,14,18,14,26,26,20].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws1, 'สต็อกสินค้า')

  // Sheet 2: Transactions
  const tData = [
    ['วันที่ * (DD/MM/YYYY HH.mm)','ประเภท * (Income/Expense)','หมวดหมู่ *','จำนวนเงิน (บาท) *','หมายเหตุ'],
    ['01/04/2568 10.00','Expense','Buy Stock',28000,'ตัวอย่าง — ลบแถวนี้ออก'],
    ['20/03/2568 15.30','Income','Sale',65000,'ตัวอย่าง — ลบแถวนี้ออก'],
    ['01/04/2568 09.00','Expense','Marketing',500,'ตัวอย่าง — ลบแถวนี้ออก'],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(tData)
  ws2['!cols'] = [28,22,16,20,30].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws2, 'รายการบัญชี')

  XLSX.writeFile(wb, 'camshop_import_template.xlsx')
}

function write(rows, sheet, filename) {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, filename)
}

export function exportInventory(products, statusFilter = 'all') {
  const rows = products
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .map(p => ({
      'รุ่น':              p.model,
      'Serial Number':     p.serial_number,
      'เกรดสภาพ':         p.condition,
      'สถานะ':            STATUS_TH[p.status] || p.status,
      'ต้นทุนเริ่มต้น':   Number(p.base_cost),
      'ต้นทุนรวม':        Number(p.total_cost),
      'ราคาขาย':          p.sold_price ? Number(p.sold_price) : '',
      'กำไร':             p.sold_price ? Number(p.sold_price) - Number(p.total_cost) : '',
      'วันที่รับเข้า':    thDate(p.created_at),
      'วันที่ขาย':        thDate(p.sold_date),
      'วันหมดประกัน':    thDate(p.warranty_expiry),
      'รายละเอียดลูกค้า': p.customer_note || '',
      'หมายเหตุ':         p.notes || '',
    }))
  if (!rows.length) return alert('ไม่มีข้อมูล')
  write(rows, 'สต็อกสินค้า', `สต็อกสินค้า_${stamp()}.xlsx`)
}

export function exportTransactions(transactions, from, to) {
  const filtered = transactions.filter(t => {
    const d = new Date(t.date)
    if (from && d < new Date(from)) return false
    if (to   && d > new Date(to + 'T23:59:59')) return false
    return true
  })
  if (!filtered.length) return alert('ไม่มีข้อมูล')

  const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
  const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)

  const rows = filtered.map(t => {
    let pl = ''
    if (t.category === 'Sale' && t.products?.total_cost != null)
      pl = Number(t.amount) - Number(t.products.total_cost)
    else if (t.category === 'Trade' && t.trade_profit_a != null)
      pl = Number(t.trade_profit_a)
    return {
      'วันที่':        thDate(t.date),
      'ประเภท':       t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
      'หมวดหมู่':     t.category,
      'จำนวนเงิน':    Number(t.amount),
      'รายรับ':       t.type === 'Income' ? Number(t.amount) : '',
      'รายจ่าย':      t.type === 'Expense' ? Number(t.amount) : '',
      'กำไรขาดทุน':        pl,
      'รุ่นกล้อง':         t.products?.model || '',
      'รายละเอียดลูกค้า':  t.category === 'Sale' ? (t.products?.customer_note || '') : '',
      'หมายเหตุ':          t.note || '',
    }
  })

  const totalProfit = rows.reduce((a, r) => r['กำไรขาดทุน'] !== '' ? a + r['กำไรขาดทุน'] : a, 0)

  const empty = { 'วันที่':'','ประเภท':'','หมวดหมู่':'','จำนวนเงิน':'','รายรับ':'','รายจ่าย':'','กำไรขาดทุน':'','รุ่นกล้อง':'','รายละเอียดลูกค้า':'','หมายเหตุ':'' }
  rows.push(empty)
  rows.push({ ...empty, 'วันที่':'สรุป', 'หมวดหมู่':'รวมรายรับ',       'รายรับ':    totalIncome  })
  rows.push({ ...empty,                  'หมวดหมู่':'รวมรายจ่าย',      'รายจ่าย':   totalExpense })
  rows.push({ ...empty,                  'หมวดหมู่':'กำไรขาดทุนสุทธิ', 'กำไรขาดทุน': totalProfit })

  write(rows, 'รายการบัญชี', `รายการบัญชี_${stamp()}.xlsx`)
}

// ─── Shared: load Sarabun font and init jsPDF doc ────────────
async function initPDFDoc(orientation = 'landscape') {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const res    = await fetch('/fonts/Sarabun-Regular.ttf')
  const buf    = await res.arrayBuffer()
  const b64    = btoa(String.fromCharCode(...new Uint8Array(buf)))
  const doc    = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  doc.addFileToVFS('Sarabun-Regular.ttf', b64)
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
  doc.setFont('Sarabun')
  return { doc, autoTable }
}

// ─── Inventory PDF blob ───────────────────────────────────────
async function buildInventoryPDF(filtered) {
  const { doc, autoTable } = await initPDFDoc()

  doc.setFontSize(14); doc.setTextColor(26, 18, 8)
  doc.text('สต็อกสินค้า', 14, 14)
  doc.setFontSize(8); doc.setTextColor(170, 170, 170)
  doc.text(`สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`, 14, 20)

  const head = [['รุ่น','Serial','ประเภท','เกรด','สถานะ','ต้นทุนรวม','ราคาขาย','กำไร','วันรับเข้า','วันขาย','หมายเหตุ']]
  const body = filtered.map(p => {
    const profit = p.sold_price ? Number(p.sold_price) - Number(p.total_cost) : ''
    return [
      p.model || '', p.serial_number || '', p.category || 'กล้อง',
      String(p.condition || ''), STATUS_TH[p.status] || p.status,
      Number(p.total_cost || 0).toLocaleString('th-TH'),
      p.sold_price ? Number(p.sold_price).toLocaleString('th-TH') : '',
      profit !== '' ? profit.toLocaleString('th-TH') : '',
      thDate(p.created_at), thDate(p.sold_date),
      p.notes || '',
    ]
  })

  autoTable(doc, {
    head, body, startY: 24,
    styles:             { font: 'Sarabun', fontSize: 9, cellPadding: 2.5 },
    headStyles:         { fillColor: [26, 18, 8], textColor: [255, 184, 56], fontStyle: 'normal' },
    alternateRowStyles: { fillColor: [255, 251, 240] },
    columnStyles: {
      0: { cellWidth: 34 }, 1: { cellWidth: 24 }, 2: { cellWidth: 20 },
      3: { cellWidth: 12, halign: 'center' }, 4: { cellWidth: 20 },
      5: { cellWidth: 22, halign: 'right' }, 6: { cellWidth: 20, halign: 'right' },
      7: { cellWidth: 20, halign: 'right' }, 8: { cellWidth: 30 }, 9: { cellWidth: 30 },
    },
    margin: { left: 14, right: 14 },
  })
  return doc.output('blob')
}

// ─── Transactions PDF blob ────────────────────────────────────
async function buildTransactionsPDF(filtered) {
  const { doc, autoTable } = await initPDFDoc()

  doc.setFontSize(14); doc.setTextColor(26, 18, 8)
  doc.text('รายการบัญชี', 14, 14)
  doc.setFontSize(8); doc.setTextColor(170, 170, 170)
  doc.text(`สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`, 14, 20)

  const head = [['วันที่','ประเภท','หมวดหมู่','จำนวนเงิน','รายรับ','รายจ่าย','กำไรขาดทุน','รุ่นกล้อง','หมายเหตุ']]
  const plValues = []
  const body = filtered.map(t => {
    let pl = ''
    if (t.category === 'Sale' && t.products?.total_cost != null)
      pl = Number(t.amount) - Number(t.products.total_cost)
    else if (t.category === 'Trade' && t.trade_profit_a != null)
      pl = Number(t.trade_profit_a)
    plValues.push(pl)
    return [
      thDate(t.date),
      t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
      t.category,
      Number(t.amount).toLocaleString('th-TH'),
      t.type === 'Income'  ? Number(t.amount).toLocaleString('th-TH') : '',
      t.type === 'Expense' ? Number(t.amount).toLocaleString('th-TH') : '',
      pl !== '' ? pl.toLocaleString('th-TH') : '',
      t.products?.model || '',
      t.note || '',
    ]
  })

  autoTable(doc, {
    head, body, startY: 24,
    styles:             { font: 'Sarabun', fontSize: 8, cellPadding: 2 },
    headStyles:         { fillColor: [26, 18, 8], textColor: [255, 184, 56], fontStyle: 'normal' },
    alternateRowStyles: { fillColor: [255, 251, 240] },
    columnStyles: {
      0: { cellWidth: 34 }, 1: { cellWidth: 16 }, 2: { cellWidth: 20 },
      3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' }, 6: { cellWidth: 24, halign: 'right' },
      7: { cellWidth: 34 },
    },
    margin: { left: 14, right: 14 },
  })

  const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
  const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)
  const totalProfit  = plValues.reduce((a, v) => v !== '' ? a + v : a, 0)
  const fy = (doc.lastAutoTable?.finalY || 24) + 7
  doc.setFont('Sarabun'); doc.setFontSize(9); doc.setTextColor(26, 18, 8)
  doc.text(`รวมรายรับ: ${totalIncome.toLocaleString('th-TH')} บาท`, 14, fy)
  doc.text(`รวมรายจ่าย: ${totalExpense.toLocaleString('th-TH')} บาท`, 14, fy + 6)
  doc.text(`กำไรขาดทุนสุทธิ: ${totalProfit.toLocaleString('th-TH')} บาท`, 14, fy + 12)

  return doc.output('blob')
}

// ─── Export Inventory + Images as ZIP ────────────────────────
export async function exportInventoryWithImages(products, statusFilter = 'all', format = 'xlsx', onProgress) {
  const filtered = products.filter(p => statusFilter === 'all' || p.status === statusFilter)
  if (!filtered.length) { alert('ไม่มีข้อมูล'); return }

  const zip = new JSZip()
  const s = stamp()

  if (format === 'xlsx') {
    const rows = filtered.map(p => ({
      'รุ่น':              p.model,
      'Serial Number':     p.serial_number,
      'เกรดสภาพ':         p.condition,
      'สถานะ':            STATUS_TH[p.status] || p.status,
      'ต้นทุนเริ่มต้น':   Number(p.base_cost),
      'ต้นทุนรวม':        Number(p.total_cost),
      'ราคาขาย':          p.sold_price ? Number(p.sold_price) : '',
      'กำไร':             p.sold_price ? Number(p.sold_price) - Number(p.total_cost) : '',
      'วันที่รับเข้า':    thDate(p.created_at),
      'วันที่ขาย':        thDate(p.sold_date),
      'วันหมดประกัน':    thDate(p.warranty_expiry),
      'รายละเอียดลูกค้า': p.customer_note || '',
      'หมายเหตุ':         p.notes || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'สต็อกสินค้า')
    const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    zip.file(`สต็อกสินค้า_${s}.xlsx`, xlsxBuf)
  } else {
    const pdfBlob = await buildInventoryPDF(filtered)
    zip.file(`สต็อกสินค้า_${s}.pdf`, pdfBlob)
  }

  // Images — group by day folder
  const imgRoot = zip.folder('รูปภาพ')
  const total = filtered.reduce((a, p) => a + (p.images?.length || 0), 0)
  let done = 0

  for (const p of filtered) {
    if (!p.images?.length) continue

    // Folder name = day of sale (if sold) or day of purchase
    const refDate = p.sold_date ? new Date(p.sold_date) : new Date(p.created_at)
    const dayKey  = refDate.toISOString().slice(0, 10)          // YYYY-MM-DD
    const dayFolder = imgRoot.folder(dayKey)

    const buyPart  = p.created_at ? new Date(p.created_at).toISOString().slice(0, 10).replace(/-/g, '') : 'nodate'
    const sellPart = p.sold_date  ? new Date(p.sold_date).toISOString().slice(0, 10).replace(/-/g, '')  : '-'
    const price    = p.sold_price ? Number(p.sold_price) : Number(p.base_cost)
    const model    = safeStr(p.model)

    for (let i = 0; i < p.images.length; i++) {
      try {
        const res = await fetch(p.images[i])
        const buf = await res.arrayBuffer()
        const ext = (p.images[i].split('?')[0].split('.').pop() || 'jpg').toLowerCase()
        const fname = `${model}_ซื้อ${buyPart}_ขาย${sellPart}_${price}_${i + 1}.${ext}`
        dayFolder.file(fname, buf)
      } catch { /* skip inaccessible image */ }
      done++
      onProgress?.(done, total)
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `สต็อกสินค้า_พร้อมรูป_${s}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Export Transactions + Images as ZIP ─────────────────────
export async function exportTransactionsWithImages(transactions, from, to, format = 'xlsx', onProgress) {
  const filtered = transactions.filter(t => {
    if (from && new Date(t.date) < new Date(from)) return false
    if (to   && new Date(t.date) > new Date(to + 'T23:59:59')) return false
    return true
  })
  if (!filtered.length) { alert('ไม่มีข้อมูล'); return }

  const zip = new JSZip()
  const s   = stamp()

  if (format === 'xlsx') {
    const rows = filtered.map(t => {
      let pl = ''
      if (t.category === 'Sale' && t.products?.total_cost != null)
        pl = Number(t.amount) - Number(t.products.total_cost)
      else if (t.category === 'Trade' && t.trade_profit_a != null)
        pl = Number(t.trade_profit_a)
      return {
        'วันที่':            thDate(t.date),
        'ประเภท':           t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
        'หมวดหมู่':         t.category,
        'จำนวนเงิน':        Number(t.amount),
        'รายรับ':           t.type === 'Income'  ? Number(t.amount) : '',
        'รายจ่าย':          t.type === 'Expense' ? Number(t.amount) : '',
        'กำไรขาดทุน':       pl,
        'รุ่นกล้อง':        t.products?.model || '',
        'รายละเอียดลูกค้า': t.category === 'Sale' ? (t.products?.customer_note || '') : '',
        'หมายเหตุ':         t.note || '',
      }
    })
    const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
    const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)
    const totalProfit  = rows.reduce((a, r) => r['กำไรขาดทุน'] !== '' ? a + r['กำไรขาดทุน'] : a, 0)
    const empty = Object.fromEntries(Object.keys(rows[0]).map(k => [k, '']))
    rows.push(empty)
    rows.push({ ...empty, 'วันที่': 'สรุป', 'หมวดหมู่': 'รวมรายรับ',       'รายรับ':     totalIncome  })
    rows.push({ ...empty,                   'หมวดหมู่': 'รวมรายจ่าย',      'รายจ่าย':    totalExpense })
    rows.push({ ...empty,                   'หมวดหมู่': 'กำไรขาดทุนสุทธิ', 'กำไรขาดทุน': totalProfit  })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'รายการบัญชี')
    zip.file(`รายการบัญชี_${s}.xlsx`, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }))
  } else {
    zip.file(`รายการบัญชี_${s}.pdf`, await buildTransactionsPDF(filtered))
  }

  // Deduplicate product images by product_id
  const productImgMap = new Map()
  for (const t of filtered) {
    if (!t.product_id || !t.products?.images?.length) continue
    if (!productImgMap.has(t.product_id)) {
      productImgMap.set(t.product_id, {
        images:     t.products.images,
        model:      t.products.model,
        created_at: t.products.created_at,
        sold_date:  t.products.sold_date,
        date:       t.date,
      })
    }
  }

  const totalReceipt = filtered.reduce((a, t) => a + (t.images?.length || 0), 0)
  const totalProduct = [...productImgMap.values()].reduce((a, p) => a + p.images.length, 0)
  const grandTotal   = totalReceipt + totalProduct
  let done = 0

  // Receipt images — grouped by day
  const receiptRoot = zip.folder('รูปใบเสร็จ')
  for (const t of filtered) {
    if (!t.images?.length) continue
    const dayKey    = new Date(t.date).toISOString().slice(0, 10)
    const dayFolder = receiptRoot.folder(dayKey)
    const dateStr   = dayKey.replace(/-/g, '')
    const label     = safeStr(t.products?.model || t.category)

    for (let i = 0; i < t.images.length; i++) {
      try {
        const res = await fetch(t.images[i])
        const buf = await res.arrayBuffer()
        const ext = (t.images[i].split('?')[0].split('.').pop() || 'jpg').toLowerCase()
        dayFolder.file(`${label}_${dateStr}_${Number(t.amount).toLocaleString('th-TH')}_${i + 1}.${ext}`, buf)
      } catch { /* skip */ }
      done++
      onProgress?.(done, grandTotal)
    }
  }

  // Product images — grouped by day, deduplicated by product_id
  const productRoot = zip.folder('รูปสินค้า')
  for (const [, p] of productImgMap) {
    const dayKey    = new Date(p.sold_date || p.date || p.created_at).toISOString().slice(0, 10)
    const dayFolder = productRoot.folder(dayKey)
    const model     = safeStr(p.model)
    const buyPart   = p.created_at ? new Date(p.created_at).toISOString().slice(0, 10).replace(/-/g, '') : 'nodate'
    const sellPart  = p.sold_date  ? new Date(p.sold_date).toISOString().slice(0, 10).replace(/-/g, '')  : '-'

    for (let i = 0; i < p.images.length; i++) {
      try {
        const res = await fetch(p.images[i])
        const buf = await res.arrayBuffer()
        const ext = (p.images[i].split('?')[0].split('.').pop() || 'jpg').toLowerCase()
        dayFolder.file(`${model}_ซื้อ${buyPart}_ขาย${sellPart}_${i + 1}.${ext}`, buf)
      } catch { /* skip */ }
      done++
      onProgress?.(done, grandTotal)
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `รายการบัญชี_พร้อมรูป_${s}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
