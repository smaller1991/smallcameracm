import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { exportInventory, exportTransactions, exportInventoryWithImages, exportTransactionsWithImages } from '../lib/exportUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { Download, Package, FileText } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Export() {
  const [invFilter,   setInvFilter]   = useState('all')
  const [from,        setFrom]        = useState('')
  const [to,          setTo]          = useState('')
  const [busy,        setBusy]        = useState(false)
  const [invFmt,      setInvFmt]      = useState('xlsx')
  const [txFmt,       setTxFmt]       = useState('xlsx')
  const [withImages,    setWithImages]    = useState(false)
  const [imgProgress,   setImgProgress]   = useState(null)
  const [withTxImages,  setWithTxImages]  = useState(false)
  const [txImgProgress, setTxImgProgress] = useState(null)

  const fmtBtns = (val,set) => (
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
    setBusy(true)
    setImgProgress(null)
    try {
      const {data} = await supabase.from('products').select('*').order('created_at',{ascending:false})
      if (withImages) {
        await exportInventoryWithImages(data||[], invFilter, invFmt, (done, total) => {
          setImgProgress({ done, total })
        })
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
      const {data} = await supabase.from('transactions').select('*,products(model,category,total_cost,customer_note)').order('date',{ascending:false})
      if (withTxImages) {
        await exportTransactionsWithImages(data||[], from||undefined, to||undefined, txFmt, (done, total) => {
          setTxImgProgress({ done, total })
        })
      } else if (txFmt==='xlsx') {
        exportTransactions(data||[], from||undefined, to||undefined)
      } else {
        exportTransactionsPDF(data||[], from||undefined, to||undefined)
      }
      toast.success('ดาวน์โหลดสำเร็จ!')
    } catch(e){toast.error(e.message)}
    finally{ setBusy(false); setTxImgProgress(null) }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="font-bold text-xl text-brand-dark">ส่งออกข้อมูล</h1>

      {/* Inventory */}
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
        {/* Export with images toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={withImages} onChange={e=>setWithImages(e.target.checked)}/>
            <div className={`w-10 h-5 rounded-full transition-colors ${withImages?'bg-brand-dark':'bg-gray-200'}`}/>
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${withImages?'translate-x-5':''}`}/>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">ส่งออกพร้อมรูปภาพ</p>
            <p className="text-xs text-gray-400">ไฟล์จะเป็น .zip (เอกสาร + รูป แยกโฟลเดอร์ตามวัน)</p>
          </div>
        </label>

        <div>
          <p className="text-xs text-gray-500 mb-1 font-medium">รูปแบบไฟล์เอกสาร{withImages ? ' (ภายใน ZIP)' : ''}</p>
          {fmtBtns(invFmt,setInvFmt)}
        </div>

        {/* Progress bar while fetching images */}
        {imgProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>กำลังดึงรูปภาพ...</span>
              <span>{imgProgress.done}/{imgProgress.total}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-brand-dark h-2 rounded-full transition-all"
                style={{width: imgProgress.total ? `${Math.round(imgProgress.done/imgProgress.total*100)}%` : '0%'}}/>
            </div>
          </div>
        )}

        <button onClick={doExportInv} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>
          {withImages ? 'ดาวน์โหลด สต็อกสินค้า+รูป.zip' : `ดาวน์โหลด สต็อกสินค้า.${invFmt}`}
        </button>
      </div>

      {/* Transactions */}
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

        {/* Export with images toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={withTxImages} onChange={e=>setWithTxImages(e.target.checked)}/>
            <div className={`w-10 h-5 rounded-full transition-colors ${withTxImages?'bg-brand-dark':'bg-gray-200'}`}/>
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${withTxImages?'translate-x-5':''}`}/>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">ส่งออกพร้อมรูปใบเสร็จ</p>
            <p className="text-xs text-gray-400">ไฟล์จะเป็น .zip (เอกสาร + รูป แยกโฟลเดอร์ตามวัน)</p>
          </div>
        </label>

        <div>
          <p className="text-xs text-gray-500 mb-1 font-medium">รูปแบบไฟล์เอกสาร{withTxImages ? ' (ภายใน ZIP)' : ''}</p>
          {fmtBtns(txFmt,setTxFmt)}
        </div>

        {txImgProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>กำลังดึงรูปใบเสร็จ...</span>
              <span>{txImgProgress.done}/{txImgProgress.total}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-brand-dark h-2 rounded-full transition-all"
                style={{width: txImgProgress.total ? `${Math.round(txImgProgress.done/txImgProgress.total*100)}%` : '0%'}}/>
            </div>
          </div>
        )}

        <button onClick={doExportTx} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>
          {withTxImages ? 'ดาวน์โหลด รายการบัญชี+รูป.zip' : `ดาวน์โหลด รายการบัญชี.${txFmt}`}
        </button>
      </div>
    </div>
  )
}

// PDF helpers
const STATUS_TH = {Available:'พร้อมขาย',Reserved:'จอง',Sold:'ขายแล้ว'}
const thDate = d => d?new Date(d).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}):''
const fmt = n => Number(n||0).toLocaleString('th-TH')

function makePDF(title, headers, rows, filename) {
  const w = window.open('','_blank')
  if (!w) return alert('กรุณาอนุญาต popup เพื่อดาวน์โหลด PDF')
  const headerHtml = headers.map(h=>`<th>${h}</th>`).join('')
  const rowsHtml   = rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body{font-family:sans-serif;font-size:11px;margin:20px}
    h2{color:#1A1208;margin-bottom:12px}
    table{width:100%;border-collapse:collapse}
    th{background:#1A1208;color:#FFB838;padding:6px 8px;text-align:left;font-size:11px}
    td{padding:5px 8px;border-bottom:1px solid #f0e8d8;font-size:10px}
    tr:nth-child(even){background:#FFFBF0}
    @media print{body{margin:0}}
  </style></head><body>
  <h2>${title}</h2>
  <p style="color:#999;font-size:10px;margin-bottom:8px">สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</p>
  <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>
  </body></html>`)
  w.document.close()
}

function exportInventoryPDF(products, statusFilter='all') {
  const rows = products
    .filter(p=>statusFilter==='all'||p.status===statusFilter)
    .map(p=>[p.model,p.serial_number,p.category||'กล้อง',p.condition,STATUS_TH[p.status]||p.status,
             `฿${fmt(p.base_cost)}`,`฿${fmt(p.total_cost)}`,
             p.sold_price?`฿${fmt(p.sold_price)}`:'',
             p.sold_price?`฿${fmt(Number(p.sold_price)-Number(p.total_cost))}`:'',
             thDate(p.created_at),thDate(p.sold_date),p.customer_note||'',p.notes||''])
  makePDF('สต็อกสินค้า',['รุ่น','Serial','ประเภท','เกรด','สถานะ','ต้นทุนเริ่ม','ต้นทุนรวม','ราคาขาย','กำไร','วันรับเข้า','วันขาย','รายละเอียดลูกค้า','หมายเหตุ'],rows,'สต็อกสินค้า.pdf')
}

function exportTransactionsPDF(txs, from, to) {
  const filtered = txs.filter(t=>{
    if (from&&new Date(t.date)<new Date(from)) return false
    if (to&&new Date(t.date)>new Date(to+'T23:59:59')) return false
    return true
  })
  if (!filtered.length) return alert('ไม่มีข้อมูล')

  const totalIncome  = filtered.filter(t=>t.type==='Income').reduce((a,t)=>a+Number(t.amount),0)
  const totalExpense = filtered.filter(t=>t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)

  const plValues = filtered.map(t=>{
    if (t.category==='Sale'&&t.products?.total_cost!=null)
      return Number(t.amount)-Number(t.products.total_cost)
    if (t.category==='Trade'&&t.trade_profit_a!=null)
      return Number(t.trade_profit_a)
    return null
  })
  const totalProfit = plValues.reduce((a,v)=>v!=null?a+v:a,0)

  const rows = filtered.map((t,i)=>{
    const pl = plValues[i]
    return [thDate(t.date),t.type==='Income'?'รายรับ':'รายจ่าย',t.category,
            `฿${fmt(t.amount)}`,t.type==='Income'?`฿${fmt(t.amount)}`:'',
            t.type==='Expense'?`฿${fmt(t.amount)}`:'',
            pl!=null?`฿${fmt(pl)}`:'',
            t.products?.model||'',
            t.category==='Sale'?(t.products?.customer_note||''):'',
            t.note||'']
  })

  rows.push(['','','','','','','','','',''])
  rows.push(['สรุป','','รวมรายรับ','',`฿${fmt(totalIncome)}`,'','','','',''])
  rows.push(['','','รวมรายจ่าย','','',`฿${fmt(totalExpense)}`,'','','',''])
  rows.push(['','','กำไรขาดทุนสุทธิ','','','',`฿${fmt(totalProfit)}`,'','',''])

  makePDF('รายการบัญชี',['วันที่','ประเภท','หมวดหมู่','จำนวน','รายรับ','รายจ่าย','กำไรขาดทุน','รุ่นกล้อง','รายละเอียดลูกค้า','หมายเหตุ'],rows,'รายการบัญชี.pdf')
}
