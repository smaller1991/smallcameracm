import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { exportInventory, exportTransactions, exportInventoryWithImages, exportTransactionsWithImages, downloadImportTemplate } from '../lib/exportUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { Download, Package, FileText, Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Import helpers ────────────────────────────────────────────
function parseThDate(val) {
  if (!val && val !== 0) return null
  if (typeof val === 'number' && val > 1000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000))
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  const s = String(val).trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\s](\d{1,2})[.:](\d{2}))?/)
  if (m) {
    let year = parseInt(m[3])
    if (year < 100) year += 2000
    else if (year > 2400) year -= 543
    const d = new Date(year, parseInt(m[2])-1, parseInt(m[1]), m[4]?parseInt(m[4]):0, m[5]?parseInt(m[5]):0)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function parseNum(v) {
  if (v === null || v === undefined || v === '') return null
  return parseFloat(String(v).replace(/,/g,'')) || 0
}
const STATUS_MAP  = { 'available':'Available','reserved':'Reserved','sold':'Sold' }
const CAT_MAP     = { 'กล้อง':'กล้อง','เลนส์':'เลนส์','แฟลช':'แฟลช','อุปกรณ์':'อุปกรณ์','กล้องดิจิตอลเก่า':'กล้องดิจิตอลเก่า','อื่นๆ':'อื่นๆ' }
const PAY_MAP     = { 'โอน':'โอน','เงินสด':'เงินสด' }
const TX_TYPE_MAP = { 'income':'Income','expense':'Expense' }
const TX_CAT_LIST = ['Buy Stock','Add-on','Sale','Rent','Marketing','Operating','Other','รายรับ/จ่ายที่ไม่มีผลกับกำไร']
const fmt = n => Number(n||0).toLocaleString('th-TH')

export default function Export() {
  // ── Export state ──
  const [invFilter,    setInvFilter]    = useState('all')
  const [from,         setFrom]         = useState('')
  const [to,           setTo]           = useState('')
  const [busy,         setBusy]         = useState(false)
  const [invFmt,       setInvFmt]       = useState('xlsx')
  const [txFmt,        setTxFmt]        = useState('xlsx')
  const [withImages,   setWithImages]   = useState(false)
  const [imgProgress,  setImgProgress]  = useState(null)
  const [withTxImages, setWithTxImages] = useState(false)
  const [txImgProgress,setTxImgProgress]= useState(null)

  // ── Import state ──
  const [impFile,    setImpFile]    = useState(null)
  const [preview,    setPreview]    = useState(null)
  const [importing,  setImporting]  = useState(false)
  const [result,     setResult]     = useState(null)

  // ── Export logic ──
  const fmtBtns = (val, set) => (
    <div className="flex gap-2 mt-2">
      {['xlsx','pdf'].map(f=>(
        <button key={f} onClick={()=>set(f)}
          className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${val===f?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200'}`}>
          {f==='xlsx'?'📊 Excel (.xlsx)':'📄 PDF'}
        </button>
      ))}
    </div>
  )

  const doExportInv = async () => {
    setBusy(true); setImgProgress(null)
    try {
      const {data} = await supabase.from('products').select('*').order('created_at',{ascending:false})
      if (withImages) {
        const {data: txData} = await supabase.from('transactions')
          .select('id,product_id,date,category,amount,images')
          .not('images', 'is', null)
        await exportInventoryWithImages(data||[], txData||[], invFilter, invFmt, (done,total)=>setImgProgress({done,total}))
      } else if (invFmt==='xlsx') {
        exportInventory(data||[], invFilter)
      } else {
        exportInventoryPDF(data||[], invFilter)
      }
      toast.success('ดาวน์โหลดสำเร็จ!')
    } catch(e){toast.error(e.message)}
    finally{ setBusy(false); setImgProgress(null) }
  }

  const doExportTx = async () => {
    setBusy(true); setTxImgProgress(null)
    try {
      const [{ data }, { data: balData }] = await Promise.all([
        supabase.from('transactions').select('*,products(model,category,total_cost,sold_price,customer_note,images,created_at,sold_date,serial_number,installment_total,status)').order('date',{ascending:false}),
        supabase.from('balances').select('bank,cash').eq('id','main').single(),
      ])
      const balance = balData ? { bank: Number(balData.bank||0), cash: Number(balData.cash||0) } : null
      if (withTxImages) {
        await exportTransactionsWithImages(data||[], from||undefined, to||undefined, txFmt, (done,total)=>setTxImgProgress({done,total}), balance)
      } else if (txFmt==='xlsx') {
        exportTransactions(data||[], from||undefined, to||undefined, balance)
      } else {
        exportTransactionsPDF(data||[], from||undefined, to||undefined, balance)
      }
      toast.success('ดาวน์โหลดสำเร็จ!')
    } catch(e){toast.error(e.message)}
    finally{ setBusy(false); setTxImgProgress(null) }
  }

  // ── Import logic ──
  const parseProducts = (wb) => {
    const ws = wb.Sheets['สต็อกสินค้า']
    if (!ws) return []
    const rows = XLSX.utils.sheet_to_json(ws, {header:1,defval:''})
    let headerRow = -1
    for (let i=0;i<Math.min(rows.length,5);i++) {
      const r = rows[i].map(c=>String(c||'').toLowerCase())
      if (r.some(c=>c.includes('รุ่น')||c.includes('serial'))) { headerRow=i; break }
    }
    if (headerRow<0) return []
    const headers = rows[headerRow].map(c=>String(c||'').replace(/\n.*/,'').trim())
    const data=[]
    for (let i=headerRow+1;i<rows.length;i++) {
      const row=rows[i]
      if (!row||row.every(c=>!c)) continue
      const get=(...keys)=>{
        for (const k of keys){const idx=headers.findIndex(h=>h.toLowerCase().includes(k.toLowerCase()));if(idx>=0&&row[idx]!==undefined&&row[idx]!=='')return row[idx]}
        return ''
      }
      const model=String(get('รุ่น','model')||'').trim()
      const cost=parseNum(get('ราคาซื้อ','ต้นทุน','base','ราคา'))
      if (!model||cost===null) continue
      const statusRaw=String(get('สถานะ','status')||'Available').trim().toLowerCase()
      const catRaw=String(get('ประเภท','category')||'กล้อง').trim()
      const payRaw=String(get('ชำระ','payment','ช่องทาง')||'').trim()
      const soldPrice=parseNum(get('ราคาขาย','sold'))
      const status=STATUS_MAP[statusRaw]||'Available'
      const createdAt=parseThDate(get('วันที่รับเข้า','วันรับเข้า','วันที่รับ','รับเข้า','created_at','created','วันซื้อ'))
      const soldRaw=get('วันที่ขาย','วันขาย','sold_date','sold')
      data.push({
        model, serial_number:String(get('serial')||'0').trim()||'0',
        category:CAT_MAP[catRaw]||'กล้อง',
        condition:parseInt(get('เกรด','grade','สภาพ','เกรดสภาพ'))||1,
        base_cost:cost, total_cost:cost, status,
        sold_price:soldPrice||null,
        payment_method:PAY_MAP[payRaw]||null,
        sold_date:status==='Sold'?parseThDate(soldRaw):null,
        warranty_expiry:null,
        created_at:createdAt||new Date().toISOString(),
        notes:String(get('หมายเหตุ','note','notes')||'').trim(),
        images:[],
      })
    }
    return data
  }

  const parseTransactions = (wb) => {
    const ws = wb.Sheets['รายการบัญชี']
    if (!ws) return []
    const rows = XLSX.utils.sheet_to_json(ws, {header:1,defval:''})
    let headerRow=-1
    for (let i=0;i<Math.min(rows.length,5);i++) {
      const r=rows[i].map(c=>String(c||'').toLowerCase())
      if (r.some(c=>c.includes('วันที่')||c.includes('ประเภท')||c.includes('type'))){headerRow=i;break}
    }
    if (headerRow<0) return []
    const headers=rows[headerRow].map(c=>String(c||'').replace(/\n.*/,'').trim())
    const data=[]
    for (let i=headerRow+1;i<rows.length;i++) {
      const row=rows[i]
      if (!row||row.every(c=>!c)) continue
      const get=(...keys)=>{
        for (const k of keys){const idx=headers.findIndex(h=>h.toLowerCase().includes(k.toLowerCase()));if(idx>=0&&row[idx]!==undefined&&row[idx]!=='')return row[idx]}
        return ''
      }
      const typeRaw=String(get('ประเภท','type')||'').trim().toLowerCase()
      const type=TX_TYPE_MAP[typeRaw]||(typeRaw.includes('income')?'Income':typeRaw.includes('expense')?'Expense':null)
      const amount=parseNum(get('จำนวน','amount','เงิน'))
      const date=parseThDate(get('วันที่','date'))
      if (!type||!amount||!date) continue
      const catRaw=String(get('หมวด','category','cat')||'Other').trim()
      data.push({date,type,category:TX_CAT_LIST.find(c=>c.toLowerCase()===catRaw.toLowerCase())||'Other',amount,note:String(get('หมายเหตุ','note')||'').trim()})
    }
    return data
  }

  const handleFile = (e) => {
    const f=e.target.files[0]
    if (!f) return
    setImpFile(f); setPreview(null); setResult(null)
    const reader=new FileReader()
    reader.onload=(ev)=>{
      try {
        const wb=XLSX.read(ev.target.result,{type:'array',cellDates:false,raw:true})
        setPreview({products:parseProducts(wb),transactions:parseTransactions(wb)})
      } catch(err){toast.error('อ่านไฟล์ไม่ได้: '+err.message)}
    }
    reader.readAsArrayBuffer(f)
  }

  const doImport = async () => {
    if (!preview) return
    setImporting(true)
    const errors=[]; let successP=0,successT=0
    try {
      for (const p of preview.products) {
        try {
          const payload={...p}
          if (!payload.created_at) delete payload.created_at
          if (payload.status==='Sold'&&payload.sold_date&&!payload.warranty_expiry)
            payload.warranty_expiry=new Date(new Date(payload.sold_date).getTime()+15*86400000).toISOString()
          const {error}=await supabase.from('products').insert(payload)
          if (error) throw error
          successP++
        } catch(e){errors.push(`สินค้า "${p.model}": ${e.message}`)}
      }
      for (const t of preview.transactions) {
        try {
          const {error}=await supabase.from('transactions').insert(t)
          if (error) throw error
          successT++
        } catch(e){errors.push(`บัญชี "${t.category} ${t.date}": ${e.message}`)}
      }
      setResult({successP,successT,errors})
      if (errors.length===0) toast.success(`นำเข้าสำเร็จ! สินค้า ${successP} รายการ, บัญชี ${successT} รายการ`)
      else toast.error(`นำเข้าบางส่วนสำเร็จ มี ${errors.length} รายการที่ผิดพลาด`)
    } catch(e){toast.error('เกิดข้อผิดพลาด: '+e.message)}
    finally{setImporting(false)}
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="font-bold text-xl text-brand-dark">ส่งออก / นำเข้าข้อมูล</h1>

      {/* ── ส่งออกสต็อก ── */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"><Package size={20} className="text-green-600"/></div>
          <div><p className="font-semibold">ส่งออกสต็อกสินค้า</p><p className="text-xs text-gray-400">รายชิ้น พร้อมต้นทุนสะสม</p></div>
        </div>
        <select className="input" value={invFilter} onChange={e=>setInvFilter(e.target.value)}>
          <option value="all">ทั้งหมด</option>
          <option value="Available">พร้อมขาย</option>
          <option value="Reserved">จอง</option>
          <option value="Sold">ขายแล้ว</option>
        </select>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={withImages} onChange={e=>setWithImages(e.target.checked)}/>
            <div className={`w-10 h-5 rounded-full transition-colors ${withImages?'bg-brand-dark':'bg-gray-200'}`}/>
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${withImages?'translate-x-5':''}`}/>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">ส่งออกพร้อมรูปภาพ</p>
            <p className="text-xs text-gray-400">ไฟล์จะเป็น .zip</p>
          </div>
        </label>
        <div>
          <p className="text-xs text-gray-500 mb-1 font-medium">รูปแบบไฟล์{withImages?' (ภายใน ZIP)':''}</p>
          {fmtBtns(invFmt,setInvFmt)}
        </div>
        {imgProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500"><span>กำลังดึงรูปภาพ...</span><span>{imgProgress.done}/{imgProgress.total}</span></div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-brand-dark h-2 rounded-full transition-all" style={{width:imgProgress.total?`${Math.round(imgProgress.done/imgProgress.total*100)}%`:'0%'}}/>
            </div>
          </div>
        )}
        <button onClick={doExportInv} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>{withImages?'ดาวน์โหลด สต็อก+รูป.zip':`ดาวน์โหลด สต็อกสินค้า.${invFmt}`}
        </button>
      </div>

      {/* ── ส่งออกบัญชี ── */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center"><FileText size={20} className="text-amber-600"/></div>
          <div><p className="font-semibold">ส่งออกรายการบัญชี</p><p className="text-xs text-gray-400">รายรับ-รายจ่าย เลือกช่วงวันได้</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 mb-1 block">ตั้งแต่วันที่</label><ThaiDatePicker value={from} onChange={setFrom} className="input w-full"/></div>
          <div><label className="text-xs text-gray-500 mb-1 block">ถึงวันที่</label><ThaiDatePicker value={to} onChange={setTo} className="input w-full"/></div>
        </div>
        <p className="text-xs text-gray-400">หากไม่ระบุวันที่ จะส่งออกทั้งหมด</p>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={withTxImages} onChange={e=>setWithTxImages(e.target.checked)}/>
            <div className={`w-10 h-5 rounded-full transition-colors ${withTxImages?'bg-brand-dark':'bg-gray-200'}`}/>
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${withTxImages?'translate-x-5':''}`}/>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">ส่งออกพร้อมรูปใบเสร็จ</p>
            <p className="text-xs text-gray-400">ไฟล์จะเป็น .zip</p>
          </div>
        </label>
        <div>
          <p className="text-xs text-gray-500 mb-1 font-medium">รูปแบบไฟล์{withTxImages?' (ภายใน ZIP)':''}</p>
          {fmtBtns(txFmt,setTxFmt)}
        </div>
        {txImgProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500"><span>กำลังดึงรูปใบเสร็จ...</span><span>{txImgProgress.done}/{txImgProgress.total}</span></div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-brand-dark h-2 rounded-full transition-all" style={{width:txImgProgress.total?`${Math.round(txImgProgress.done/txImgProgress.total*100)}%`:'0%'}}/>
            </div>
          </div>
        )}
        <button onClick={doExportTx} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>{withTxImages?'ดาวน์โหลด บัญชี+รูป.zip':`ดาวน์โหลด รายการบัญชี.${txFmt}`}
        </button>
      </div>

      {/* ── นำเข้าข้อมูล ── */}
      <div className="border-t border-amber-100 pt-2">
        <h2 className="font-bold text-lg text-brand-dark mb-3">นำเข้าข้อมูล</h2>
      </div>

      {/* Step 1 */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl">1️⃣</div>
          <div><p className="font-semibold">ดาวน์โหลด Template</p><p className="text-xs text-gray-400">กรอกข้อมูลลงใน Excel แล้วอัปโหลดกลับ</p></div>
        </div>
        <button onClick={downloadImportTemplate} className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm">
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

      {/* Step 2 */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl">2️⃣</div>
          <div><p className="font-semibold">อัปโหลดไฟล์ที่กรอกแล้ว</p><p className="text-xs text-gray-400">รองรับ .xlsx และ .xls</p></div>
        </div>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-amber-300 rounded-xl py-8 cursor-pointer hover:border-brand-yellow hover:bg-amber-50 transition-all">
          <Upload size={28} className="text-amber-400 mb-2"/>
          <p className="text-sm font-medium text-gray-600">{impFile ? impFile.name : 'กดเพื่อเลือกไฟล์'}</p>
          <p className="text-xs text-gray-400 mt-1">.xlsx, .xls</p>
          <input autoComplete="off" type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile}/>
        </label>
      </div>

      {/* Step 3: Preview */}
      {preview && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl">3️⃣</div>
            <div><p className="font-semibold">ตรวจสอบข้อมูลก่อนนำเข้า</p><p className="text-xs text-gray-400">ตรวจสอบให้ถูกต้องก่อนกด "นำเข้า"</p></div>
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
          {preview.products.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">ตัวอย่างสินค้า (5 รายการแรก)</p>
              <div className="space-y-1.5">
                {preview.products.slice(0,5).map((p,i)=>(
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                    <div><p className="text-sm font-medium">{p.model}</p><p className="text-xs text-gray-400">SN: {p.serial_number} | {p.category} | เกรด {p.condition}</p></div>
                    <div className="text-right"><p className="text-xs font-semibold text-amber-600">฿{fmt(p.base_cost)}</p><p className={`text-xs ${p.status==='Available'?'text-green-600':p.status==='Sold'?'text-red-500':'text-amber-600'}`}>{p.status}</p></div>
                  </div>
                ))}
                {preview.products.length>5&&<p className="text-xs text-gray-400 text-center">และอีก {preview.products.length-5} รายการ</p>}
              </div>
            </div>
          )}
          {preview.transactions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">ตัวอย่างรายการบัญชี (3 รายการแรก)</p>
              <div className="space-y-1.5">
                {preview.transactions.slice(0,3).map((t,i)=>(
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                    <div><p className="text-xs font-semibold">{t.category}</p><p className="text-xs text-gray-400">{t.date?.slice(0,10)}</p></div>
                    <p className={`text-sm font-bold ${t.type==='Income'?'text-green-600':'text-red-500'}`}>{t.type==='Income'?'+':'-'}฿{fmt(t.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={doImport} disabled={importing} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
            <Upload size={18}/>{importing?'กำลังนำเข้า...':`นำเข้าทั้งหมด ${preview.products.length+preview.transactions.length} รายการ`}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`card space-y-3 border-2 ${result.errors.length===0?'border-green-200':'border-amber-200'}`}>
          <div className="flex items-center gap-3">
            {result.errors.length===0?<CheckCircle size={24} className="text-green-500"/>:<AlertCircle size={24} className="text-amber-500"/>}
            <div><p className="font-semibold">ผลการนำเข้า</p><p className="text-xs text-gray-400">สินค้า {result.successP} รายการ | บัญชี {result.successT} รายการ</p></div>
          </div>
          {result.errors.length>0&&(
            <div className="bg-red-50 rounded-xl p-3 space-y-1">
              <p className="text-xs font-semibold text-red-600">รายการที่ผิดพลาด ({result.errors.length}):</p>
              {result.errors.slice(0,5).map((e,i)=><p key={i} className="text-xs text-red-500">• {e}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── PDF helpers ───────────────────────────────────────────────
const STATUS_TH = {Available:'พร้อมขาย',Reserved:'จอง',Sold:'ขายแล้ว'}
const thDate = d => d?new Date(d).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}):''

function makePDF(title, headers, rows) {
  const w = window.open('','_blank')
  if (!w) return alert('กรุณาอนุญาต popup เพื่อดาวน์โหลด PDF')
  const headerHtml = headers.map(h=>`<th>${h}</th>`).join('')
  const rowsHtml   = rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <style>body{font-family:sans-serif;font-size:11px;margin:20px}h2{color:#1A1208;margin-bottom:12px}table{width:100%;border-collapse:collapse}th{background:#1A1208;color:#FFB838;padding:6px 8px;text-align:left;font-size:11px}td{padding:5px 8px;border-bottom:1px solid #f0e8d8;font-size:10px}tr:nth-child(even){background:#FFFBF0}@media print{body{margin:0}}</style>
  </head><body><h2>${title}</h2><p style="color:#999;font-size:10px;margin-bottom:8px">สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</p>
  <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script></body></html>`)
  w.document.close()
}

function exportInventoryPDF(products, statusFilter='all') {
  const rows = products.filter(p=>statusFilter==='all'||p.status===statusFilter)
    .map(p=>[p.model,p.serial_number,p.category||'กล้อง',p.condition,STATUS_TH[p.status]||p.status,
             `฿${fmt(p.base_cost)}`,`฿${fmt(p.total_cost)}`,
             p.sold_price?`฿${fmt(p.sold_price)}`:'',
             p.sold_price?`฿${fmt(Number(p.sold_price)-Number(p.total_cost))}`:'',
             thDate(p.created_at),thDate(p.sold_date),p.customer_note||'',p.notes||''])
  makePDF('สต็อกสินค้า',['รุ่น','Serial','ประเภท','เกรด','สถานะ','ต้นทุนเริ่ม','ต้นทุนรวม','ราคาขาย','กำไร','วันรับเข้า','วันขาย','รายละเอียดลูกค้า','หมายเหตุ'],rows)
}

function exportTransactionsPDF(txs, from, to, balance=null) {
  const filtered = txs.filter(t=>{
    if (from&&new Date(t.date)<new Date(from)) return false
    if (to&&new Date(t.date)>new Date(to+'T23:59:59')) return false
    return true
  })
  if (!filtered.length) return alert('ไม่มีข้อมูล')

  // คำนวณยอดคงเหลือหลังแต่ละรายการจากยอดปัจจุบัน (ย้อนจากใหม่→เก่า)
  const balMap = {}
  if (balance) {
    let runBank = balance.bank
    let runCash = balance.cash
    for (const tx of txs) {
      balMap[tx.id] = { bank: runBank, cash: runCash }
      const amt = Number(tx.amount || 0)
      if (tx.type === 'Income') {
        if (tx.payment_method === 'โอน') runBank -= amt; else runCash -= amt
      } else {
        if (tx.payment_method === 'โอน') runBank += amt; else runCash += amt
      }
    }
  }

  const totalIncome  = filtered.filter(t=>t.type==='Income').reduce((a,t)=>a+Number(t.amount),0)
  const totalExpense = filtered.filter(t=>t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)
  const DEDUCT = new Set(['Shipping','Marketing','Operating','Other'])
  const popupCounted = new Set()
  const plValues = filtered.map(t=>{
    if (t.category==='Sale'&&t.products?.total_cost!=null) {
      if (!t.products?.installment_total) return Number(t.amount)-Number(t.products.total_cost)
      if (t.products?.status==='Sold'&&!popupCounted.has(t.product_id)) {
        popupCounted.add(t.product_id)
        return Number(t.products.installment_total)-Number(t.products.total_cost)
      }
      return null
    }
    if (t.category==='Trade'&&t.trade_profit_a!=null) return Number(t.trade_profit_a)
    if (t.type==='Expense'&&DEDUCT.has(t.category)) return -Number(t.amount)
    return null
  })
  const totalProfit = plValues.reduce((a,v)=>v!=null?a+v:a,0)
  const deductions  = filtered.filter(t=>t.type==='Expense'&&DEDUCT.has(t.category)).reduce((a,t)=>a+Number(t.amount),0)
  const grossProfit = totalProfit + deductions
  const rows = filtered.map((t,i)=>{
    const pl=plValues[i]
    const bal=balMap[t.id]
    const custNote = t.category==='Sale'?(t.products?.customer_note||''):''
    const custCell = custNote.length > 40 ? `<span style="font-size:8px">${custNote}</span>` : custNote
    return [thDate(t.date),t.type==='Income'?'รายรับ':'รายจ่าย',t.category,`฿${fmt(t.amount)}`,
            t.type==='Income'?`฿${fmt(t.amount)}`:'',t.type==='Expense'?`฿${fmt(t.amount)}`:'',
            pl!=null?`฿${fmt(pl)}`:'',t.products?.model||'',
            t.products?.created_at?thDate(t.products.created_at):'',
            t.products?.total_cost!=null?`฿${fmt(t.products.total_cost)}`:'',
            custCell,t.note||'',
            bal?`฿${fmt(bal.bank)}`:'',bal?`฿${fmt(bal.cash)}`:'']
  })
  rows.push(['','','','','','','','','','','','','',''])
  rows.push(['สรุป','','รวมรายรับ','',`฿${fmt(totalIncome)}`,'','','','','','','','',''])
  rows.push(['','','รวมรายจ่าย','','',`฿${fmt(totalExpense)}`,'','','','','','','',''])
  rows.push(['','','กำไรขาย (ก่อนหักรายจ่าย)','','','',`฿${fmt(grossProfit)}`,'','','','','','',''])
  rows.push(['','','กำไรขาดทุนสุทธิ','','','',`฿${fmt(totalProfit)}`,'','','','','','',''])
  if (balance) {
    rows.push(['','','','','','','','','','','','','',''])
    rows.push(['ยอดเงินปัจจุบัน','','💳 ธนาคาร',`฿${fmt(balance.bank)}`,'','','','','','','','','',''])
    rows.push(['','','💵 เงินสด',`฿${fmt(balance.cash)}`,'','','','','','','','','',''])
  }
  makePDF('รายการบัญชี',['วันที่','ประเภท','หมวดหมู่','จำนวน','รายรับ','รายจ่าย','กำไรขาดทุน','รุ่นกล้อง','วันที่ซื้อ','ต้นทุน','รายละเอียดลูกค้า','หมายเหตุ','💳 ธนาคารคงเหลือ','💵 เงินสดคงเหลือ'],rows)
}
