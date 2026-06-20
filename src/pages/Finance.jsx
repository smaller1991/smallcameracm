import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Plus,
  Edit2,
  X,
  Check,
  ImagePlus,
  SlidersHorizontal,
  Search,
  Eye,
  CreditCard,
  Banknote,
  Package,
  Repeat2,
  Scissors,
  Shield,
  TrendingUp,
  TrendingDown,
  User,
  BarChart3,
  Send,
  RotateCcw,
  Image as ImageIcon,
} from 'lucide-react'
import { uploadReceiptImages, deleteReceiptImage, deleteAllProductImages } from '../lib/imageUtils'
import { thDate, thDateShort, toLocal, nowLocal } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import toast from 'react-hot-toast'
import { scheduleDelete } from '../lib/undoDelete'

const CATS = ['Buy Stock','Add-on','Sale','Rent','Marketing','Operating','Shipping','Other','รายรับ/จ่ายที่ไม่มีผลกับกำไร']
const PROFIT_DEDUCT_CATS = ['Shipping','Marketing','Operating','Other']
const PROD_CATS = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const TX_TYPES  = ['Income','Expense']
const fmt  = n => Number(n||0).toLocaleString('th-TH')

const CAT_COLOR = {
  'Sale':        'bg-green-100 text-green-700 border-green-200',
  'Buy Stock':   'bg-red-100 text-red-700 border-red-200',
  'Add-on':      'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Trade':       'bg-blue-100 text-blue-700 border-blue-200',
  'Shipping':    'bg-orange-100 text-orange-700 border-orange-200',
  'รายรับ/จ่ายที่ไม่มีผลกับกำไร': 'bg-gray-100 text-gray-500 border-gray-200',
}
const catColor = cat => CAT_COLOR[cat] || 'bg-gray-100 text-gray-600 border-gray-200'
const txCardClass = tx => tx.category === 'Trade'
  ? 'tx-card tx-card-trade'
  : tx.type === 'Income'
    ? 'tx-card tx-card-income'
    : tx.type === 'Expense'
      ? 'tx-card tx-card-expense'
      : 'tx-card tx-card-neutral'

const monthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
}
const monthEnd = () => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const monthRange = offset => {
  const d = new Date()
  return {
    from: localDate(new Date(d.getFullYear(), d.getMonth() + offset, 1)),
    to: localDate(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0)),
  }
}
const yearRange = () => {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

export default function Finance() {
  const [txs,      setTxs]      = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState({type:'Expense',category:'Operating',amount:'',note:'',date:nowLocal()})
  const [saving,   setSaving]   = useState(false)
  const [dateFrom, setDateFrom] = useState(monthStart())
  const [dateTo,   setDateTo]   = useState(monthEnd())
  const [showFilter, setShowFilter] = useState(false)
  const [selCats,    setSelCats]    = useState([])   // หมวดหมู่ที่เลือก
  const [selTypes,   setSelTypes]   = useState([])   // Income/Expense
  const [selProdCats,setSelProdCats]= useState([])   // ประเภทสินค้า
  const [imgFiles,    setImgFiles]    = useState([])
  const [imgPreviews, setImgPreviews] = useState([])
  const [removedImgs, setRemovedImgs] = useState([])
  const [searchQuery, setSearchQuery] = useState('')

  // ยอดเงินคงเหลือ
  const [balance,    setBalance]    = useState({bank:0,cash:0})
  const [editBal,    setEditBal]    = useState(false)
  const [balForm,    setBalForm]    = useState({bank:'',cash:''})

  const [lightbox,     setLightbox]     = useState(null) // {imgs:[], idx:0}
  const [txDetail,     setTxDetail]     = useState(null)
  const tapRef = useRef({ ok: false, x: 0, y: 0 })
  const tap = cb => ({
    onTouchStart: e => { tapRef.current = { ok: true, x: e.touches[0].clientX, y: e.touches[0].clientY } },
    onTouchMove:  e => {
      const dx = Math.abs(e.touches[0].clientX - tapRef.current.x)
      const dy = Math.abs(e.touches[0].clientY - tapRef.current.y)
      if (dx > 8 || dy > 8) tapRef.current.ok = false
    },
    onTouchEnd: e => { if (tapRef.current.ok) { e.preventDefault(); cb() } tapRef.current.ok = false },
    onClick: cb,
  })

  const [stockValue,   setStockValue]   = useState(0)
  const [soldProfit,   setSoldProfit]   = useState(0)
  const [soldItems,    setSoldItems]    = useState([])
  const [showProfit,   setShowProfit]   = useState(false)
  const [profitFrom,   setProfitFrom]   = useState(monthStart())
  const [profitTo,     setProfitTo]     = useState(monthEnd())
  const [showIncome,   setShowIncome]   = useState(false)
  const [showExpense,  setShowExpense]  = useState(false)
  const [detailFrom,   setDetailFrom]   = useState('')
  const [detailTo,     setDetailTo]     = useState('')

  const load = async () => {
    const [{data:txData},{data:bal},{data:products},{data:allProducts}] = await Promise.all([
      supabase.from('transactions').select('*,products(model,category,total_cost,status,warranty_expiry,payment_method,customer_note,batch_id)').order('date',{ascending:false}),
      supabase.from('balances').select('*').eq('id','main').single(),
      supabase.from('products').select('id,model,serial_number,category,total_cost,sold_price,sold_date,payment_method,is_trade_in').eq('status','Sold'),
      supabase.from('products').select('total_cost,status,batch_id'),
    ])
    const batchTotals = (allProducts||[]).reduce((map, p) => {
      if (p.batch_id) map[p.batch_id] = (map[p.batch_id] || 0) + Number(p.total_cost || 0)
      return map
    }, {})
    const txsWithBatchTotals = (txData||[]).map(t => (
      t.products?.batch_id
        ? { ...t, products: { ...t.products, batch_total_cost: batchTotals[t.products.batch_id] || Number(t.products.total_cost || 0) } }
        : t
    ))
    setTxs(txsWithBatchTotals)
    if (bal) setBalance({bank:Number(bal.bank),cash:Number(bal.cash)})

    const sold = (products||[]).filter(p=>p.sold_price)
    setSoldItems(sold)
    const sp         = sold.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)
    const deductions = txsWithBatchTotals.filter(t=>PROFIT_DEDUCT_CATS.includes(t.category)&&t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)
    setSoldProfit(sp - deductions)

    const sv = (allProducts||[]).filter(p=>p.status!=='Sold').reduce((a,p)=>a+Number(p.total_cost),0)
    setStockValue(sv)
    setLoading(false)
  }
  useEffect(()=>{load()},[])

  // ยอดคงเหลือหลังรายการ
  const balMap = useMemo(() => {
    const map = {}
    let runBank = balance.bank
    let runCash = balance.cash
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i]
      const nextTx = txs[i + 1]
      // ใช้ stored anchor ของ tx นี้เพื่อ display
      if (tx.bank_after != null && tx.cash_after != null) {
        runBank = Number(tx.bank_after)
        runCash = Number(tx.cash_after)
      }
      map[tx.id] = { bank: runBank, cash: runCash }
      // คำนวณยอดก่อน tx นี้ (สำหรับ iteration ถัดไป)
      if (tx.bank_after != null && tx.cash_after != null && nextTx?.bank_after != null && nextTx?.cash_after != null) {
        // ทั้งคู่มี anchor → ใช้ nextTx anchor โดยตรง (แม่นยำที่สุด ไม่ต้องรู้ payment_method)
        runBank = Number(nextTx.bank_after)
        runCash = Number(nextTx.cash_after)
      } else if (tx.bank_amount != null || tx.cash_amount != null) {
        // มี split amounts → reverse แบบ split
        const bAmt = Number(tx.bank_amount || 0)
        const cAmt = Number(tx.cash_amount || 0)
        if (tx.type === 'Income') { runBank -= bAmt; runCash -= cAmt }
        else { runBank += bAmt; runCash += cAmt }
      } else {
        // fallback: single payment method
        const amt = Number(tx.amount || 0)
        if (tx.type === 'Income') {
          if (tx.payment_method === 'โอน') runBank -= amt; else runCash -= amt
        } else {
          if (tx.payment_method === 'โอน') runBank += amt; else runCash += amt
        }
      }
    }
    return map
  }, [txs, balance])

  // มูลค่าสต๊อกหลังรายการ: เริ่มจากสต๊อกปัจจุบัน แล้วย้อนรายการจากใหม่ไปเก่า
  const stockMap = useMemo(() => {
    const map = {}
    let runStock = Number(stockValue || 0)
    const soldProductSeen = new Set()

    const stockDelta = tx => {
      const productCost = Number(tx.products?.total_cost || 0)
      const batchCost = Number(tx.products?.batch_total_cost || 0)
      if (tx.category === 'Buy Stock' && tx.product_id && productCost) {
        return batchCost || productCost
      }
      if (tx.category === 'Add-on' && tx.product_id) {
        return Number(tx.amount || 0)
      }
      if (tx.category === 'Sale' && tx.product_id && tx.products?.status === 'Sold' && productCost && !soldProductSeen.has(tx.product_id)) {
        soldProductSeen.add(tx.product_id)
        return -productCost
      }
      if (tx.category === 'Trade') {
        const sellA = Number(tx.trade_sell_a || 0)
        const profitA = Number(tx.trade_profit_a || 0)
        if (!sellA && !profitA) return 0
        const costA = sellA - profitA
        const diff = tx.type === 'Income'
          ? Number(tx.amount || 0)
          : -Number(tx.amount || 0)
        const buyB = sellA - diff
        return buyB - costA
      }
      return 0
    }

    for (const tx of txs) {
      map[tx.id] = runStock
      runStock -= stockDelta(tx)
    }
    return map
  }, [txs, stockValue])

  // แปลง UTC timestamp → local YYYY-MM-DD string สำหรับเปรียบเทียบวัน (timezone-safe)
  const toLocalDateStr = iso => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  const txMatchesFilters = (t, from = dateFrom, to = dateTo) => {
    const dateStr = toLocalDateStr(t.date)
    if (from && dateStr < from) return false
    if (to   && dateStr > to) return false
    if (selTypes.length>0 && !selTypes.includes(t.type)) return false
    if (selCats.length>0  && !selCats.includes(t.category)) return false
    if (selProdCats.length>0) {
      if (!t.products?.category || !selProdCats.includes(t.products.category)) return false
    }
    return true
  }

  // filter by date
  const filtered = txs.filter(t => txMatchesFilters(t))

  const q = searchQuery.trim().toLowerCase()
  const searched = q
    ? filtered.filter(t =>
        (t.note||'').toLowerCase().includes(q) ||
        (t.category||'').toLowerCase().includes(q) ||
        (t.products?.model||'').toLowerCase().includes(q) ||
        String(t.amount||'').includes(q)
      )
    : filtered

  const activeFilters = selCats.length + selTypes.length + selProdCats.length
  const clearFilters = () => { setSelCats([]); setSelTypes([]); setSelProdCats([]) }
  const setDateRange = range => { setDateFrom(range.from); setDateTo(range.to) }
  const isDateRange = range => dateFrom === range.from && dateTo === range.to
  const datePresetClass = active => `py-2 rounded-xl text-xs font-semibold border active:scale-95 transition-all ${
    active
      ? 'bg-brand-dark text-brand-yellow border-brand-dark shadow-sm'
      : 'bg-white text-gray-500 border-gray-200'
  }`
  const openIncomeDetail = () => { setDetailFrom(dateFrom); setDetailTo(dateTo); setShowIncome(true) }
  const openExpenseDetail = () => { setDetailFrom(dateFrom); setDetailTo(dateTo); setShowExpense(true) }
  const openProfitDetail = () => { setProfitFrom(dateFrom); setProfitTo(dateTo); setShowProfit(true) }

  const toggle = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(x=>x!==val) : [...prev, val])
  }

  // sold items filtered by profit date range
  const filteredSoldItems = soldItems.filter(p => {
    if (!p.sold_date) return false
    const ds = toLocalDateStr(p.sold_date)
    if (profitFrom && ds < profitFrom) return false
    if (profitTo   && ds > profitTo) return false
    return true
  })
  const filteredGross      = filteredSoldItems.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)
  const filteredDeductions = PROFIT_DEDUCT_CATS.map(cat => ({
    cat,
    amount: txs.filter(t => {
      if (t.category !== cat || t.type !== 'Expense') return false
      const ds = toLocalDateStr(t.date)
      if (profitFrom && ds < profitFrom) return false
      if (profitTo   && ds > profitTo) return false
      return true
    }).reduce((a,t)=>a+Number(t.amount),0)
  })).filter(d => d.amount > 0)
  const filteredDeductTotal = filteredDeductions.reduce((a,d)=>a+d.amount,0)
  const filteredProfit = filteredGross - filteredDeductTotal
  const summarySoldItems = soldItems.filter(p => {
    if (!p.sold_date) return false
    const ds = toLocalDateStr(p.sold_date)
    if (dateFrom && ds < dateFrom) return false
    if (dateTo   && ds > dateTo) return false
    if (selProdCats.length>0 && (!p.category || !selProdCats.includes(p.category))) return false
    return true
  })
  const summaryGross = summarySoldItems.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)
  const summaryDeductTotal = txs
    .filter(t => PROFIT_DEDUCT_CATS.includes(t.category) && t.type === 'Expense' && txMatchesFilters(t))
    .reduce((a,t)=>a+Number(t.amount),0)
  const summaryProfit = summaryGross - summaryDeductTotal

  const income      = filtered.filter(t=>t.type==='Income').reduce((a,t)=>a+Number(t.amount),0)
  const expense     = filtered.filter(t=>t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)
  const totalWealth = balance.bank + balance.cash + stockValue
  const chartRows = useMemo(() => {
    const map = new Map()
    filtered.forEach(t => {
      const key = t.category || 'Other'
      const row = map.get(key) || { category: key, income: 0, expense: 0, count: 0 }
      const amount = Number(t.amount || 0)
      if (t.type === 'Income') row.income += amount
      if (t.type === 'Expense') row.expense += amount
      row.count += 1
      map.set(key, row)
    })
    return Array.from(map.values())
      .map(row => ({
        ...row,
        total: row.income + row.expense,
        net: row.income - row.expense,
      }))
      .sort((a,b) => b.total - a.total)
  }, [filtered])
  const chartMax = Math.max(...chartRows.map(row => row.total), 1)

  const saveBalance = async () => {
    const bank = parseFloat(balForm.bank)
    const cash = parseFloat(balForm.cash)
    if (isNaN(bank)||isNaN(cash)) return toast.error('กรุณากรอกตัวเลข')
    await supabase.from('balances').update({bank,cash,updated_at:new Date().toISOString()}).eq('id','main')
    setBalance({bank,cash}); setEditBal(false); toast.success('บันทึกยอดเงินแล้ว')
  }

  const openAdd = () => {
    setEditId(null)
    setForm({type:'Expense',category:'Operating',amount:'',note:'',date:nowLocal(),payment_method:'โอน',bank_amount:'',cash_amount:''})
    setImgFiles([]); setImgPreviews([]); setRemovedImgs([])
    setShowForm(true)
  }
  const openEdit = tx => {
    setEditId(tx.id)
    const displayed = balMap[tx.id]
    setForm({type:tx.type,category:tx.category,amount:tx.amount,note:tx.note||'',date:toLocal(tx.date),customer_note:tx.products?.customer_note||'',payment_method:tx.payment_method||'โอน',bank_amount:tx.bank_amount??'',cash_amount:tx.cash_amount??'',bank_after:displayed?.bank??tx.bank_after??'',cash_after:displayed?.cash??tx.cash_after??''})
    setImgFiles([]); setImgPreviews([]); setRemovedImgs([])
    setShowForm(true)
  }
  const addImgFiles = files => {
    setImgFiles(p=>[...p,...files])
    setImgPreviews(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
  }
  const removeImgNew = i => {
    URL.revokeObjectURL(imgPreviews[i])
    setImgFiles(f=>f.filter((_,j)=>j!==i))
    setImgPreviews(p=>p.filter((_,j)=>j!==i))
  }
  const adjustBalance = async (type, method, amount) => {
    const { data: bal } = await supabase.from('balances').select('*').eq('id','main').single()
    if (!bal || !amount) return
    let bank = Number(bal.bank), cash = Number(bal.cash)
    if (type === 'Income') {
      if (method === 'โอน') bank += amount; else cash += amount
    } else {
      if (method === 'โอน') bank = Math.max(0, bank - amount); else cash = Math.max(0, cash - amount)
    }
    await supabase.from('balances').update({ bank, cash, updated_at: new Date().toISOString() }).eq('id','main')
  }

  const save = async () => {
    if (form.payment_method === 'แบ่งจ่าย') {
      if (!form.bank_amount && !form.cash_amount) return toast.error('กรุณาระบุยอดโอนหรือเงินสด')
    } else if (!form.amount) return toast.error('กรุณาระบุจำนวนเงิน')
    setSaving(true)
    try {
      const method  = form.payment_method || 'โอน'
      const isSplit = method === 'แบ่งจ่าย'
      const bankAmt = isSplit ? parseFloat(form.bank_amount||0) : 0
      const cashAmt = isSplit ? parseFloat(form.cash_amount||0) : 0
      const amount  = isSplit ? bankAmt + cashAmt : parseFloat(form.amount)
      const payload = { type:form.type, category:form.category, amount, note:form.note,
                        date:new Date(form.date).toISOString(), payment_method:method,
                        bank_amount: isSplit ? bankAmt : null,
                        cash_amount: isSplit ? cashAmt : null }
      if (editId) {
        for (const url of removedImgs) await deleteReceiptImage(supabase, url)
        let newUrls = []
        if (imgFiles.length) newUrls = await uploadReceiptImages(supabase, editId, imgFiles)
        const existing = txs.find(t=>t.id===editId)
        const kept = (existing?.images||[]).filter(u=>!removedImgs.includes(u))
        payload.images = [...kept, ...newUrls]
        if (form.bank_after !== '') payload.bank_after = parseFloat(form.bank_after)
        if (form.cash_after !== '') payload.cash_after = parseFloat(form.cash_after)
        await supabase.from('transactions').update(payload).eq('id',editId)
        if (form.category === 'Sale') {
          const tx = txs.find(t=>t.id===editId)
          if (tx?.product_id) await supabase.from('products').update({customer_note:form.customer_note?.trim()||null}).eq('id',tx.product_id)
        }
        toast.success('แก้ไขแล้ว')
      } else {
        const { data: balSnap } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
        let bank_after = Number(balSnap?.bank || 0)
        let cash_after = Number(balSnap?.cash || 0)
        if (isSplit) {
          if (form.type === 'Income') { bank_after += bankAmt; cash_after += cashAmt }
          else { bank_after = Math.max(0, bank_after - bankAmt); cash_after = Math.max(0, cash_after - cashAmt) }
        } else if (form.type === 'Income') {
          if (method === 'โอน') bank_after += amount; else cash_after += amount
        } else {
          if (method === 'โอน') bank_after = Math.max(0, bank_after - amount)
          else cash_after = Math.max(0, cash_after - amount)
        }
        const {data:newTx, error} = await supabase.from('transactions').insert(payload).select().single()
        if (error) throw error
        try { await supabase.from('transactions').update({ bank_after, cash_after }).eq('id', newTx.id) } catch(_) {}
        if (imgFiles.length) {
          const urls = await uploadReceiptImages(supabase, newTx.id, imgFiles)
          await supabase.from('transactions').update({images:urls}).eq('id',newTx.id)
        }
        await supabase.from('balances').update({ bank: bank_after, cash: cash_after, updated_at: new Date().toISOString() }).eq('id','main')
        toast.success('เพิ่มรายการแล้ว')
      }
      setShowForm(false); setEditId(null)
      setImgFiles([]); setImgPreviews([]); setRemovedImgs([])
      load()
    } catch(e){toast.error(e.message)}
    finally{setSaving(false)}
  }
  const del = async (tx, onConfirmed) => {
    const willRevertSale    = tx.category === 'Sale'      && tx.product_id
    const willDeleteProduct = tx.category === 'Buy Stock' && tx.product_id
    const msg = willDeleteProduct
      ? 'ย้อนกลับรายการนี้?\nสินค้าที่เชื่อมอยู่จะถูกลบออกจากสต็อก\n• ยอดเงินจะถูกคืนอัตโนมัติ'
      : willRevertSale
      ? 'ย้อนกลับรายการนี้?\n• สินค้าที่เชื่อมอยู่จะกลับเป็นพร้อมขาย\n• ยอดเงินจะถูกคืนอัตโนมัติ'
      : 'ย้อนกลับรายการนี้?\n• ยอดเงินจะถูกคืนอัตโนมัติ'
    if (!confirm(msg)) return
    onConfirmed?.()

    const snap = txs
    setTxs(prev => prev.filter(t => t.id !== tx.id))
    const label = tx.products?.model ? `${tx.category} — ${tx.products.model}` : (tx.note || tx.category)

    scheduleDelete({
      label,
      onUndo: () => setTxs(snap),
      onCommit: async () => {
        const revertBalance = async (type, method, amount, bAmt, cAmt) => {
          if (!method) return
          const { data: bal } = await supabase.from('balances').select('bank,cash').eq('id', 'main').single()
          if (!bal) return
          let upd = {}
          if (method === 'แบ่งจ่าย') {
            const b = Number(bAmt || 0), c = Number(cAmt || 0)
            if (type === 'Income') upd = { bank: Math.max(0, Number(bal.bank) - b), cash: Math.max(0, Number(bal.cash) - c) }
            else upd = { bank: Number(bal.bank) + b, cash: Number(bal.cash) + c }
          } else if (type === 'Income') {
            if (method === 'โอน') upd = { bank: Math.max(0, Number(bal.bank) - amount) }
            else upd = { cash: Math.max(0, Number(bal.cash) - amount) }
          } else {
            if (method === 'โอน') upd = { bank: Number(bal.bank) + amount }
            else upd = { cash: Number(bal.cash) + amount }
          }
          await supabase.from('balances').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', 'main')
        }

        if (willRevertSale) {
          await supabase.from('products').update({
            status: 'Available', sold_price: null, sold_date: null,
            payment_method: null, warranty_expiry: null,
          }).eq('id', tx.product_id)
          await revertBalance('Income', tx.payment_method, Number(tx.amount), tx.bank_amount, tx.cash_amount)
          await supabase.from('transactions').delete().eq('id', tx.id)
          load(); return
        }
        if (willDeleteProduct) {
          await revertBalance('Expense', tx.payment_method, Number(tx.amount), tx.bank_amount, tx.cash_amount)
          await supabase.from('transactions').delete().eq('product_id', tx.product_id)
          await deleteAllProductImages(supabase, tx.product_id)
          await supabase.from('products').delete().eq('id', tx.product_id)
          load(); return
        }
        await revertBalance(tx.type, tx.payment_method, Number(tx.amount), tx.bank_amount, tx.cash_amount)
        await supabase.from('transactions').delete().eq('id', tx.id)
        load()
      },
    })
  }

  const cancelTrade = async tx => {
    if (!confirm('ยกเลิกการแลกเปลี่ยนนี้?\n• สินค้า A จะกลับมาเป็นพร้อมขาย\n• สินค้า B จะถูกลบออกจากสต็อก')) return
    try {
      // หา product B จาก trade_ref_id ของ product A
      const { data: pA } = await supabase.from('products').select('trade_ref_id').eq('id', tx.product_id).single()
      const productBId = pA?.trade_ref_id

      // คืน product A → Available
      await supabase.from('products').update({
        status: 'Available', sold_price: null, sold_date: null,
        warranty_expiry: null, payment_method: null, trade_ref_id: null,
      }).eq('id', tx.product_id)

      // ลบ product B และ transactions ของ B
      if (productBId) {
        await supabase.from('transactions').delete().eq('product_id', productBId)
        await supabase.from('products').delete().eq('id', productBId)
      }

      // ลบ trade transaction
      await supabase.from('transactions').delete().eq('id', tx.id)

      // คืน balance
      const { data: bal } = await supabase.from('balances').select('*').eq('id','main').single()
      if (bal) {
        let bank = Number(bal.bank)
        let cash = Number(bal.cash)
        if (tx.type === 'Income') {
          if (tx.payment_method === 'โอน') bank -= Number(tx.amount)
          else cash -= Number(tx.amount)
        } else {
          if (tx.payment_method === 'โอน') bank += Number(tx.amount)
          else cash += Number(tx.amount)
        }
        await supabase.from('balances').update({ bank: Math.max(0, bank), cash: Math.max(0, cash), updated_at: new Date().toISOString() }).eq('id','main')
      }

      toast.success('ยกเลิกการแลกเปลี่ยนแล้ว'); load()
    } catch(e) { toast.error(e.message) }
  }

  return (
    <div>
      {/* Summary top */}
      <div className="finance-liquid-panel space-y-3">
        {/* รายรับ / รายจ่าย / กำไร */}
        <div className="flex gap-2">
          <button onClick={openIncomeDetail}
            className="finance-liquid-stat flex-1 rounded-xl p-2.5 text-center active:scale-95 transition-all">
            <p className="text-white/50 text-xs flex items-center justify-center gap-1">รายรับ <Eye size={12}/></p>
            <p className="font-bold text-sm mt-0.5 text-green-600">฿{fmt(income)}</p>
          </button>
          <button onClick={openExpenseDetail}
            className="finance-liquid-stat flex-1 rounded-xl p-2.5 text-center active:scale-95 transition-all">
            <p className="text-white/50 text-xs flex items-center justify-center gap-1">รายจ่าย <Eye size={12}/></p>
            <p className="font-bold text-sm mt-0.5 text-red-500">฿{fmt(expense)}</p>
          </button>
          <button onClick={openProfitDetail}
            className="finance-liquid-stat flex-1 rounded-xl p-2.5 text-center active:scale-95 transition-all">
            <p className="text-white/50 text-xs flex items-center justify-center gap-1">กำไรขาย <Eye size={12}/></p>
            <p className={`font-bold text-sm mt-0.5 ${summaryProfit>=0?'text-brand-yellow':'text-red-500'}`}>
              {summaryProfit<0?'-':''}฿{fmt(Math.abs(summaryProfit))}
            </p>
          </button>
        </div>

        {/* Modal รายรับ */}
        {showIncome && (() => {
          const items = txs.filter(t=>{
            if (t.type!=='Income') return false
            return txMatchesFilters(t, detailFrom, detailTo)
          })
          const total = items.reduce((a,t)=>a+Number(t.amount),0)
          return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setShowIncome(false)}>
              <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
                <div className="px-5 pt-5 pb-3 border-b border-amber-100">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-lg text-brand-dark">รายละเอียดรายรับ</h2>
                    <button onClick={()=>setShowIncome(false)} className="text-gray-400 p-1"><X size={18}/></button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <ThaiDatePicker value={detailFrom} onChange={setDetailFrom} mode="calendar" className="input flex-1 text-sm py-1.5"/>
                    <span className="text-gray-400">—</span>
                    <ThaiDatePicker value={detailTo} onChange={setDetailTo} mode="calendar" className="input flex-1 text-sm py-1.5"/>
                    {(detailFrom||detailTo) && <button onClick={()=>{setDetailFrom('');setDetailTo('')}} className="text-gray-400 p-1"><X size={16}/></button>}
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-xs text-gray-500">{items.length} รายการ</p>
                    <p className="font-bold text-green-600">รวม: +฿{fmt(total)}</p>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
                  {items.length===0 ? <div className="text-center py-10 text-gray-400">ไม่มีข้อมูล</div>
                  : items.map(t=>(
                    <div key={t.id} className="bg-green-50 rounded-xl px-4 py-3 flex justify-between items-start">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{t.category}</span>
                        {t.products?.model && <p className="text-sm font-semibold text-green-700 mt-1 truncate">{t.products.model}</p>}
                        {t.note && <p className="text-xs text-gray-400 truncate">{t.note}</p>}
                        <p className="text-xs text-gray-300 mt-0.5">{thDate(t.date)}</p>
                      </div>
                      <p className="font-bold text-green-600 ml-3 flex-shrink-0">+฿{fmt(t.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Modal รายจ่าย */}
        {showExpense && (() => {
          const items = txs.filter(t=>{
            if (t.type!=='Expense') return false
            return txMatchesFilters(t, detailFrom, detailTo)
          })
          const total = items.reduce((a,t)=>a+Number(t.amount),0)
          return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setShowExpense(false)}>
              <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
                <div className="px-5 pt-5 pb-3 border-b border-amber-100">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-lg text-brand-dark">รายละเอียดรายจ่าย</h2>
                    <button onClick={()=>setShowExpense(false)} className="text-gray-400 p-1"><X size={18}/></button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <ThaiDatePicker value={detailFrom} onChange={setDetailFrom} mode="calendar" className="input flex-1 text-sm py-1.5"/>
                    <span className="text-gray-400">—</span>
                    <ThaiDatePicker value={detailTo} onChange={setDetailTo} mode="calendar" className="input flex-1 text-sm py-1.5"/>
                    {(detailFrom||detailTo) && <button onClick={()=>{setDetailFrom('');setDetailTo('')}} className="text-gray-400 p-1"><X size={16}/></button>}
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-xs text-gray-500">{items.length} รายการ</p>
                    <p className="font-bold text-red-500">รวม: -฿{fmt(total)}</p>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
                  {items.length===0 ? <div className="text-center py-10 text-gray-400">ไม่มีข้อมูล</div>
                  : items.map(t=>(
                    <div key={t.id} className="bg-red-50 rounded-xl px-4 py-3 flex justify-between items-start">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{t.category}</span>
                        {t.products?.model && <p className="text-sm font-semibold text-red-600 mt-1 truncate">{t.products.model}</p>}
                        {t.note && <p className="text-xs text-gray-400 truncate">{t.note}</p>}
                        <p className="text-xs text-gray-300 mt-0.5">{thDate(t.date)}</p>
                      </div>
                      <p className="font-bold text-red-500 ml-3 flex-shrink-0">-฿{fmt(t.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Profit Detail Modal */}
        {showProfit && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setShowProfit(false)}>
            <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
              <div className="px-5 pt-5 pb-3 border-b border-amber-100">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-lg text-brand-dark">รายละเอียดกำไรขาย</h2>
                  <button onClick={()=>setShowProfit(false)} className="text-gray-400 p-1"><X size={18}/></button>
                </div>
                {/* date filter */}
                <div className="flex gap-2 items-center">
                  <ThaiDatePicker value={profitFrom} onChange={setProfitFrom} mode="calendar" className="input flex-1 text-sm py-1.5" placeholder="จากวันที่"/>
                  <span className="text-gray-400 text-sm">—</span>
                  <ThaiDatePicker value={profitTo} onChange={setProfitTo} mode="calendar" className="input flex-1 text-sm py-1.5" placeholder="ถึงวันที่"/>
                  {(profitFrom||profitTo) && (
                    <button onClick={()=>{setProfitFrom('');setProfitTo('')}} className="text-gray-400 p-1"><X size={16}/></button>
                  )}
                </div>
                <div className="mt-2 space-y-0.5">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-500">{filteredSoldItems.length} รายการขาย</p>
                    <p className="text-sm font-semibold text-green-600">+฿{fmt(filteredGross)}</p>
                  </div>
                  {filteredDeductions.map(d => (
                    <div key={d.cat} className="flex justify-between items-center">
                      <p className="text-xs text-orange-500 flex items-center gap-1"><Send size={12}/>{d.cat}</p>
                      <p className="text-sm font-semibold text-orange-500">-฿{fmt(d.amount)}</p>
                    </div>
                  ))}
                  <div className="flex justify-between items-center border-t border-amber-100 pt-1 mt-1">
                    <p className="text-xs font-semibold text-gray-600">กำไรสุทธิ</p>
                    <p className={`font-bold text-base ${filteredProfit>=0?'text-green-600':'text-red-500'}`}>
                      {filteredProfit>=0?'+':''}฿{fmt(filteredProfit)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
                {filteredSoldItems.length===0
                  ? <div className="flex flex-col items-center py-10 text-gray-400"><BarChart3 size={42} strokeWidth={1.7} className="mb-2"/>ไม่มีข้อมูลในช่วงนี้</div>
                  : filteredSoldItems
                      .sort((a,b)=>new Date(b.sold_date)-new Date(a.sold_date))
                      .map(p=>{
                        const profit = Number(p.sold_price)-Number(p.total_cost)
                        return (
                          <div key={p.id} className="bg-amber-50 rounded-xl px-4 py-3 flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm text-brand-dark truncate">{p.model}</p>
                              <p className="text-xs text-gray-400">SN: {p.serial_number}</p>
                              <p className="text-xs text-gray-400 mt-0.5 flex items-center flex-wrap gap-1">
                                {p.sold_date ? thDateShort(p.sold_date) : ''}
                                {p.is_trade_in && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-600">Trade</span>}
                                {p.payment_method && <span className={"px-1.5 py-0.5 rounded text-xs font-medium "+(p.payment_method==='โอน'?'bg-blue-100 text-blue-600':'bg-green-100 text-green-600')}>{p.payment_method}</span>}
                              </p>
                              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                                <span>ขาย ฿{fmt(p.sold_price)}</span>
                                <span>ต้นทุน ฿{fmt(p.total_cost)}</span>
                              </div>
                            </div>
                            <div className="ml-3 flex-shrink-0 text-right">
                              <p className={`font-bold text-base ${profit>=0?'text-green-600':'text-red-500'}`}>
                                {profit>=0?'+':''}฿{fmt(profit)}
                              </p>
                            </div>
                          </div>
                        )
                      })
                }
              </div>
            </div>
          </div>
        )}

        {/* ยอดเงินคงเหลือ + เงินสด + มูลค่ารวม */}
        <div className="finance-liquid-balance rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="finance-liquid-label text-xs font-medium">ยอดเงินคงเหลือ</span>
            <button onClick={()=>{setBalForm({bank:balance.bank,cash:balance.cash});setEditBal(!editBal)}}
              className="text-brand-yellow text-xs flex items-center gap-1"><Edit2 size={12}/>แก้ไข</button>
          </div>
          {editBal ? (
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <span className="finance-liquid-label text-xs w-16">ยอดโอน</span>
                <input autoComplete="off" className="input flex-1 text-sm py-1.5" type="number" placeholder="0" value={balForm.bank} onChange={e=>setBalForm({...balForm,bank:e.target.value})}/>
              </div>
              <div className="flex gap-2 items-center">
                <span className="finance-liquid-label text-xs w-16">เงินสด</span>
                <input autoComplete="off" className="input flex-1 text-sm py-1.5" type="number" placeholder="0" value={balForm.cash} onChange={e=>setBalForm({...balForm,cash:e.target.value})}/>
              </div>
              <div className="flex gap-2">
                <button onClick={saveBalance} className="btn-primary flex-1 py-1.5 text-sm"><Check size={13} className="inline mr-1"/>บันทึก</button>
                <button onClick={()=>setEditBal(false)} className="btn-ghost px-3 text-sm">ยกเลิก</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="finance-liquid-label text-xs flex items-center justify-center gap-1"><CreditCard size={12}/>ยอดโอน</p>
                <p className="text-blue-600 font-bold text-sm">฿{fmt(balance.bank)}</p>
              </div>
              <div className="text-center">
                <p className="finance-liquid-label text-xs flex items-center justify-center gap-1"><Banknote size={12}/>เงินสด</p>
                <p className="text-green-600 font-bold text-sm">฿{fmt(balance.cash)}</p>
              </div>
              <div className="text-center">
                <p className="finance-liquid-label text-xs flex items-center justify-center gap-1"><Package size={12}/>สต็อก</p>
                <p className="text-amber-600 font-bold text-sm">฿{fmt(stockValue)}</p>
              </div>
            </div>
          )}
          {!editBal && (
            <div className="border-t border-white/30 pt-2 flex justify-between items-center">
              <span className="finance-liquid-label text-xs">มูลค่ารวมทั้งหมด</span>
              <span className="text-brand-yellow font-bold">฿{fmt(totalWealth)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Date filter + Filter button */}
      <div className="px-4 py-3 border-b border-amber-100 bg-white">
        <div className="grid grid-cols-3 gap-2 mb-2">
          <button onClick={()=>setDateRange(monthRange(0))}
            className={datePresetClass(isDateRange(monthRange(0)))}>
            เดือนนี้
          </button>
          <button onClick={()=>setDateRange(monthRange(-1))}
            className={datePresetClass(isDateRange(monthRange(-1)))}>
            เดือนที่แล้ว
          </button>
          <button onClick={()=>setDateRange(yearRange())}
            className={datePresetClass(isDateRange(yearRange()))}>
            ทั้งปี
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <ThaiDatePicker value={dateFrom} onChange={setDateFrom} mode="calendar" className="input flex-1 text-sm py-1.5"/>
          <span className="text-gray-400 text-sm">—</span>
          <ThaiDatePicker value={dateTo} onChange={setDateTo} mode="calendar" className="input flex-1 text-sm py-1.5"/>
          {(dateFrom||dateTo) && (
            <button onClick={()=>{setDateFrom('');setDateTo('')}} className="text-gray-400 p-1"><X size={15}/></button>
          )}
          <button onClick={()=>setShowFilter(f=>!f)}
            className={`relative flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm font-medium transition-all flex-shrink-0
              ${showFilter||activeFilters>0 ? 'bg-brand-dark text-brand-yellow border-brand-dark' : 'bg-white text-gray-500 border-gray-200'}`}>
            <SlidersHorizontal size={14}/>
            {activeFilters>0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-brand-red text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mt-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
          <input
            autoComplete="off"
            className="input w-full pl-8 pr-8 text-sm py-1.5"
            placeholder="ค้นหา รุ่น / หมวดหมู่ / หมายเหตุ / ราคา..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14}/>
            </button>
          )}
        </div>

        {/* Filter panel */}
        {showFilter && (
          <div className="mt-3 space-y-3">
            {/* ประเภท Income/Expense */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">ประเภทรายการ</p>
              <div className="flex gap-2">
                {TX_TYPES.map(t=>{
                  const active = selTypes.includes(t)
                  return (
                    <button key={t} onClick={()=>toggle(selTypes,setSelTypes,t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                        ${active
                          ? t==='Income' ? 'bg-green-600 text-white border-green-600' : 'bg-brand-red text-white border-brand-red'
                          : 'bg-white text-gray-500 border-gray-200'}`}>
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${active?'bg-white/30 border-white':'border-gray-300'}`}>
                        {active && <Check size={10} strokeWidth={3}/>}
                      </span>
                      {t==='Income'?'รายรับ':'รายจ่าย'}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* หมวดหมู่ */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">หมวดหมู่</p>
              <div className="flex flex-wrap gap-1.5">
                {CATS.map(c=>{
                  const active = selCats.includes(c)
                  return (
                    <button key={c} onClick={()=>toggle(selCats,setSelCats,c)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                        ${active ? 'bg-brand-dark text-brand-yellow border-brand-dark' : 'bg-white text-gray-500 border-gray-200'}`}>
                      <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${active?'bg-brand-yellow/30 border-brand-yellow':'border-gray-300'}`}>
                        {active && <Check size={8} strokeWidth={3} className="text-brand-yellow"/>}
                      </span>
                      {c}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ประเภทสินค้า */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">ประเภทสินค้า</p>
              <div className="flex flex-wrap gap-1.5">
                {PROD_CATS.map(c=>{
                  const active = selProdCats.includes(c)
                  return (
                    <button key={c} onClick={()=>toggle(selProdCats,setSelProdCats,c)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                        ${active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-500 border-gray-200'}`}>
                      <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${active?'bg-white/30 border-white':'border-gray-300'}`}>
                        {active && <Check size={8} strokeWidth={3}/>}
                      </span>
                      {c}
                    </button>
                  )
                })}
              </div>
            </div>

            {activeFilters>0 && (
              <button onClick={clearFilters} className="text-xs text-brand-red font-medium flex items-center gap-1">
                <X size={12}/>ล้าง filter ทั้งหมด ({activeFilters})
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-3 flex justify-between items-center border-b border-amber-100">
        <p className="text-sm text-gray-500">{searched.length} รายการ</p>
        <button onClick={openAdd} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1">
          <Plus size={15}/>เพิ่มรายการ
        </button>
      </div>

      <section className="finance-chart-panel">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-brand-dark">กราฟรายการบัญชี</p>
            <p className="text-xs text-gray-500 truncate">{filtered.length} รายการตามช่วงที่เลือก</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold flex-shrink-0">
            <span className="inline-flex items-center gap-1 text-green-700"><span className="w-2 h-2 rounded-full bg-green-500"/>รายรับ</span>
            <span className="inline-flex items-center gap-1 text-red-600"><span className="w-2 h-2 rounded-full bg-red-400"/>รายจ่าย</span>
          </div>
        </div>
        {chartRows.length === 0 ? (
          <div className="flex flex-col items-center py-5 text-gray-400">
            <BarChart3 size={34} strokeWidth={1.7} className="mb-1.5"/>
            <p className="text-xs">ไม่มีข้อมูลสำหรับกราฟในช่วงนี้</p>
          </div>
        ) : (
          <div className="space-y-3">
            {chartRows.map(row => {
              const incomePct = row.income / chartMax * 100
              const expensePct = row.expense / chartMax * 100
              return (
                <div key={row.category} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-brand-dark truncate">{row.category}</p>
                      <p className="text-[11px] text-gray-500">{row.count} รายการ · สุทธิ {row.net >= 0 ? '+' : '-'}฿{fmt(Math.abs(row.net))}</p>
                    </div>
                    <p className="text-xs font-bold text-brand-dark flex-shrink-0">฿{fmt(row.total)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="finance-chart-track">
                      {row.income > 0 && (
                        <div className="finance-chart-fill bg-green-400" style={{ width: `${incomePct}%` }}/>
                      )}
                    </div>
                    <div className="finance-chart-track">
                      {row.expense > 0 && (
                        <div className="finance-chart-fill bg-red-300" style={{ width: `${expensePct}%` }}/>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] font-semibold">
                    <span className="text-green-700">+฿{fmt(row.income)}</span>
                    <span className="text-red-600">-฿{fmt(row.expense)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Form */}
      {showForm && (
        <div className="mx-4 my-3 card space-y-3">
          <h3 className="font-semibold text-sm">{editId?'แก้ไขรายการ':'รายการใหม่'}</h3>
          <div className="flex gap-2">
            {['Income','Expense'].map(t=>(
              <button key={t} onClick={()=>setForm({...form,type:t})}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                  ${form.type===t?(t==='Income'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red'):'bg-white text-gray-400 border-gray-200'}`}>
                {t==='Income'?'รายรับ':'รายจ่าย'}
              </button>
            ))}
          </div>
          {editId && form.category === 'Trade'
            ? <div className="input text-sm bg-gray-50 text-gray-400 flex items-center gap-2"><Repeat2 size={14}/>Trade (ไม่สามารถเปลี่ยนได้)</div>
            : <select className="input text-sm" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
                {CATS.map(c=><option key={c}>{c}</option>)}
              </select>
          }
          {/* ช่องทางการชำระ */}
          <div>
            <p className="text-xs text-gray-500 mb-1">ช่องทาง</p>
            <div className="flex gap-2">
              {['โอน','เงินสด','แบ่งจ่าย'].map(m=>(
                <button key={m} onClick={()=>setForm({...form,payment_method:m,bank_amount:'',cash_amount:''})}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                    ${form.payment_method===m
                      ? m==='โอน' ? 'bg-blue-500 text-white border-blue-500'
                        : m==='เงินสด' ? 'bg-green-600 text-white border-green-600'
                        : 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-400 border-gray-200'}`}>
                  <span className="inline-flex items-center justify-center gap-1">
                    {m==='โอน' ? <CreditCard size={14}/> : m==='เงินสด' ? <Banknote size={14}/> : <Scissors size={14}/>}
                    {m==='โอน'?'โอน':m==='เงินสด'?'สด':'แบ่ง'}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {form.payment_method === 'แบ่งจ่าย' ? (
            <div className="flex gap-2">
              <input autoComplete="off" className="input flex-1 text-sm" type="number" placeholder="ยอดโอน" value={form.bank_amount} onChange={e=>setForm({...form,bank_amount:e.target.value})}/>
              <input autoComplete="off" className="input flex-1 text-sm" type="number" placeholder="เงินสด" value={form.cash_amount} onChange={e=>setForm({...form,cash_amount:e.target.value})}/>
            </div>
          ) : (
            <input autoComplete="off" className="input text-sm" type="number" placeholder="จำนวนเงิน (บาท)" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/>
          )}
          {editId && (
            <div>
              <p className="text-xs text-gray-500 mb-1">ยอดคงเหลือหลังรายการ</p>
              <div className="flex gap-2">
                <input autoComplete="off" className="input flex-1 text-sm" type="number" placeholder="ยอดโอน" value={form.bank_after} onChange={e=>setForm({...form,bank_after:e.target.value})}/>
                <input autoComplete="off" className="input flex-1 text-sm" type="number" placeholder="เงินสด" value={form.cash_after} onChange={e=>setForm({...form,cash_after:e.target.value})}/>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลา</label>
            <ThaiDatePicker value={form.date} onChange={v=>setForm({...form,date:v})} showTime className="input text-sm w-full"/>
          </div>
          <input autoComplete="off" className="input text-sm" placeholder="หมายเหตุ" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/>
          {editId && form.category==='Sale' && (form.customer_note||'').trim() !== (form.note||'').trim() && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">รายละเอียดลูกค้า</label>
              <textarea className="input text-sm resize-none" rows={2} placeholder="ชื่อ / เบอร์โทร / หมายเหตุลูกค้า..."
                value={form.customer_note||''} onChange={e=>setForm({...form,customer_note:e.target.value})}/>
            </div>
          )}

          {/* รูปใบเสร็จ */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">รูปใบเสร็จ / หลักฐาน</label>
            <div className="flex gap-2 flex-wrap">
              {/* รูปเดิม (กรณี edit) */}
              {editId && txs.find(t=>t.id===editId)?.images?.filter(u=>!removedImgs.includes(u)).map((url,i)=>(
                <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-amber-200 flex-shrink-0">
                  <img src={url} className="w-full h-full object-cover"/>
                  <button onClick={()=>setRemovedImgs(r=>[...r,url])}
                    className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <X size={10} className="text-white"/>
                  </button>
                </div>
              ))}
              {/* รูปใหม่ */}
              {imgPreviews.map((src,i)=>(
                <div key={'np'+i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-green-300 flex-shrink-0">
                  <img src={src} className="w-full h-full object-cover"/>
                  <button onClick={()=>removeImgNew(i)}
                    className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <X size={10} className="text-white"/>
                  </button>
                </div>
              ))}
              <label className="w-16 h-16 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
                <ImagePlus size={16} className="text-amber-400"/>
                <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
                <input autoComplete="off" type="file" multiple accept="image/*" className="hidden" onChange={e=>addImgFiles(Array.from(e.target.files))}/>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-1">
              <Check size={14}/>{saving?'...':(editId?'บันทึก':'เพิ่ม')}
            </button>
            <button onClick={()=>{setShowForm(false);setEditId(null);setImgFiles([]);setImgPreviews([]);setRemovedImgs([])}} className="btn-ghost px-4"><X size={14}/></button>
          </div>
        </div>
      )}

      {/* List */}
      {loading
        ? <div className="flex justify-center pt-12"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
        : <div className="px-4 pb-4 space-y-2 mt-2">
            {searched.length===0 && <div className="flex flex-col items-center pt-16 text-gray-400"><Banknote size={44} strokeWidth={1.7} className="mb-3"/>ไม่มีรายการในช่วงนี้</div>}
            {searched.map(tx=>{
              const profit = tx.category==='Sale' && tx.products?.total_cost!=null
                ? Number(tx.amount)-Number(tx.products.total_cost) : null
              const warrantyDays = tx.category==='Sale' && tx.products?.warranty_expiry
                ? Math.ceil((new Date(tx.products.warranty_expiry)-new Date())/86400000) : null
              const isTrade = tx.category === 'Trade'
              const thumb = tx.images?.[0]
              const imageCount = tx.images?.length || 0
              const thumbNode = (
                <div
                  className={`finance-tx-thumb relative flex-shrink-0 ${thumb ? '' : 'finance-tx-thumb-placeholder flex items-center justify-center'}`}
                  onClick={e=>{
                    if (!thumb) return
                    e.stopPropagation()
                    setLightbox({imgs:tx.images,idx:0})
                  }}>
                  {thumb
                    ? <img src={thumb} alt="" />
                    : <ImageIcon size={22} strokeWidth={1.8}/>}
                  {imageCount > 1 && <span className="finance-tx-count">{imageCount}</span>}
                </div>
              )

              // Trade transaction — แสดงแบบพิเศษสีน้ำเงิน
              if (isTrade) {
                return (
                  <button key={tx.id} {...tap(()=>setTxDetail(tx))}
                    className={`finance-tx-card w-full text-left rounded-2xl p-3 flex items-center gap-3 active:opacity-70 transition-opacity touch-manipulation ${txCardClass(tx)}`}>
                    {thumbNode}
                    <div className="finance-tx-content">
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200 flex-shrink-0 inline-flex items-center gap-1"><Repeat2 size={12}/>Trade</span>
                        <div className="text-right flex-shrink-0">
                          {tx.trade_sell_a && <p className="text-xs finance-tx-meta">ขาย ฿{fmt(tx.trade_sell_a)}</p>}
                          {tx.trade_profit_a != null && (
                            <p className={`text-xs font-semibold tx-amount ${Number(tx.trade_profit_a)>=0?'text-green-600':'text-red-500'}`}>
                              กำไร {Number(tx.trade_profit_a)>=0?'+':''}฿{fmt(tx.trade_profit_a)}
                            </p>
                          )}
                        </div>
                      </div>
                      {tx.products?.model && (
                        <p className="text-sm font-semibold tx-title finance-tx-line">{tx.products.model}</p>
                      )}
                      {tx.note && (
                        <div className="space-y-0.5">
                          {tx.note.split(' | ').map((line,i)=>(
                            <p key={i} className="text-xs finance-tx-meta finance-tx-line">{line}</p>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 finance-tx-meta">
                        <p className="text-xs finance-tx-line">{thDate(tx.date)}</p>
                        {stockMap[tx.id] != null && (
                          <span className="text-xs font-medium inline-flex items-center gap-1 flex-shrink-0"><Package size={12}/>฿{fmt(stockMap[tx.id])}</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              }

              return (
              <button key={tx.id} {...tap(()=>setTxDetail(tx))}
                className={`finance-tx-card card w-full text-left flex items-center gap-3 active:opacity-70 transition-opacity touch-manipulation ${txCardClass(tx)}`}>
                {thumbNode}
                <div className="finance-tx-content">
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex flex-wrap gap-1 flex-1 min-w-0 max-h-6 overflow-hidden">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${catColor(tx.category)}`}>{tx.category}</span>
                      {tx.payment_method === 'แบ่งจ่าย' && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 bg-purple-100 text-purple-700 inline-flex items-center gap-1">
                          <Scissors size={12}/> แบ่งจ่าย {tx.bank_amount?`โอน ${fmt(tx.bank_amount)}`:''}
                          {tx.bank_amount&&tx.cash_amount?'+':''}
                          {tx.cash_amount?`สด ${fmt(tx.cash_amount)}`:''}
                        </span>
                      )}
                      {tx.category==='Sale' && tx.products?.payment_method && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${tx.products.payment_method==='โอน'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'}`}>
                          ชำระ: {tx.products.payment_method}
                        </span>
                      )}
                      {tx.category==='Sale' && warrantyDays!==null && (
                        warrantyDays>=0
                          ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0 inline-flex items-center gap-1"><Shield size={12}/>ประกันเหลือ {warrantyDays} วัน</span>
                          : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex-shrink-0 inline-flex items-center gap-1"><Shield size={12}/>หมดประกัน</span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold tx-amount ${tx.type==='Income'?'text-green-600':'text-brand-red'}`}>
                        {tx.type==='Income'?'+':'-'}฿{fmt(tx.amount)}
                      </p>
                      {profit!==null && (
                        <p className={`text-xs font-medium tx-amount ${profit>=0?'text-green-500':'text-red-500'}`}>
                          <span className="inline-flex items-center justify-end gap-1">{profit>=0?<TrendingUp size={12}/>:<TrendingDown size={12}/>}฿{fmt(Math.abs(profit))}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  {tx.products?.model && (
                    <p className={`text-sm font-semibold finance-tx-line tx-title ${tx.type==='Income'?'text-green-700':'text-red-600'}`}>
                      {tx.products.model}{tx.products.category?` (${tx.products.category})`:''}
                    </p>
                  )}
                  {tx.note && <p className="text-xs finance-tx-meta finance-tx-line">{tx.note}</p>}
                  {tx.category==='Sale' && tx.products?.customer_note && tx.products.customer_note !== tx.note && (
                    <p className="text-xs finance-tx-meta finance-tx-line flex items-center gap-1"><User size={12}/>{tx.products.customer_note}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 finance-tx-meta">
                    <p className="text-xs finance-tx-line">{thDate(tx.date)}</p>
                    {balMap[tx.id] && (
                      <div className="flex gap-x-2 flex-shrink-0">
                        <span className="text-xs font-medium inline-flex items-center gap-1"><CreditCard size={12}/>฿{fmt(balMap[tx.id].bank)}</span>
                        <span className="text-xs font-medium inline-flex items-center gap-1"><Banknote size={12}/>฿{fmt(balMap[tx.id].cash)}</span>
                      </div>
                    )}
                  </div>
                  {balMap[tx.id] && stockMap[tx.id] != null && (
                    <div className="finance-tx-meta">
                      {stockMap[tx.id] != null && (
                        <span className="text-xs font-medium inline-flex items-center gap-1"><Package size={12}/>฿{fmt(stockMap[tx.id])}</span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            )})}
          </div>
      }

      {/* Transaction Detail Sheet */}
      {txDetail && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{background:'rgba(0,0,0,0.5)'}}
          onPointerDown={e=>{if(e.target===e.currentTarget)setTxDetail(null)}}>
          <div className="bg-white dark:bg-[#1A1208] rounded-t-2xl w-full max-w-[430px] mx-auto max-h-[85vh] flex flex-col">

            {/* header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-amber-100 dark:border-white/10 flex-shrink-0">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${catColor(txDetail.category)}`}>
                {txDetail.category === 'Trade' ? <span className="inline-flex items-center gap-1"><Repeat2 size={12}/>Trade</span> : txDetail.category}
              </span>
              <p className={`text-lg font-bold ${txDetail.type==='Income'?'text-green-600':'text-brand-red'}`}>
                {txDetail.type==='Income'?'+':'-'}฿{fmt(txDetail.amount)}
              </p>
              <button onClick={()=>setTxDetail(null)} className="text-gray-400 p-1"><X size={18}/></button>
            </div>

            {/* body */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {txDetail.products?.model && (
                <div>
                  <p className="text-xs text-gray-400">สินค้า</p>
                  <p className="font-semibold text-brand-dark dark:text-white">
                    {txDetail.products.model}{txDetail.products.category ? ` (${txDetail.products.category})` : ''}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400">วันที่</p>
                  <p className="text-sm font-medium dark:text-white">{thDate(txDetail.date)}</p>
                </div>
                {txDetail.payment_method && (
                  <div>
                    <p className="text-xs text-gray-400">ช่องทางชำระ</p>
                    {txDetail.payment_method === 'แบ่งจ่าย' ? (
                      <div className="flex gap-3 mt-0.5">
                        {txDetail.bank_amount ? <span className="text-sm font-medium text-blue-600 inline-flex items-center gap-1"><CreditCard size={14}/>฿{fmt(txDetail.bank_amount)}</span> : null}
                        {txDetail.cash_amount ? <span className="text-sm font-medium text-green-600 inline-flex items-center gap-1"><Banknote size={14}/>฿{fmt(txDetail.cash_amount)}</span> : null}
                      </div>
                    ) : (
                      <p className="text-sm font-medium dark:text-white">{txDetail.payment_method}</p>
                    )}
                  </div>
                )}
              </div>
              {txDetail.note && (
                <div>
                  <p className="text-xs text-gray-400">หมายเหตุ</p>
                  <p className="text-sm whitespace-pre-wrap dark:text-white">{txDetail.note}</p>
                </div>
              )}
              {txDetail.category==='Sale' && txDetail.products?.customer_note && txDetail.products.customer_note !== txDetail.note && (
                <div className="bg-blue-50 rounded-xl px-3 py-2">
                  <p className="text-xs text-blue-400 mb-0.5 flex items-center gap-1"><User size={12}/>รายละเอียดลูกค้า</p>
                  <p className="text-sm text-blue-700">{txDetail.products.customer_note}</p>
                </div>
              )}
              {balMap[txDetail?.id] && (
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-gray-400 mb-1.5">ยอดคงเหลือหลังรายการ</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-blue-400 flex items-center gap-1"><CreditCard size={12}/>ธนาคาร</p>
                      <p className="font-semibold text-sm text-blue-600">฿{fmt(balMap[txDetail.id].bank)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-green-500 flex items-center gap-1"><Banknote size={12}/>เงินสด</p>
                      <p className="font-semibold text-sm text-green-600">฿{fmt(balMap[txDetail.id].cash)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-amber-500 flex items-center gap-1"><Package size={12}/>สต๊อก</p>
                      <p className="font-semibold text-sm text-amber-600">฿{fmt(stockMap[txDetail.id])}</p>
                    </div>
                  </div>
                </div>
              )}
              {txDetail.images?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">รูปใบเสร็จ</p>
                  <div className="flex gap-2 flex-wrap">
                    {txDetail.images.map((url,i)=>(
                      <img key={i} src={url}
                        className="w-20 h-20 rounded-xl object-cover cursor-zoom-in border border-amber-100"
                        onClick={()=>setLightbox({imgs:txDetail.images,idx:i})}/>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* actions */}
            <div className="px-5 pb-6 pt-3 border-t border-amber-100 dark:border-white/10 flex gap-3 flex-shrink-0">
              <button
                onClick={()=>{openEdit(txDetail);setTxDetail(null)}}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:border-brand-dark hover:text-brand-dark transition-colors">
                <Edit2 size={15}/>แก้ไข
              </button>
              {txDetail.category === 'Trade'
                ? <button
                    onClick={()=>{cancelTrade(txDetail);setTxDetail(null)}}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-blue-200 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors">
                    <X size={15}/>ยกเลิก Trade
                  </button>
                : <button
                    onClick={()=>del(txDetail, ()=>setTxDetail(null))}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors">
                    <RotateCcw size={15}/>ย้อนกลับรายการ
                  </button>
              }
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/92 z-[60] flex items-center justify-center p-4"
          onClick={()=>setLightbox(null)}>
          <button className="absolute top-4 right-4 bg-black/50 rounded-full p-2 text-white z-10">
            <X size={20}/>
          </button>
          {lightbox.imgs.length > 1 && <>
            <button
              onClick={e=>{e.stopPropagation();setLightbox(l=>({...l,idx:(l.idx-1+l.imgs.length)%l.imgs.length}))}}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 rounded-full w-10 h-10 flex items-center justify-center text-white text-2xl z-10">‹</button>
            <button
              onClick={e=>{e.stopPropagation();setLightbox(l=>({...l,idx:(l.idx+1)%l.imgs.length}))}}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 rounded-full w-10 h-10 flex items-center justify-center text-white text-2xl z-10">›</button>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-sm">
              {lightbox.idx+1} / {lightbox.imgs.length}
            </div>
          </>}
          <img src={lightbox.imgs[lightbox.idx]}
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={e=>e.stopPropagation()}/>
        </div>
      )}
    </div>
  )
}
