import { supabase } from './supabase'

export const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

export const vatDocumentOf = tx => (
  Array.isArray(tx?.vat_documents) ? tx.vat_documents[0] : tx?.vat_documents
)

export function amountBeforeVat(amount, document) {
  const gross = roundMoney(amount)
  const doc = document || null
  const documentTotal = Number(doc?.total_amount || 0)
  const documentSubtotal = Number(doc?.subtotal || 0)
  if (!doc || documentTotal <= 0 || documentSubtotal < 0) return gross
  return roundMoney(gross * documentSubtotal / documentTotal)
}

export const profitAfterVat = (saleAmount, cost, document) => (
  roundMoney(amountBeforeVat(saleAmount, document) - Number(cost || 0))
)

export function calculateVat(amount, rate = 7, inclusive = true) {
  const input = roundMoney(amount)
  const numericRate = Number(rate || 0)
  if (!numericRate) return { subtotal: input, vat: 0, total: input }
  if (inclusive) {
    const vat = roundMoney(input * numericRate / (100 + numericRate))
    return { subtotal: roundMoney(input - vat), vat, total: input }
  }
  const vat = roundMoney(input * numericRate / 100)
  return { subtotal: input, vat, total: roundMoney(input + vat) }
}

export async function getVatSettings() {
  const { data, error } = await supabase.from('vat_settings').select('*').eq('id', 'main').single()
  if (error) throw error
  return data
}

export async function createVatDraft({
  sourceKey,
  sourceType = 'sale',
  transactionIds = [],
  saleBatchId = null,
  documentDate,
  items = [],
  grossTotal,
  paymentMethod = null,
  customerName = '',
  note = '',
}) {
  const settings = await getVatSettings()
  if (!settings?.enabled) return null

  const { data: existing } = await supabase
    .from('vat_documents')
    .select('*')
    .eq('source_key', sourceKey)
    .maybeSingle()
  if (existing) return existing

  const totals = calculateVat(grossTotal, settings.vat_rate, settings.prices_include_vat)
  const normalizedItems = items.map(item => {
    const quantity = Number(item.quantity || 1)
    const gross = roundMoney(item.total_amount ?? (Number(item.unit_price || 0) * quantity))
    const itemTax = calculateVat(gross, settings.vat_rate, settings.prices_include_vat)
    return {
      description: item.description || 'สินค้า',
      serial_number: item.serial_number || '',
      quantity,
      unit_price: roundMoney(item.unit_price ?? (gross / quantity)),
      subtotal: itemTax.subtotal,
      vat_amount: itemTax.vat,
      total_amount: itemTax.total,
    }
  })

  const businessSnapshot = {
    name: settings.business_name,
    seller_name: settings.seller_name,
    tax_id: settings.business_tax_id,
    address: settings.business_address,
    branch: settings.business_branch,
    phone: settings.business_phone,
    footer_note: settings.footer_note,
  }

  const payload = {
    source_key: sourceKey,
    source_type: sourceType,
    source_transaction_ids: transactionIds,
    source_sale_batch_id: saleBatchId,
    document_type: settings.default_document_type || 'abbreviated',
    document_date: documentDate || new Date().toISOString(),
    customer_name: customerName || null,
    items: normalizedItems,
    subtotal: totals.subtotal,
    vat_rate: settings.vat_rate,
    vat_amount: totals.vat,
    total_amount: totals.total,
    payment_method: paymentMethod,
    note: note || null,
    business_snapshot: businessSnapshot,
  }

  const { data: document, error } = await supabase
    .from('vat_documents')
    .insert(payload)
    .select()
    .single()
  if (error) throw error

  if (transactionIds.length) {
    await supabase.from('transactions').update({ vat_document_id: document.id }).in('id', transactionIds)
  }
  await supabase.from('vat_document_events').insert({
    document_id: document.id,
    action: 'draft_created',
    detail: { source_key: sourceKey, total_amount: totals.total },
  })
  return document
}

export const vatSourceKey = (type, value) => `${type}:${value}`

export async function voidVatDraftsForTransactions(transactionIds, reason = 'ยกเลิกตามรายการขายที่ถูกย้อนกลับ') {
  const ids = [...new Set((transactionIds || []).filter(Boolean))]
  if (!ids.length) return []

  const { data: drafts, error: findError } = await supabase
    .from('vat_documents')
    .select('id')
    .eq('status', 'draft')
    .overlaps('source_transaction_ids', ids)
  if (findError) throw findError
  if (!drafts?.length) return []

  const documentIds = drafts.map(document => document.id)
  const voidedAt = new Date().toISOString()
  const { data: voided, error: updateError } = await supabase
    .from('vat_documents')
    .update({ status: 'void', voided_at: voidedAt, void_reason: reason })
    .in('id', documentIds)
    .eq('status', 'draft')
    .select()
  if (updateError) throw updateError

  if (voided?.length) {
    const { error: eventError } = await supabase.from('vat_document_events').insert(
      voided.map(document => ({
        document_id: document.id,
        action: 'draft_auto_voided',
        detail: { reason, source_transaction_ids: ids },
      })),
    )
    if (eventError) throw eventError
  }
  return voided || []
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const money = value => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const vatRateLabel = value => Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const thaiDate = value => new Date(value).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })

async function openA4Pdf(html, fileName, pageSelector) {
  const win = window.open('', '_blank')
  if (!win) throw new Error('กรุณาอนุญาต Pop-up เพื่อพิมพ์เอกสาร')
  win.document.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title></title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#efe8df;font-family:Arial,sans-serif;color:#2e1d19}.loading{padding:24px;text-align:center}</style></head><body><div class="loading"><strong>กำลังสร้าง PDF ขนาด A4...</strong><br><small>กรุณาอย่าปิดหน้านี้</small></div></body></html>')
  win.document.close()

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;'
  document.body.appendChild(frame)

  try {
    const frameLoaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
    frame.srcdoc = html
    await frameLoaded
    await frame.contentDocument.fonts?.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])
    const pages = [...frame.contentDocument.querySelectorAll(pageSelector)]
    if (!pages.length) throw new Error('ไม่พบหน้าเอกสารสำหรับสร้าง PDF')

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    pdf.setProperties({ title: fileName.replace(/\.pdf$/i, '') })
    for (let index = 0; index < pages.length; index += 1) {
      if (index > 0) pdf.addPage('a4', 'portrait')
      const page = pages[index]
      const canvas = await html2canvas(page, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        width: page.offsetWidth,
        height: page.offsetHeight,
        windowWidth: page.offsetWidth,
        windowHeight: page.offsetHeight,
      })
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    }

    const pdfUrl = URL.createObjectURL(pdf.output('blob'))
    win.location.replace(pdfUrl)
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 10 * 60 * 1000)
    return fileName
  } catch (error) {
    win.close()
    throw error
  } finally {
    frame.remove()
  }
}

