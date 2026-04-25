import * as XLSX from 'xlsx'
import { thDate } from './dateUtils'

const STATUS_TH = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว' }
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

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
    }))
  if (!rows.length) return alert('ไม่มีข้อมูล')
  write(rows, 'สต็อกสินค้า', `สต็อกสินค้า_${stamp()}.xlsx`)
}

export function exportTransactions(transactions, from, to) {
  const rows = transactions
    .filter(t => {
      const d = new Date(t.date)
      if (from && d < new Date(from)) return false
      if (to   && d > new Date(to + 'T23:59:59')) return false
      return true
    })
    .map(t => ({
      'วันที่':        thDate(t.date),
      'ประเภท':       t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
      'หมวดหมู่':     t.category,
      'จำนวนเงิน':    Number(t.amount),
      'รายรับ':       t.type === 'Income' ? Number(t.amount) : '',
      'รายจ่าย':      t.type === 'Expense' ? Number(t.amount) : '',
      'รุ่นกล้อง':    t.products?.model || '',
      'หมายเหตุ':     t.note || '',
    }))
  if (!rows.length) return alert('ไม่มีข้อมูล')
  write(rows, 'รายการบัญชี', `รายการบัญชี_${stamp()}.xlsx`)
}
