import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { downloadImportTemplate } from '../lib/exportUtils'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = n => Number(n||0).toLocaleString('th-TH')

// แปลง DD/MM/YYYY หรือ DD/MM/YY หรือ DD/MM/YY HH.mm → ISO
function parseThDate(str) {
  if (!str) return null
  const s = String(str).trim()
  // รองรับ DD/MM/YYYY, DD/MM/YY, DD/MM/YYYY HH.mm, DD/MM/YY HH:mm
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\s](\d{1,2})[.:](\d{2}))?/)
  if (!m) return null
  let year = parseInt(m[3])
  // 2 หลัก: 25 = 2025, 68 = 2568 พ.ศ. → 2025 ค.ศ.
  if (year < 100) {
    year = year + 2000 // เช่น 26 → 2026
  } else if (year > 2400) {
    year = year - 543  // พ.ศ. → ค.ศ.
  }
  const month = parseInt(m[2]) - 1
  const day   = parseInt(m[1])
  const hour  = m[4] ? parseInt(m[4]) : 0
  const min   = m[5] ? parseInt(m[5]) : 0
  const d = new Date(year, month, day, hour, min)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return null
  return parseFloat(String(v).replace(/,/g,'')) || 0
}

const STATUS_MAP  = { 'available':'Available','reserved':'Reserved','sold':'Sold' }
const CAT_MAP     = { 'กล้อง':'กล้อง','เลนส์':'เลนส์','แฟลช':'แฟลช','อุปกรณ์':'อุปกรณ์','อื่นๆ':'อื่นๆ' }
const PAY_MAP     = { 'โอน':'โอน','เงินสด':'เงินสด' }
const TX_TYPE_MAP = { 'income':'Income','expense':'Expense' }
const TX_CAT_LIST = ['Buy Stock','Add-on','Sale','Rent','Marketing','Operating','Other']

