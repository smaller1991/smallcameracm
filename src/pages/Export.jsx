import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { exportInventory, exportTransactions, exportInventoryWithImages, exportTransactionsWithImages, previewInventoryPDFFile, previewTransactionsPDFFile, downloadImportTemplate } from '../lib/exportUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { Download, Package, FileText, Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { buildTransactionGroups, groupKindLabel } from '../lib/transactionGroups'
import { buildStockMap } from '../lib/stockLedger'
import { profitAfterVat, vatDocumentOf } from '../lib/vat'

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
const PRODUCT_CATEGORY_ORDER = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const fmt = n => Number(n||0).toLocaleString('th-TH')
const pad = n => String(n).padStart(2, '0')
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const toLocalDateStr = iso => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
const monthRange = offset => {
  const base = new Date()
  const y = base.getFullYear()
  const m = base.getMonth() + offset
  return {
    from: localDate(new Date(y, m, 1)),
    to: localDate(new Date(y, m + 1, 0)),
  }
}
const yearRange = () => {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}
const inDateRange = (t, from, to) => {
  const dateStr = toLocalDateStr(t.date)
  if (from && dateStr < from) return false
  if (to && dateStr > to) return false
  return true
}
const sortProductsForStockPDF = products => {
  const categoryRank = category => {
    const index = PRODUCT_CATEGORY_ORDER.indexOf(category || 'กล้อง')
    return index === -1 ? PRODUCT_CATEGORY_ORDER.length : index
  }
  return [...products].sort((a, b) => (
    categoryRank(a.category) - categoryRank(b.category) ||
    String(a.model || '').localeCompare(String(b.model || ''), 'th', { numeric: true, sensitivity: 'base' }) ||
    String(a.serial_number || '').localeCompare(String(b.serial_number || ''), 'th', { numeric: true, sensitivity: 'base' })
  ))
}
const buildBalanceMap = (txs, balance) => {
  const map = {}
  if (!balance) return map
  let runBank = Number(balance.bank || 0)
  let runCash = Number(balance.cash || 0)
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i]
    const nextTx = txs[i + 1]
    if (tx.bank_after != null && tx.cash_after != null) {
      runBank = Number(tx.bank_after)
      runCash = Number(tx.cash_after)
    }
    map[tx.id] = { bank: runBank, cash: runCash }
    if (tx.bank_after != null && tx.cash_after != null && nextTx?.bank_after != null && nextTx?.cash_after != null) {
      runBank = Number(nextTx.bank_after)
      runCash = Number(nextTx.cash_after)
    } else if (tx.bank_amount != null || tx.cash_amount != null) {
      const bAmt = Number(tx.bank_amount || 0)
      const cAmt = Number(tx.cash_amount || 0)
      if (tx.type === 'Income') { runBank -= bAmt; runCash -= cAmt }
      else { runBank += bAmt; runCash += cAmt }
    } else {
      const amt = Number(tx.amount || 0)
      if (tx.type === 'Income') {
        if (tx.payment_method === 'โอน') runBank -= amt
        else runCash -= amt
      } else {
        if (tx.payment_method === 'โอน') runBank += amt
        else runCash += amt
      }
    }
  }
  return map
}
const getReportBalance = (txs, from, to, currentBalance) => {
  if (!currentBalance) return null
  const filtered = txs.filter(t => inDateRange(t, from, to))
  if (!filtered.length) return null
  const balMap = buildBalanceMap(txs, currentBalance)
  return balMap[filtered[0].id] || currentBalance
}
const reportAddOnsByProduct = txs => {
  const result = (txs || []).reduce((map, tx) => {
    if (tx.category !== 'Add-on' || !tx.product_id) return map
    if (!map[tx.product_id]) map[tx.product_id] = []
    const name = String(tx.note || '')
      .replace(/^Add-on:\s*/i, '')
      .split(/\s+[—-]\s+/)[0]
      .trim()
    map[tx.product_id].push({
      id: tx.id,
      name: name || 'อุปกรณ์เสริม',
      cost: Number(tx.amount || 0),
      purchased_at: tx.date,
    })
    return map
  }, {})
  Object.values(result).forEach(items => items.sort((a, b) => new Date(a.purchased_at || 0) - new Date(b.purchased_at || 0)))
  return result
}
const withPurchaseBatchTotals = (txs, products) => {
  const addOnsByProduct = reportAddOnsByProduct(txs)
  const productsWithAddOns = (products || []).map(product => ({
    ...product,
    report_add_ons: addOnsByProduct[product.id] || [],
  }))
  const batchTotals = productsWithAddOns.reduce((map, p) => {
    if (p.batch_id) map[p.batch_id] = (map[p.batch_id] || 0) + Number(p.total_cost || 0)
    return map
  }, {})
  const batchItems = productsWithAddOns.reduce((map, p) => {
    if (!p.batch_id) return map
    if (!map[p.batch_id]) map[p.batch_id] = []
    map[p.batch_id].push(p)
    return map
  }, {})
  const saleBatchItems = productsWithAddOns.reduce((map, p) => {
    if (!p.sale_batch_id) return map
    if (!map[p.sale_batch_id]) map[p.sale_batch_id] = []
    map[p.sale_batch_id].push(p)
    return map
  }, {})
  const productById = new Map(productsWithAddOns.map(product => [product.id, product]))
  return (txs || []).map(t => (
    t.products
      ? { ...t, products: {
          ...(productById.get(t.product_id) || {}),
          ...t.products,
          report_add_ons: addOnsByProduct[t.product_id] || [],
          ...(t.products.batch_id ? {
            batch_total_cost: batchTotals[t.products.batch_id] || Number(t.products.total_cost || 0),
            batch_items: batchItems[t.products.batch_id] || [],
          } : {}),
          ...(t.products.sale_batch_id ? {
            sale_batch_items: saleBatchItems[t.products.sale_batch_id] || [],
          } : {}),
          ...(t.products.trade_ref_id ? {
            trade_item_b: productById.get(t.products.trade_ref_id) || null,
          } : {}),
        } }
      : t
  ))
}
const getReportStock = (txs, from, to, currentStockValue) => {
  const filtered = txs.filter(t => inDateRange(t, from, to))
  if (!filtered.length) return null
  const stockMap = buildStockMap(txs, currentStockValue)
  return stockMap[filtered[0].id] ?? Number(currentStockValue || 0)
}

