import * as XLSX from 'xlsx'

const STATUS_TH = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว' }
const thDate = d => d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : ''
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

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