export default function Import() {
  const [file,      setFile]      = useState(null)
  const [preview,   setPreview]   = useState(null)  // { products, transactions }
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState(null)  // { success, errors }

  const handleFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setFile(f); setPreview(null); setResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        const products     = parseProducts(wb)
        const transactions = parseTransactions(wb)
        setPreview({ products, transactions })
      } catch(err) {
        toast.error('อ่านไฟล์ไม่ได้: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(f)
  }

  const parseProducts = (wb) => {
    const ws = wb.Sheets['สต็อกสินค้า']
    if (!ws) return []
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
    // หาแถว header (มีคำว่า "ชื่อรุ่น" หรือ "Serial")
    let headerRow = -1
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i].map(c => String(c||'').toLowerCase())
      if (r.some(c => c.includes('รุ่น') || c.includes('serial'))) { headerRow = i; break }
    }
    if (headerRow < 0) return []
    const headers = rows[headerRow].map(c => String(c||'').replace(/\n.*/,'').trim())
    const data = []
    for (let i = headerRow+1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => !c)) continue
      const get = (...keys) => {
        for (const k of keys) {
          const idx = headers.findIndex(h => h.toLowerCase().includes(k.toLowerCase()))
          if (idx >= 0 && row[idx] !== undefined && row[idx] !== '') return row[idx]
        }
        return ''
      }
      const model  = String(get('รุ่น','model') || '').trim()
      const serial = String(get('serial') || '0').trim()
      const cost   = parseNum(get('ราคาซื้อ','ต้นทุน','base','ราคา'))
      if (!model || cost === null) continue
      const statusRaw = String(get('สถานะ','status') || 'Available').trim().toLowerCase()
      const status    = STATUS_MAP[statusRaw] || 'Available'
      const soldPrice = parseNum(get('ราคาขาย','sold'))
      const catRaw    = String(get('ประเภท','category') || 'กล้อง').trim()
      const category  = CAT_MAP[catRaw] || 'กล้อง'
      const payRaw    = String(get('ชำระ','payment','ช่องทาง') || '').trim()
      const payment   = PAY_MAP[payRaw] || null

      // วันที่รับเข้า — ลอง keyword หลายแบบ
      const createdRaw = get('วันที่รับเข้า','วันรับเข้า','วันที่รับ','รับเข้า','created_at','created','วันซื้อ')
      const createdAt  = parseThDate(String(createdRaw||''))

      // วันที่ขาย
      const soldRaw  = get('วันที่ขาย','วันขาย','sold_date','sold')
      const soldDate = status==='Sold' ? parseThDate(String(soldRaw||'')) : null

      data.push({
        model, serial_number: serial || '0',
        category,
        condition: parseInt(get('เกรด','grade','สภาพ','เกรดสภาพ')) || 1,
        base_cost: cost, total_cost: cost,
        status,
        sold_price: soldPrice || null,
        payment_method: payment,
        sold_date: soldDate,
        warranty_expiry: null,
        created_at: createdAt || new Date().toISOString(),
        notes: String(get('หมายเหตุ','note','notes') || '').trim(),
        images: [],
      })
    }
    return data
  }

  const parseTransactions = (wb) => {
    const ws = wb.Sheets['รายการบัญชี']
    if (!ws) return []
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
    let headerRow = -1
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i].map(c => String(c||'').toLowerCase())
      if (r.some(c => c.includes('วันที่') || c.includes('ประเภท') || c.includes('type'))) { headerRow = i; break }
    }
    if (headerRow < 0) return []
    const headers = rows[headerRow].map(c => String(c||'').replace(/\n.*/,'').trim())
    const data = []
    for (let i = headerRow+1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => !c)) continue
      const get = (...keys) => {
        for (const k of keys) {
          const idx = headers.findIndex(h => h.toLowerCase().includes(k.toLowerCase()))
          if (idx >= 0 && row[idx] !== undefined && row[idx] !== '') return row[idx]
        }
        return ''
      }
      const typeRaw  = String(get('ประเภท','type') || '').trim().toLowerCase()
      const type     = TX_TYPE_MAP[typeRaw] || (typeRaw.includes('income')?'Income':typeRaw.includes('expense')?'Expense':null)
      const amount   = parseNum(get('จำนวน','amount','เงิน'))
      const dateRaw  = String(get('วันที่','date') || '').trim()
      const date     = parseThDate(dateRaw)
      if (!type || !amount || !date) continue
      const catRaw = String(get('หมวด','category','cat') || 'Other').trim()
      const cat    = TX_CAT_LIST.find(c => c.toLowerCase() === catRaw.toLowerCase()) || 'Other'
      data.push({
        date, type, category: cat, amount,
        note: String(get('หมายเหตุ','note') || '').trim(),
      })
    }
    return data
  }

  const doImport = async () => {
    if (!preview) return
    setImporting(true)
    const errors = []
    let successP = 0, successT = 0

    try {
      // Import products
      for (const p of preview.products) {
        try {
          const payload = { ...p }
          if (!payload.created_at) delete payload.created_at
          // ถ้าขายแล้วและไม่มี warranty ให้ตั้ง 15 วันจากวันขาย
          if (payload.status === 'Sold' && payload.sold_date && !payload.warranty_expiry) {
            payload.warranty_expiry = new Date(new Date(payload.sold_date).getTime()+15*86400000).toISOString()
          }
          const { error } = await supabase.from('products').insert(payload)
          if (error) throw error
          successP++
        } catch(e) {
          errors.push(`สินค้า "${p.model}": ${e.message}`)
        }
      }

      // Import transactions
      for (const t of preview.transactions) {
        try {
          const { error } = await supabase.from('transactions').insert(t)
          if (error) throw error
          successT++
        } catch(e) {
          errors.push(`บัญชี "${t.category} ${t.date}": ${e.message}`)
        }
      }

      setResult({ successP, successT, errors })
      if (errors.length === 0) {
        toast.success(`นำเข้าสำเร็จ! สินค้า ${successP} รายการ, บัญชี ${successT} รายการ`)
      } else {
        toast.error(`นำเข้าบางส่วนสำเร็จ มี ${errors.length} รายการที่ผิดพลาด`)
      }
    } catch(e) {
      toast.error('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="font-bold text-xl text-brand-dark">นำเข้าข้อมูล</h1>

      {/* Step 1: Download template */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl">1️⃣</div>
          <div>
            <p className="font-semibold">ดาวน์โหลด Template</p>
            <p className="text-xs text-gray-400">กรอกข้อมูลลงใน Excel แล้วอัปโหลดกลับ</p>
          </div>
        </div>
        <button onClick={downloadImportTemplate}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm">
          <FileSpreadsheet size={16}/>ดาวน์โหลด Template (.xlsx)
        </button>
        <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 space-y-1">
          <p className="font-semibold">วิธีกรอกข้อมูล:</p>
          <p>• Sheet 1 <b>สต็อกสินค้า</b> — กรอกข้อมูลกล้อง/เลนส์ที่มีอยู่</p>
          <p>• Sheet 2 <b>รายการบัญชี</b> — กรอกรายรับ-รายจ่ายเก่า</p>
          <p>• ลบแถวตัวอย่าง (สีเหลือง) ออกก่อนอัปโหลด</p>
          <p>• วันที่ใช้รูปแบบ <b>DD/MM/YYYY HH.mm</b> เช่น 01/04/2568 10.00</p>
        </div>
      </div>

      {/* Step 2: Upload */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl">2️⃣</div>
          <div>
            <p className="font-semibold">อัปโหลดไฟล์ที่กรอกแล้ว</p>
            <p className="text-xs text-gray-400">รองรับ .xlsx และ .xls</p>
          </div>
        </div>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-amber-300 rounded-xl py-8 cursor-pointer hover:border-brand-yellow hover:bg-amber-50 transition-all">
          <Upload size={28} className="text-amber-400 mb-2"/>
          <p className="text-sm font-medium text-gray-600">{file ? file.name : 'กดเพื่อเลือกไฟล์'}</p>
          <p className="text-xs text-gray-400 mt-1">.xlsx, .xls</p>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile}/>
        </label>
      </div>

      {/* Step 3: Preview */}
      {preview && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl">3️⃣</div>
            <div>
              <p className="font-semibold">ตรวจสอบข้อมูลก่อนนำเข้า</p>
              <p className="text-xs text-gray-400">ตรวจสอบให้ถูกต้องก่อนกด "นำเข้า"</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{preview.products.length}</p>
              <p className="text-xs text-blue-500 mt-1">รายการสินค้า</p>
            </div>
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{preview.transactions.length}</p>
              <p className="text-xs text-green-500 mt-1">รายการบัญชี</p>
            </div>
          </div>

          {/* Products preview */}
          {preview.products.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">ตัวอย่างสินค้า (5 รายการแรก)</p>
              <div className="space-y-1.5">
                {preview.products.slice(0,5).map((p,i)=>(
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{p.model}</p>
                      <p className="text-xs text-gray-400">SN: {p.serial_number} | {p.category} | เกรด {p.condition}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-amber-600">฿{fmt(p.base_cost)}</p>
                      <p className={`text-xs ${p.status==='Available'?'text-green-600':p.status==='Sold'?'text-red-500':'text-amber-600'}`}>{p.status}</p>
                    </div>
                  </div>
                ))}
                {preview.products.length > 5 && <p className="text-xs text-gray-400 text-center">และอีก {preview.products.length-5} รายการ</p>}
              </div>
            </div>
          )}

          {/* Transactions preview */}
          {preview.transactions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">ตัวอย่างรายการบัญชี (3 รายการแรก)</p>
              <div className="space-y-1.5">
                {preview.transactions.slice(0,3).map((t,i)=>(
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold">{t.category}</p>
                      <p className="text-xs text-gray-400">{t.date?.slice(0,10)}</p>
                    </div>
                    <p className={`text-sm font-bold ${t.type==='Income'?'text-green-600':'text-red-500'}`}>
                      {t.type==='Income'?'+':'-'}฿{fmt(t.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={doImport} disabled={importing}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
            <Upload size={18}/>
            {importing ? 'กำลังนำเข้า...' : `นำเข้าข้อมูลทั้งหมด ${preview.products.length+preview.transactions.length} รายการ`}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`card space-y-3 border-2 ${result.errors.length===0?'border-green-200':'border-amber-200'}`}>
          <div className="flex items-center gap-3">
            {result.errors.length===0
              ? <CheckCircle size={24} className="text-green-500"/>
              : <AlertCircle size={24} className="text-amber-500"/>}
            <div>
              <p className="font-semibold">ผลการนำเข้า</p>
              <p className="text-xs text-gray-400">สินค้า {result.successP} รายการ | บัญชี {result.successT} รายการ</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="bg-red-50 rounded-xl p-3 space-y-1">
              <p className="text-xs font-semibold text-red-600">รายการที่ผิดพลาด ({result.errors.length}):</p>
              {result.errors.slice(0,5).map((e,i)=>(
                <p key={i} className="text-xs text-red-500">• {e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