export async function openVatDocumentPrint(document, settings, onPrinted) {
  const isAbbreviated = document.document_type === 'abbreviated'
  const business = document.status === 'issued'
    ? (document.business_snapshot || {})
    : {
        name: settings?.business_name,
        seller_name: settings?.seller_name,
        tax_id: settings?.business_tax_id,
        address: settings?.business_address,
        branch: settings?.business_branch,
        phone: settings?.business_phone,
        footer_note: isAbbreviated ? settings?.abbreviated_footer_note : settings?.footer_note,
      }
  const rows = (document.items || []).map((item, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td><strong>${escapeHtml(item.description)}</strong>${item.serial_number ? `<br><small>Serial: ${escapeHtml(item.serial_number)}</small>` : ''}</td>
      <td class="center">${item.quantity}</td>
      <td class="num">${money(isAbbreviated ? Number(item.total_amount || 0) / Number(item.quantity || 1) : item.unit_price)}</td>
      <td class="num">${money(item.total_amount)}</td>
    </tr>`).join('')
  const isDraft = document.status !== 'issued'
  const documentLabel = isDraft ? 'ฉบับร่าง — ยังไม่ใช่เลขเอกสารจริง' : document.document_number
  const documentTitle = isAbbreviated ? 'ใบกำกับภาษีอย่างย่อ / ใบเสร็จรับเงิน' : 'ใบกำกับภาษี / ใบเสร็จรับเงิน'
  const customerBlock = isAbbreviated
    ? `<div class="box-title">ผู้ซื้อ</div><div class="detail-line"><span>ชื่อ</span><strong>${escapeHtml(document.customer_name || 'ลูกค้าทั่วไป')}</strong></div>`
    : `<div class="box-title">ผู้ซื้อ</div>
       <div class="detail-line"><span>ชื่อ</span><strong>${escapeHtml(document.customer_name || 'ลูกค้าทั่วไป')}</strong></div>
       <div class="detail-line"><span>เลขประจำตัวผู้เสียภาษี</span><strong>${escapeHtml(document.customer_tax_id || '-')}</strong></div>
       <div class="detail-line"><span>ที่อยู่</span><strong>${escapeHtml(document.customer_address || '-')}</strong></div>
       <div class="detail-line"><span>เบอร์โทร</span><strong>${escapeHtml(document.customer_phone || '-')}</strong></div>
       <div class="detail-line"><span>สาขา</span><strong>${escapeHtml(document.customer_branch || '-')}</strong></div>`
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title></title>
  <style>
    *{box-sizing:border-box}html,body{width:210mm;margin:0;padding:0;background:#fff}body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#2e1d19;font-size:11.5px;line-height:1.45}.sheet{position:relative;display:flex;flex-direction:column;width:210mm;height:297mm;overflow:hidden;padding:12mm;background:#fff}.page-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #c8b6a8;font-size:10px;color:#6f625e}.page-meta strong{color:#2e1d19}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #721811;padding-bottom:10px}.business{width:58%;min-width:0;text-align:left}.brand{margin-bottom:5px;color:#721811;font-size:21px;font-weight:800;line-height:1.25;text-align:left}.business-details{display:grid;gap:2px;text-align:left}.detail-line{display:grid;grid-template-columns:105px minmax(0,1fr);align-items:start;gap:7px;min-width:0;line-height:1.5;text-align:left}.detail-line>span{color:#6f625e;font-size:10px;font-weight:700;text-align:left}.detail-line>strong{min-width:0;font-size:11px;font-weight:700;overflow-wrap:anywhere;text-align:left}.title{max-width:42%;text-align:right;font-size:17px;font-weight:800;line-height:1.35}.muted{color:#6f625e}.grid{display:block;margin:11px 0}.box{width:100%;border:1px solid #c8b6a8;border-radius:8px;padding:9px;min-width:0;min-height:76px;overflow-wrap:anywhere;text-align:left}.box-title{margin:0 0 6px;font-size:13px;font-weight:800;line-height:1.35;text-align:left}.box .detail-line{grid-template-columns:112px minmax(0,1fr);margin-top:2px}.box .detail-line>span{line-height:1.45}table{width:100%;border-collapse:collapse;margin-top:9px;table-layout:fixed}th{background:#efe8df;color:#3b211c}th,td{border:1px solid #c8b6a8;padding:6px;vertical-align:top;overflow-wrap:anywhere}.center{text-align:center}.num{text-align:right;white-space:nowrap}.tax-included-note{margin-top:8px;padding:6px 8px;background:#efe8df;border-radius:6px;text-align:right;font-weight:700;color:#6f625e}.totals{margin-left:auto;width:270px;max-width:100%;margin-top:10px}.totals div{display:flex;justify-content:space-between;gap:12px;padding:4px 0}.totals .grand{margin-top:5px;padding-top:7px;border-top:2px solid #721811;font-size:15px;font-weight:800;color:#721811}.foot{margin-top:12px;padding-top:7px;border-top:1px solid #c8b6a8}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:26mm;margin-top:auto;padding-top:18px;text-align:center}.signature-space{height:18mm;border-bottom:1px solid #6f625e}.signature-label{padding-top:5px;font-weight:700}.signature-date{padding-top:4px;color:#6f625e;font-size:10px}.watermark{position:absolute;inset:42% 0 auto;text-align:center;font-size:64px;font-weight:900;color:rgba(114,24,17,.1);transform:rotate(-18deg);pointer-events:none}
  </style></head><body><div class="sheet">${isDraft ? '<div class="watermark">ฉบับร่าง</div>' : ''}
    <div class="page-meta"><span></span><span>หน้า 1 / 1</span></div>
    <div class="top"><div class="business"><div class="brand">${escapeHtml(business.name || 'SMALL CAMERA')}</div><div class="business-details">
      <div class="detail-line"><span>ชื่อผู้ขาย</span><strong>${escapeHtml((business.seller_name ?? settings?.seller_name) || '-')}</strong></div>
      <div class="detail-line"><span>เลขประจำตัวผู้เสียภาษี</span><strong>${escapeHtml(business.tax_id || '-')}</strong></div>
      <div class="detail-line"><span>ที่อยู่</span><strong>${escapeHtml(business.address || '-')}</strong></div>
      <div class="detail-line"><span>เบอร์โทร</span><strong>${escapeHtml(business.phone || '-')}</strong></div>
      <div class="detail-line"><span>สาขา</span><strong>${escapeHtml(business.branch || 'สำนักงานใหญ่')}</strong></div>
    </div></div><div class="title">${documentTitle}<div class="muted" style="font-size:11.5px;margin-top:4px">เลขที่ ${escapeHtml(documentLabel)}</div><div class="muted" style="font-size:11.5px">วันที่ ${thaiDate(document.document_date)}</div></div></div>
    <div class="grid"><div class="box">${customerBlock}</div></div>
    <table><thead><tr><th style="width:42px">ลำดับ</th><th>รายการ</th><th style="width:58px">จำนวน</th><th style="width:105px">ราคาต่อหน่วย</th><th style="width:110px">รวม</th></tr></thead><tbody>${rows}</tbody></table>
    ${isAbbreviated ? '<div class="tax-included-note">ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว</div>' : ''}
    <div class="totals"><div><span>มูลค่าก่อนภาษีมูลค่าเพิ่ม</span><strong>${money(document.subtotal)} บาท</strong></div><div><span>ภาษีมูลค่าเพิ่ม ${vatRateLabel(document.vat_rate)}%</span><strong>${money(document.vat_amount)} บาท</strong></div><div class="grand"><span>ยอดรวมสุทธิ</span><span>${money(document.total_amount)} บาท</span></div></div>
    ${business.footer_note ? `<div class="foot">${escapeHtml(business.footer_note)}</div>` : ''}
    <div class="signatures">
      <div><div class="signature-space"></div><div class="signature-label">ลายเซ็นผู้ซื้อ / ผู้รับสินค้า</div><div class="signature-date">วันที่ ______ / ______ / ______</div></div>
      <div><div class="signature-space"></div><div class="signature-label">ลายเซ็นผู้ขาย / ผู้รับเงิน</div><div class="signature-date">วันที่ ______ / ______ / ______</div></div>
    </div>
  </div></body></html>`
  await openA4Pdf(html, `${document.document_number || 'ร่างใบกำกับภาษี'}.pdf`, '.sheet')
  await onPrinted?.()
}

export async function openVatReportPrint(documents, settings, periodLabel) {
  const totalBase = documents.reduce((sum, doc) => sum + Number(doc.subtotal || 0), 0)
  const totalVat = documents.reduce((sum, doc) => sum + Number(doc.vat_amount || 0), 0)
  const totalGross = documents.reduce((sum, doc) => sum + Number(doc.total_amount || 0), 0)
  const rowsPerPage = 20
  const pageCount = Math.max(1, Math.ceil(documents.length / rowsPerPage))
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const pageDocuments = documents.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage)
    const rows = pageDocuments.map((doc, rowIndex) => `<tr><td class="center">${pageIndex * rowsPerPage + rowIndex + 1}</td><td>${thaiDate(doc.document_date)}</td><td>${escapeHtml(doc.document_number || 'ร่าง')}<br><small>${doc.document_type === 'abbreviated' ? 'อย่างย่อ' : 'เต็มรูป'}</small></td><td>${escapeHtml(doc.customer_name || 'ลูกค้าทั่วไป')}</td><td class="num">${money(doc.subtotal)}</td><td class="num">${money(doc.vat_amount)}</td><td class="num">${money(doc.total_amount)}</td></tr>`).join('')
    const totals = pageIndex === pageCount - 1
      ? `<tfoot><tr><td colspan="4">รวมทั้งรายงาน</td><td class="num">${money(totalBase)}</td><td class="num">${money(totalVat)}</td><td class="num">${money(totalGross)}</td></tr></tfoot>`
      : ''
    return `<section class="report-page"><div class="page-meta"><span></span><span>หน้า ${pageIndex + 1} / ${pageCount}</span></div><header><div><h1>รายงานภาษีขาย</h1><strong>${escapeHtml(settings?.business_name || 'SMALL CAMERA')}</strong></div><div class="business-meta">เลขประจำตัวผู้เสียภาษี ${escapeHtml(settings?.business_tax_id || '-')}<br>ช่วงรายงาน ${escapeHtml(periodLabel)}</div></header><table><colgroup><col class="c-no"><col class="c-date"><col class="c-doc"><col><col class="c-money"><col class="c-money"><col class="c-money"></colgroup><thead><tr><th>ลำดับ</th><th>วันที่</th><th>เลขเอกสาร</th><th>ลูกค้า</th><th>ก่อน VAT</th><th>ภาษีขาย</th><th>ยอดรวม</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">ไม่มีรายการ</td></tr>'}</tbody>${totals}</table></section>`
  }).join('')
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title></title><style>*{box-sizing:border-box}html,body{width:210mm;margin:0;padding:0;background:#fff}body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#2e1d19;font-size:9.5px;line-height:1.35}.report-page{width:210mm;height:297mm;overflow:hidden;padding:10mm;background:#fff}.page-meta{display:flex;justify-content:space-between;align-items:center;padding-bottom:5px;border-bottom:1px solid #c8b6a8;color:#6f625e;font-size:9px}.page-meta strong{color:#2e1d19}header{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;padding:8px 0 9px;border-bottom:2px solid #721811}h1{margin:0 0 2px;color:#721811;font-size:18px;line-height:1.1}.business-meta{text-align:right;color:#6f625e}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:9px}th{background:#efe8df;color:#3b211c;font-weight:800}th,td{border:1px solid #c8b6a8;padding:5px 4px;vertical-align:top;overflow-wrap:anywhere}.c-no{width:7%}.c-date{width:13%}.c-doc{width:17%}.c-money{width:13%}.center{text-align:center}.num{text-align:right;white-space:nowrap}tfoot{font-weight:800;background:#f7f3ee}.empty{text-align:center;padding:18px;color:#6f625e}</style></head><body>${pages}</body></html>`
  await openA4Pdf(html, `รายงานภาษีขาย-${periodLabel}.pdf`, '.report-page')
}