export default function Export() {
  // ── Export state ──
  const [invFilter,    setInvFilter]    = useState('all')
  const [from,         setFrom]         = useState('')
  const [to,           setTo]           = useState('')
  const [txRangePreset,setTxRangePreset] = useState('month')
  const [busy,         setBusy]         = useState(false)
  const [invFmt,       setInvFmt]       = useState('pdf')
  const [txFmt,        setTxFmt]        = useState('pdf')
  const [withImages,   setWithImages]   = useState(false)
  const [imgProgress,  setImgProgress]  = useState(null)
  const [withTxImages, setWithTxImages] = useState(false)
  const [txImgProgress,setTxImgProgress]= useState(null)

  // ── Import state ──
  const [impFile,    setImpFile]    = useState(null)
  const [preview,    setPreview]    = useState(null)
  const [importing,  setImporting]  = useState(false)
  const [result,     setResult]     = useState(null)
  const [backupFile, setBackupFile] = useState(null)
  const [backupPreview, setBackupPreview] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [clearBeforeRestore, setClearBeforeRestore] = useState(false)

  // ── Export logic ──
  const setTxRange = (preset, range) => { setTxRangePreset(preset); setFrom(range.from); setTo(range.to) }

  const fmtBtns = (val, set) => (
    <div className="liquid-filter-track grid-cols-2 mt-2">
      <span
        className="liquid-filter-indicator"
        style={{ width: 'calc((100% - .5rem) / 2)', transform: `translateX(${['pdf','xlsx'].indexOf(val) * 100}%)` }}
      />
      {['pdf','xlsx'].map(f=>(
        <button key={f} onClick={()=>set(f)}
          className={`liquid-filter-btn py-2 text-sm ${val===f?'is-active':''}`}>
          <span className="inline-flex items-center justify-center gap-2">
            {f==='xlsx'?<FileSpreadsheet size={15}/>:<FileText size={15}/>} {f==='xlsx'?'Excel (.xlsx)':'PDF'}
          </span>
        </button>
      ))}
    </div>
  )

  const doExportInv = async () => {
    const pdfWindow = invFmt === 'pdf' && !withImages ? openPDFPreviewWindow('กำลังเตรียม PDF สต็อกสินค้า...') : null
    if (invFmt === 'pdf' && !withImages && !pdfWindow) return
    setBusy(true); setImgProgress(null)
    try {
      const [{data}, {data: reportTxData}] = await Promise.all([
        supabase.from('products').select('*').order('created_at',{ascending:false}),
        supabase.from('transactions').select('id,product_id,category,note,amount,date,vat_documents!transactions_vat_document_id_fkey(id,status,document_number,subtotal,vat_amount,total_amount)'),
      ])
      const vatByProduct = (reportTxData || []).reduce((map, tx) => {
        const document = vatDocumentOf(tx)
        if (tx.category === 'Sale' && tx.product_id && document?.status !== 'void' && !map.has(tx.product_id)) map.set(tx.product_id, document)
        return map
      }, new Map())
      const addOnsByProduct = reportAddOnsByProduct(reportTxData)
      const exportProducts = (data || []).map(product => ({
        ...product,
        _vatDocument: vatByProduct.get(product.id) || null,
        report_add_ons: addOnsByProduct[product.id] || [],
      }))
      if (withImages) {
        const {data: txData} = await supabase.from('transactions')
          .select('id,product_id,date,category,amount,images')
          .not('images', 'is', null)
        await exportInventoryWithImages(exportProducts, txData||[], invFilter, invFmt, (done,total)=>setImgProgress({done,total}))
      } else if (invFmt==='xlsx') {
        await exportInventory(exportProducts, invFilter)
      } else {
        await previewInventoryPDFFile(exportProducts, invFilter, pdfWindow)
      }
      toast.success(invFmt === 'pdf' && !withImages ? 'เปิดหน้าต่าง PDF แล้ว' : 'ดาวน์โหลดสำเร็จ!')
    } catch(e){toast.error(e.message)}
    finally{ setBusy(false); setImgProgress(null) }
  }

  const doExportTx = async () => {
    setBusy(true); setTxImgProgress(null)
    try {
      const [{ data }, { data: balData }, { data: stockData }] = await Promise.all([
        supabase.from('transactions').select('*,products(id,model,category,base_cost,total_cost,sold_price,customer_note,images,created_at,sold_date,serial_number,installment_total,status,batch_id,sale_batch_id,trade_ref_id,notes,payment_method),vat_documents!transactions_vat_document_id_fkey(id,status,document_number,subtotal,vat_amount,total_amount)').order('date',{ascending:false}),
        supabase.from('balances').select('bank,cash').eq('id','main').single(),
        supabase.from('products').select('id,model,serial_number,category,base_cost,total_cost,sold_price,status,batch_id,sale_batch_id,trade_ref_id,is_trade_in,notes,customer_note,payment_method,created_at'),
      ])
      const txData = withPurchaseBatchTotals(data || [], stockData || [])
      const balance = balData ? { bank: Number(balData.bank||0), cash: Number(balData.cash||0) } : null
      const currentStockValue = (stockData||[]).filter(p=>p.status!=='Sold').reduce((a,p)=>a+Number(p.total_cost||0),0)
      const reportBalance = getReportBalance(txData, from||undefined, to||undefined, balance)
      const reportStockValue = getReportStock(txData, from||undefined, to||undefined, currentStockValue)
      if (withTxImages) {
        await exportTransactionsWithImages(txData, from||undefined, to||undefined, txFmt, (done,total)=>setTxImgProgress({done,total}), reportBalance, reportStockValue)
      } else if (txFmt==='xlsx') {
        await exportTransactions(txData, from||undefined, to||undefined, reportBalance, reportStockValue)
      } else {
        await previewTransactionsPDFFile(txData, from||undefined, to||undefined, reportBalance, reportStockValue)
      }
      toast.success(txFmt === 'pdf' && !withTxImages ? 'เปิดตัวอย่าง PDF แล้ว' : 'ดาวน์โหลดสำเร็จ!')
    } catch(e){toast.error(e.message)}
    finally{ setBusy(false); setTxImgProgress(null) }
  }

  const downloadJson = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const doExportFullBackup = async () => {
    setBusy(true)
    try {
      const [{ data: products, error: pErr }, { data: accessories, error: aErr }, { data: transactions, error: tErr }, { data: balances, error: bErr }] = await Promise.all([
        supabase.from('products').select('*').order('created_at', { ascending: true }),
        supabase.from('accessories').select('*').order('created_at', { ascending: true }),
        supabase.from('transactions').select('*').order('date', { ascending: true }),
        supabase.from('balances').select('*'),
      ])
      if (pErr) throw pErr
      if (aErr) throw aErr
      if (tErr) throw tErr
      if (bErr) throw bErr
      const backup = {
        format: 'camshop-full-backup',
        version: 1,
        exported_at: new Date().toISOString(),
        tables: {
          products: products || [],
          accessories: accessories || [],
          transactions: transactions || [],
          balances: balances || [],
        },
        notes: [
          'This backup preserves table ids and relationships.',
          'Image fields are restored as stored URLs. Binary storage objects are not embedded in this JSON.',
        ],
      }
      downloadJson(backup, `camshop_full_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`)
      toast.success('ดาวน์โหลด Full Backup แล้ว')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Import logic ──
  const normalizeBackup = raw => {
    const backup = raw?.tables ? raw : { tables: raw || {} }
    const tables = backup.tables || {}
    return {
      format: backup.format || 'unknown',
      version: backup.version || 0,
      exported_at: backup.exported_at || null,
      products: Array.isArray(tables.products) ? tables.products : [],
      accessories: Array.isArray(tables.accessories) ? tables.accessories : [],
      transactions: Array.isArray(tables.transactions) ? tables.transactions : [],
      balances: Array.isArray(tables.balances) ? tables.balances : [],
    }
  }

  const handleBackupFile = e => {
    const f = e.target.files[0]
    if (!f) return
    setBackupFile(f)
    setBackupPreview(null)
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result)
        const normalized = normalizeBackup(parsed)
        if (!normalized.products.length && !normalized.transactions.length && !normalized.accessories.length && !normalized.balances.length) {
          throw new Error('ไม่พบข้อมูล backup ที่รองรับ')
        }
        setBackupPreview(normalized)
      } catch (err) {
        toast.error('อ่านไฟล์ backup ไม่ได้: ' + err.message)
      }
    }
    reader.readAsText(f)
  }

  const upsertRows = async (table, rows, chunkSize = 300) => {
    let count = 0
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      if (!chunk.length) continue
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' })
      if (error) throw error
      count += chunk.length
    }
    return count
  }

  const deleteAllRows = async table => {
    const { error } = await supabase.from(table).delete().not('id', 'is', null)
    if (error) throw error
  }

  const restoreFullBackup = async () => {
    if (!backupPreview) return
    const total = backupPreview.products.length + backupPreview.accessories.length + backupPreview.transactions.length + backupPreview.balances.length
    const msg = clearBeforeRestore
      ? `Restore แบบล้างข้อมูลเดิมก่อน?\nระบบจะลบ products/accessories/transactions เดิม แล้วนำเข้า ${total} rows จาก backup`
      : `Restore แบบ merge/update?\nระบบจะ upsert ${total} rows โดยไม่ลบข้อมูลที่ไม่มีใน backup`
    if (!confirm(msg)) return
    setRestoring(true)
    const errors = []
    const counts = { products: 0, accessories: 0, transactions: 0, balances: 0 }
    try {
      if (clearBeforeRestore) {
        await deleteAllRows('transactions')
        await deleteAllRows('accessories')
        await deleteAllRows('products')
      }
      counts.products = await upsertRows('products', backupPreview.products)
      counts.accessories = await upsertRows('accessories', backupPreview.accessories)
      counts.transactions = await upsertRows('transactions', backupPreview.transactions)
      counts.balances = await upsertRows('balances', backupPreview.balances)
      setResult({
        successP: counts.products,
        successT: counts.transactions,
        errors,
        backupCounts: counts,
      })
      toast.success(`Restore สำเร็จ: สินค้า ${counts.products}, บัญชี ${counts.transactions}`)
    } catch (e) {
      errors.push(e.message)
      setResult({ successP: counts.products, successT: counts.transactions, errors, backupCounts: counts })
      toast.error('Restore ไม่สำเร็จ: ' + e.message)
    } finally {
      setRestoring(false)
    }
  }

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
            <div className={`export-toggle-track w-10 h-5 rounded-full transition-colors ${withImages?'is-on bg-brand-dark':'bg-gray-200'}`}/>
            <div className={`export-toggle-thumb absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${withImages?'translate-x-5':''}`}/>
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
        <div className="liquid-filter-track grid-cols-3">
          <span className="liquid-filter-indicator" style={{ width: 'calc((100% - .5rem) / 3)', transform: `translateX(${['month', 'previous', 'year'].indexOf(txRangePreset) * 100}%)` }}/>
          {[['month', 'เดือนนี้', monthRange(0)], ['previous', 'เดือนที่แล้ว', monthRange(-1)], ['year', 'ทั้งปี', yearRange()]].map(([key, label, range]) => (
            <button key={key} onClick={() => setTxRange(key, range)} className={`liquid-filter-btn py-2 text-xs active:scale-95 ${txRangePreset === key ? 'is-active' : ''}`}>{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 mb-1 block">ตั้งแต่วันที่</label><ThaiDatePicker value={from} onChange={value => { setFrom(value); setTxRangePreset(null) }} mode="calendar" className="input w-full"/></div>
          <div><label className="text-xs text-gray-500 mb-1 block">ถึงวันที่</label><ThaiDatePicker value={to} onChange={value => { setTo(value); setTxRangePreset(null) }} mode="calendar" className="input w-full"/></div>
        </div>
        <p className="text-xs text-gray-400">หากไม่ระบุวันที่ จะส่งออกทั้งหมด</p>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={withTxImages} onChange={e=>setWithTxImages(e.target.checked)}/>
            <div className={`export-toggle-track w-10 h-5 rounded-full transition-colors ${withTxImages?'is-on bg-brand-dark':'bg-gray-200'}`}/>
            <div className={`export-toggle-thumb absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${withTxImages?'translate-x-5':''}`}/>
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

      {/* ── Full Backup / Restore ── */}
      <div className="card space-y-3 border-2 border-red-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><Download size={20} className="text-red-600"/></div>
          <div>
            <p className="font-semibold">Full Backup / Restore</p>
            <p className="text-xs text-gray-400">สำรองข้อมูลเต็มระบบแบบ JSON พร้อม id และความสัมพันธ์</p>
          </div>
        </div>
        <div className="bg-red-50 rounded-xl p-3 text-xs text-red-700 space-y-1">
          <p>• เก็บข้อมูลตาราง products, accessories, transactions, balances</p>
          <p>• ใช้สำหรับกู้คืนระบบหรือย้ายฐานข้อมูล โดยรักษา id / batch / ผ่อน / แบ่งจ่าย</p>
          <p>• รูปภาพจะ restore เป็น URL เดิม ไม่ได้ฝังไฟล์รูปจริงใน JSON</p>
        </div>
        <button onClick={doExportFullBackup} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>ดาวน์โหลด Full Backup (.json)
        </button>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-red-200 rounded-xl py-6 cursor-pointer hover:border-brand-red hover:bg-red-50 transition-all">
          <Upload size={24} className="text-red-400 mb-2"/>
          <p className="text-sm font-medium text-gray-600">{backupFile ? backupFile.name : 'เลือกไฟล์ Full Backup .json เพื่อ Restore'}</p>
          <p className="text-xs text-gray-400 mt-1">รองรับไฟล์ที่ดาวน์โหลดจาก Full Backup เท่านั้น</p>
          <input autoComplete="off" type="file" accept=".json,application/json" className="hidden" onChange={handleBackupFile}/>
        </label>
        {backupPreview && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-amber-50 rounded-xl p-2 text-center"><p className="text-lg font-bold text-amber-700">{backupPreview.products.length}</p><p className="text-[10px] text-amber-600">สินค้า</p></div>
              <div className="bg-blue-50 rounded-xl p-2 text-center"><p className="text-lg font-bold text-blue-700">{backupPreview.accessories.length}</p><p className="text-[10px] text-blue-600">อุปกรณ์เสริม</p></div>
              <div className="bg-green-50 rounded-xl p-2 text-center"><p className="text-lg font-bold text-green-700">{backupPreview.transactions.length}</p><p className="text-[10px] text-green-600">บัญชี</p></div>
              <div className="bg-gray-50 rounded-xl p-2 text-center"><p className="text-lg font-bold text-gray-700">{backupPreview.balances.length}</p><p className="text-[10px] text-gray-600">ยอดเงิน</p></div>
            </div>
            <p className="text-xs text-gray-400">
              Exported: {backupPreview.exported_at ? thDate(backupPreview.exported_at) : '-'} | Format: {backupPreview.format}
            </p>
            <label className="flex items-start gap-2 bg-white/70 rounded-xl p-3 border border-red-100">
              <input type="checkbox" checked={clearBeforeRestore} onChange={e=>setClearBeforeRestore(e.target.checked)} className="mt-1"/>
              <div>
                <p className="text-sm font-semibold text-red-700">ล้างข้อมูลเดิมก่อน Restore</p>
                <p className="text-xs text-red-500">ใช้เมื่ออยากให้ฐานข้อมูลหลัง restore ตรงกับ backup มากที่สุด ถ้าไม่เลือกจะเป็นการ merge/update</p>
              </div>
            </label>
            <button onClick={restoreFullBackup} disabled={restoring} className="btn-primary w-full flex items-center justify-center gap-2">
              <Upload size={16}/>{restoring ? 'กำลัง Restore...' : 'Restore Full Backup'}
            </button>
          </div>
        )}
      </div>

      {/* ── นำเข้าข้อมูล ── */}
      <div className="border-t border-amber-100 pt-2">
        <h2 className="font-bold text-lg text-brand-dark mb-3">นำเข้าข้อมูล</h2>
        <p className="text-xs text-gray-400">ส่วนนี้เป็นการนำเข้าจาก Template เท่านั้น ไม่ใช่ Full Restore</p>
      </div>

      {/* Step 1 */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-sm font-bold text-amber-800">01</div>
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
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-sm font-bold text-amber-800">02</div>
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
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-sm font-bold text-amber-800">03</div>
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
            <div>
              <p className="font-semibold">ผลการนำเข้า</p>
              <p className="text-xs text-gray-400">
                สินค้า {result.successP} รายการ | บัญชี {result.successT} รายการ
                {result.backupCounts ? ` | อุปกรณ์เสริม ${result.backupCounts.accessories} | ยอดเงิน ${result.backupCounts.balances}` : ''}
              </p>
            </div>
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
const escapeHtml = v => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

function openPDFPreviewWindow(message = 'กำลังเตรียม PDF...') {
  const w = window.open('', '_blank')
  if (!w) {
    alert('เบราว์เซอร์บล็อกหน้าต่างแสดง PDF กรุณาลองกดอีกครั้ง')
    return null
  }
  w.document.open()
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDF Preview</title>
  <style>body{font-family:sans-serif;margin:24px;color:#f7f7f8;background:#09090a}.box{max-width:520px;margin:12vh auto;background:#151517;border:1px solid #343438;border-radius:18px;padding:24px}h2{margin:0 0 8px;font-size:20px;color:#ef2b32}p{margin:0;color:#a4a4aa;font-size:13px}</style>
  </head><body><div class="box"><h2>${message}</h2><p>หน้าต่างนี้ถูกเปิดจากการกดปุ่มโดยตรง จึงไม่โดนบล็อก popup</p></div></body></html>`)
  w.document.close()
  return w
}

function makePDF(title, headers, rows, previewWindow = null, options = {}) {
  const w = previewWindow || openPDFPreviewWindow(`กำลังเตรียม ${title}...`)
  if (!w) return
  const numericCols = new Set(options.numericCols || [])
  const colgroupHtml = (options.colWidths || []).length
    ? `<colgroup>${options.colWidths.map(w => `<col style="width:${escapeHtml(w)}">`).join('')}</colgroup>`
    : ''
  const headerHtml = headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')
  const rowsHtml = rows.map(r => {
    const cells = r.map((c, i) => `<td class="${numericCols.has(i) ? 'num' : ''}">${escapeHtml(c)}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  const summaryLines = options.summaryLines || []
  const summaryHtml = summaryLines.length ? `
    <tfoot>
      <tr>
        <td class="summary-cell" colspan="${headers.length}">
          ${summaryLines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}
        </td>
      </tr>
    </tfoot>` : ''
  const footnotes = options.footnotes || []
  const footnotesHtml = footnotes.length ? `
    <section class="footnotes">
      <h2>คำอธิบายหมายเหตุท้ายรายงาน</h2>
      ${footnotes.map(note => `
        <div class="footnote-item">
          <div class="footnote-title">${escapeHtml(note.title)}</div>
          <div class="footnote-body">${escapeHtml(note.body)}</div>
        </div>
      `).join('')}
    </section>` : ''
  const statsClass = options.statsColumns ? `stats cols-${options.statsColumns}` : 'stats'
  const statsHtml = (options.stats || []).length ? `
    <section class="${statsClass}">
      ${options.stats.map(s => `
        <div class="stat ${s.tone || ''}">
          <div class="stat-label">${escapeHtml(s.label)}</div>
          <div class="stat-value">${escapeHtml(s.value)}</div>
        </div>
      `).join('')}
    </section>` : ''
  w.document.open()
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <style>
    @page{size:A4 landscape;margin:8mm}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:11px;margin:0;background:#09090a;color:#1F1412}
    .toolbar{position:sticky;top:0;z-index:10;background:#151517;color:#f7f7f8;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #343438}
    .toolbar-title{font-weight:800;font-size:15px;color:#D32F23}
    .toolbar-actions{display:flex;gap:8px}
    button,a{border:0;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none}
    .back{background:#1d1d20;color:#f7f7f8;border:1px solid #343438}
    .print{background:#EF2B32;color:white}
    .page{background:#fff;margin:12px auto;padding:16px;max-width:1180px;border:1px solid #343438;border-radius:18px}
    .report-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;border-bottom:2px solid rgba(211,47,35,.2);padding-bottom:10px;margin-bottom:11px}
    h1{font-size:21px;line-height:1.1;margin:0;color:#1F1412}
    .meta{font-size:10px;color:#7b5a56;margin-top:4px}
    .brand{font-weight:800;color:white;background:#D32F23;border-radius:12px;padding:8px 12px;white-space:nowrap}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px;margin:8px 0 10px}
    .stats.cols-4{grid-template-columns:repeat(4,1fr)}
    .stat{border:1px solid rgba(211,47,35,.18);border-radius:12px;padding:7px 9px;background:#fff7f7;min-height:45px}
    .stat-label{font-size:8.4px;color:#7b5a56;margin-bottom:3px;white-space:nowrap}
    .stat-value{font-size:12.5px;font-weight:800;color:#1F1412;line-height:1.12;overflow-wrap:anywhere}
    .stat.in .stat-value{color:#16a34a}.stat.out .stat-value{color:#dc2626}.stat.warn .stat-value{color:#d97706}.stat.bank .stat-value{color:#2563eb}.stat.cash .stat-value{color:#16a34a}
    .table-wrap{border:1px solid rgba(211,47,35,.14);border-radius:18px;overflow:hidden;background:white}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th{background:#D32F23;color:white;padding:5.5px 5px;text-align:left;font-size:8.1px;line-height:1.22;vertical-align:bottom;overflow-wrap:anywhere}
    td{padding:4.8px 5px;border-bottom:1px solid rgba(211,47,35,.09);font-size:7.8px;line-height:1.28;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
    td.num{text-align:right;font-weight:700;white-space:normal}
    .summary-cell{font-weight:400!important;text-align:left!important;background:#fff1ef;color:#1F1412;font-size:8.1px;line-height:1.45;padding-left:7px!important;padding-right:7px!important}
    .summary-cell span{display:inline-block;margin-right:14px;white-space:nowrap}
    .footnotes{margin-top:10px;border:1px solid rgba(211,47,35,.14);border-radius:18px;background:#fffaf9;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
    .footnotes h2{margin:0;padding:7px 9px;background:#fff1ef;color:#1F1412;font-size:10px;border-bottom:1px solid rgba(211,47,35,.12)}
    .footnote-item{padding:7px 9px;border-bottom:1px solid rgba(211,47,35,.08)}
    .footnote-item:last-child{border-bottom:0}
    .footnote-title{font-size:8.5px;font-weight:800;color:#D32F23;margin-bottom:3px}
    .footnote-body{font-size:8px;line-height:1.45;color:#1F1412;white-space:pre-wrap;overflow-wrap:anywhere}
    tr:nth-child(even){background:#fff8f7}
    tr:last-child td{border-bottom:0}
    thead{display:table-header-group}
    tfoot{display:table-row-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    @media print{body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{display:none}.page{margin:0;padding:0;box-shadow:none;max-width:none;border:0}.stats{page-break-inside:avoid}.table-wrap{border-radius:0}}
  </style>
  </head><body>
  <div class="toolbar">
    <div class="toolbar-title">${title}</div>
    <div class="toolbar-actions">
      <a class="back" href="/">กลับหน้าหลัก</a>
      <button class="print" onclick="window.print()">ปริ้น</button>
    </div>
  </div>
  <main class="page">
    <section class="report-head">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">${escapeHtml(options.subtitle || '')}</div>
        <div class="meta">สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</div>
      </div>
      <div class="brand">SMALL CAMERA</div>
    </section>
    ${statsHtml}
    <section class="table-wrap">
      <table>${colgroupHtml}<thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody>${summaryHtml}</table>
    </section>
    ${footnotesHtml}
  </main>
  </body></html>`)
  w.document.close()
}

function exportInventoryPDF(products, statusFilter='all', previewWindow=null) {
  const filtered = sortProductsForStockPDF(products.filter(p=>statusFilter==='all'||p.status===statusFilter))
  const rows = filtered
    .map(p=>[p.model,p.serial_number,p.category||'กล้อง',p.condition,STATUS_TH[p.status]||p.status,
             `฿${fmt(p.base_cost)}`,`฿${fmt(p.total_cost)}`,
             p.sold_price?`฿${fmt(p.sold_price)}`:'',
             p.sold_price?`฿${fmt(profitAfterVat(p.sold_price,p.total_cost,p._vatDocument))}`:'',
             thDate(p.created_at),thDate(p.sold_date),p.customer_note||'',p.notes||''])
  if (!rows.length) {
    previewWindow?.close()
    return alert('ไม่มีข้อมูล')
  }
  const totalCost = filtered.reduce((a,p)=>a+Number(p.total_cost||0),0)
  const totalSold = filtered.reduce((a,p)=>p.sold_price?a+Number(p.sold_price):a,0)
  const soldCount = filtered.filter(p=>p.status==='Sold').length
  const profit = filtered.reduce((a,p)=>p.sold_price?a+profitAfterVat(p.sold_price,p.total_cost,p._vatDocument):a,0)
  makePDF('รายงานสต็อกสินค้า',['รุ่น','Serial','ประเภท','เกรด','สถานะ','ต้นทุนเริ่ม','ต้นทุนรวม','ราคาขาย','กำไร','วันรับเข้า','วันขาย','รายละเอียดลูกค้า','หมายเหตุ'],rows,previewWindow,{
    subtitle: `ตัวกรอง: ${statusFilter === 'all' ? 'ทั้งหมด' : STATUS_TH[statusFilter] || statusFilter}`,
    numericCols: [3,5,6,7,8],
    colWidths: ['12%','8%','6%','4%','6%','6.5%','6.5%','6.5%','6%','7.5%','7.5%','13%','10.5%'],
    statsColumns: 4,
    summaryLines: [
      `ต้นทุนรวม ฿${fmt(totalCost)}`,
      `ราคาขายรวม ฿${fmt(totalSold)}`,
      `กำไรรวม ฿${fmt(profit)}`,
    ],
    stats: [
      { label: 'จำนวนรายการ', value: `${filtered.length} รายการ` },
      { label: 'ขายแล้ว', value: `${soldCount} รายการ`, tone: 'in' },
      { label: 'ต้นทุนรวม', value: `฿${fmt(totalCost)}`, tone: 'warn' },
      { label: 'กำไรรวม', value: `฿${fmt(profit)}`, tone: profit >= 0 ? 'in' : 'out' },
    ],
  })
}

function exportTransactionsPDF(txs, from, to, balance=null, currentStockValue=0, previewWindow=null) {
  const filtered = txs.filter(t=>{
    if (from&&new Date(t.date)<new Date(from)) return false
    if (to&&new Date(t.date)>new Date(to+'T23:59:59')) return false
    return true
  })
  if (!filtered.length) {
    previewWindow?.close()
    return alert('ไม่มีข้อมูล')
  }

  const balMap = buildBalanceMap(txs, balance)
  const reportBalance = balance ? (balMap[filtered[0].id] || balance) : null
  const stockMap = buildStockMap(txs, currentStockValue)
  const reportStockValue = stockMap[filtered[0].id] ?? Number(currentStockValue || 0)

  const totalIncome  = filtered.filter(t=>t.type==='Income').reduce((a,t)=>a+Number(t.amount),0)
  const totalExpense = filtered.filter(t=>t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)
  const DEDUCT = new Set(['Shipping','Marketing','Operating','Other'])
  const popupCounted = new Set()
  const saleInstallmentGroups = buildTransactionGroups(txs, txs).filter(group => group.kind === 'sale' && group.installment?.hasInstallments)
  const installmentSaleTxIds = new Set(saleInstallmentGroups.flatMap(group => group.txs.map(tx => tx.id)))
  const finalInstallmentSaleTxIds = new Set(
    saleInstallmentGroups
      .filter(group => group.installment?.isFinalInstallment)
      .flatMap(group => group.txs.map(tx => tx.id))
  )
  const plValues = filtered.map(t=>{
    if (t.category==='Sale'&&t.products?.total_cost!=null) {
      if (!t.products?.installment_total) return profitAfterVat(t.amount,t.products.total_cost,vatDocumentOf(t))
      if (installmentSaleTxIds.has(t.id) && !finalInstallmentSaleTxIds.has(t.id)) return null
      if (t.products?.status==='Sold'&&!popupCounted.has(t.product_id)) {
        popupCounted.add(t.product_id)
        return profitAfterVat(t.products.installment_total,t.products.total_cost,vatDocumentOf(t))
      }
      return null
    }
    if (t.category==='Trade'&&t.trade_profit_a!=null) return profitAfterVat(
      t.trade_sell_a,
      Number(t.trade_sell_a || 0) - Number(t.trade_profit_a || 0),
      vatDocumentOf(t),
    )
    if (t.type==='Expense'&&DEDUCT.has(t.category)) return -Number(t.amount)
    return null
  })
  const totalProfit = plValues.reduce((a,v)=>v!=null?a+v:a,0)
  const deductions  = filtered.filter(t=>t.type==='Expense'&&DEDUCT.has(t.category)).reduce((a,t)=>a+Number(t.amount),0)
  const grossProfit = totalProfit + deductions
  const plById = filtered.reduce((map, tx, index) => {
    map[tx.id] = plValues[index]
    return map
  }, {})
  const groups = buildTransactionGroups(filtered, txs)
  const footnotes = []
  const LONG_GROUP_NOTE_LIMIT = 90
  const LONG_GROUP_DETAIL_LIMIT = 120
  const rows = groups.map(group => {
    const t = group.representative
    const balanceTx = group.balanceTx || t
    const bal = balMap[balanceTx.id]
    const groupPl = group.txs.reduce((sum, tx) => (
      plById[tx.id] != null ? sum + Number(plById[tx.id]) : sum
    ), 0)
    const hasPl = group.txs.some(tx => plById[tx.id] != null)
    const detailLines = group.lines.map((item, index) => (
      `${index + 1}. ${item.model || item.note || group.category}${item.serial ? ` SN:${item.serial}` : ''} ฿${fmt(item.amount)}${item.profit != null ? ` | กำไร ${item.profit >= 0 ? '+' : '-'}฿${fmt(Math.abs(item.profit))}` : ''}`
    )).join('\n')
    const customerLines = group.txs
      .map(tx => tx.category === 'Sale' ? tx.products?.customer_note : '')
      .filter(Boolean)
    const noteLines = group.txs
      .map(tx => tx.note)
      .filter(Boolean)
    const uniqueNote = [...new Set(noteLines)].join('\n')
    const shouldMoveDetailToFootnote = group.kind === 'sale' && group.itemCount > 1 && detailLines.length > LONG_GROUP_DETAIL_LIMIT
    const shouldMoveNoteToFootnote = group.kind === 'sale' && group.itemCount > 1 && uniqueNote.length > LONG_GROUP_NOTE_LIMIT
    let tableDetail = detailLines
    let tableNote = uniqueNote
    if (shouldMoveDetailToFootnote || shouldMoveNoteToFootnote) {
      const ref = `หมายเหตุ ${footnotes.length + 1}`
      const refText = `ดู${ref}ท้ายรายงาน`
      if (shouldMoveDetailToFootnote) tableDetail = refText
      if (shouldMoveNoteToFootnote) tableNote = refText
      footnotes.push({
        title: `${ref}: ${groupKindLabel(group)} · ${thDate(t.date)} · ฿${fmt(group.totalAmount)}`,
        body: [
          shouldMoveDetailToFootnote ? `รายการสินค้า:\n${detailLines}` : '',
          shouldMoveNoteToFootnote ? `หมายเหตุ:\n${uniqueNote}` : '',
        ].filter(Boolean).join('\n\n'),
      })
    }
    const stockCost = group.lines.reduce((sum, item) => sum + Number(item.cost || 0), 0)
    return [
      thDate(t.date),
      t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
      groupKindLabel(group),
      `฿${fmt(group.totalAmount)}`,
      t.type === 'Income' ? `฿${fmt(group.totalAmount)}` : '',
      t.type === 'Expense' ? `฿${fmt(group.totalAmount)}` : '',
      hasPl ? `฿${fmt(groupPl)}` : '',
      tableDetail,
      t.products?.created_at ? thDate(t.products.created_at) : '',
      stockCost ? `฿${fmt(stockCost)}` : '',
      [...new Set(customerLines)].join('\n'),
      tableNote,
      bal ? `฿${fmt(bal.bank)}` : '',
      bal ? `฿${fmt(bal.cash)}` : '',
      `฿${fmt(stockMap[balanceTx.id])}`,
    ]
  })
  const period = from || to ? `${from || 'เริ่มต้น'} ถึง ${to || 'ล่าสุด'}` : 'ทั้งหมด'
  makePDF('รายงานรายการบัญชี',['วันที่','ประเภท','หมวดหมู่','จำนวน','รายรับ','รายจ่าย','กำไรขาดทุน','รุ่นกล้อง','วันที่ซื้อ','ต้นทุน','รายละเอียดลูกค้า','หมายเหตุ','ธนาคารคงเหลือ','เงินสดคงเหลือ','สต๊อกคงเหลือ'],rows,previewWindow,{
    subtitle: `ช่วงรายงาน: ${period} · ${groups.length} รายการ${groups.length !== filtered.length ? ` (${filtered.length} ธุรกรรม)` : ''}`,
    numericCols: [3,4,5,6,9,12,13,14],
    colWidths: ['6%','4%','5.5%','5.8%','5.8%','5.8%','6%','7%','6%','5.2%','12.5%','10%','6.8%','6.8%','6.8%'],
    statsColumns: 4,
    footnotes,
    summaryLines: [
      `เงินรับจริง ฿${fmt(totalIncome)}`,
      `รวมรายจ่าย ฿${fmt(totalExpense)}`,
      `กำไรสุทธิ ฿${fmt(totalProfit)}`,
      reportBalance ? `โอนล่าสุดในรายงาน ฿${fmt(reportBalance.bank)}` : 'โอนล่าสุดในรายงาน -',
      reportBalance ? `เงินสดล่าสุดในรายงาน ฿${fmt(reportBalance.cash)}` : 'เงินสดล่าสุดในรายงาน -',
      `สต๊อกล่าสุดในรายงาน ฿${fmt(reportStockValue)}`,
    ],
    stats: [
      { label: 'เงินรับจริง', value: `฿${fmt(totalIncome)}`, tone: 'in' },
      { label: 'รวมรายจ่าย', value: `฿${fmt(totalExpense)}`, tone: 'out' },
      { label: 'กำไรขายก่อนหัก', value: `฿${fmt(grossProfit)}`, tone: grossProfit >= 0 ? 'in' : 'out' },
      { label: 'กำไรสุทธิ', value: `฿${fmt(totalProfit)}`, tone: totalProfit >= 0 ? 'in' : 'out' },
      { label: 'โอนคงเหลือล่าสุดในรายงาน', value: reportBalance ? `฿${fmt(reportBalance.bank)}` : '-', tone: 'bank' },
      { label: 'เงินสดคงเหลือล่าสุดในรายงาน', value: reportBalance ? `฿${fmt(reportBalance.cash)}` : '-', tone: 'cash' },
      { label: 'สต๊อกคงเหลือล่าสุดในรายงาน', value: `฿${fmt(reportStockValue)}`, tone: 'warn' },
    ],
  })
}
