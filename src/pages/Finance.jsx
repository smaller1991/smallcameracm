import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Edit2, X, Check, ImagePlus, SlidersHorizontal, Search } from 'lucide-react'
import { uploadReceiptImages, deleteReceiptImage, deleteAllProductImages } from '../lib/imageUtils'
import { thDate, thDateShort, toLocal, nowLocal } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import toast from 'react-hot-toast'

const CATS = ['Buy Stock','Add-on','Sale','Rent','Marketing','Operating','Shipping','Other']
const PROD_CATS = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const TX_TYPES  = ['Income','Expense']
const fmt  = n => Number(n||0).toLocaleString('th-TH')

const CAT_COLOR = {
  'Sale':      'bg-green-100 text-green-700 border-green-200',
  'Buy Stock': 'bg-red-100 text-red-700 border-red-200',
  'Add-on':    'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Trade':     'bg-blue-100 text-blue-700 border-blue-200',
  'Shipping':  'bg-orange-100 text-orange-700 border-orange-200',
}
const catColor = cat => CAT_COLOR[cat] || 'bg-gray-100 text-gray-600 border-gray-200'
const TX_BAR   = { 'Sale':'bg-green-400', 'Buy Stock':'bg-red-400', 'Add-on':'bg-yellow-400', 'Trade':'bg-blue-400', 'Shipping':'bg-orange-400' }
const txBar    = cat => TX_BAR[cat] || 'bg-gray-300'

export default function Finance() {
  const [txs,      setTxs]      = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState({type:'Expense',category:'Operating',amount:'',note:'',date:nowLocal()})
  const [saving,   setSaving]   = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
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

  const [stockValue,   setStockValue]   = useState(0)
  const [soldProfit,   setSoldProfit]   = useState(0)
  const [soldItems,    setSoldItems]    = useState([])
  const [showProfit,   setShowProfit]   = useState(false)
  const [profitFrom,   setProfitFrom]   = useState('')
  const [profitTo,     setProfitTo]     = useState('')
  const [showIncome,   setShowIncome]   = useState(false)
  const [showExpense,  setShowExpense]  = useState(false)
  const [detailFrom,   setDetailFrom]   = useState('')
  const [detailTo,     setDetailTo]     = useState('')

  const load = async () => {
    const [{data:txData},{data:bal},{data:products}] = await Promise.all([
      supabase.from('transactions').select('*,products(model,category,total_cost,warranty_expiry,payment_method,customer_note)').order('date',{ascending:false}),
      supabase.from('balances').select('*').eq('id','main').single(),
      supabase.from('products').select('id,model,serial_number,category,total_cost,sold_price,sold_date,payment_method,is_trade_in').eq('status','Sold'),
    ])
    setTxs(txData||[])
    if (bal) setBalance({bank:Number(bal.bank),cash:Number(bal.cash)})

    // กำไรจากการขาย = sold_price - total_cost (รวมทั้ง Sale และ Trade) หักค่า Shipping
    const sold = (products||[]).filter(p=>p.sold_price)
    setSoldItems(sold)
    const sp       = sold.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)
    const shipping = (txData||[]).filter(t=>t.category==='Shipping'&&t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)
    setSoldProfit(sp - shipping)

    const {data:allProducts} = await supabase.from('products').select('total_cost,status')
    const sv = (allProducts||[]).filter(p=>p.status!=='Sold').reduce((a,p)=>a+Number(p.total_cost),0)
    setStockValue(sv)
    setLoading(false)
  }
  useEffect(()=>{load()},[])

  // filter by date
  const filtered = txs.filter(t => {
    if (dateFrom && new Date(t.date)<new Date(dateFrom)) return false
    if (dateTo   && new Date(t.date)>new Date(dateTo+'T23:59:59')) return false
    if (selTypes.length>0 && !selTypes.includes(t.type)) return false
    if (selCats.length>0  && !selCats.includes(t.category)) return false
    if (selProdCats.length>0) {
      if (!t.products?.category || !selProdCats.includes(t.products.category)) return false
    }
    return true
  })

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

  const toggle = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(x=>x!==val) : [...prev, val])
  }

  // sold items filtered by profit date range
  const filteredSoldItems = soldItems.filter(p => {
    if (!p.sold_date) return false
    if (profitFrom && new Date(p.sold_date)<new Date(profitFrom)) return false
    if (profitTo   && new Date(p.sold_date)>new Date(profitTo+'T23:59:59')) return false
    return true
  })
  const filteredGross    = filteredSoldItems.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)
  const filteredShipping = txs.filter(t => {
    if (t.category !== 'Shipping' || t.type !== 'Expense') return false
    if (profitFrom && new Date(t.date)<new Date(profitFrom)) return false
    if (profitTo   && new Date(t.date)>new Date(profitTo+'T23:59:59')) return false
    return true
  }).reduce((a,t)=>a+Number(t.amount),0)
  const filteredProfit = filteredGross - filteredShipping

  const income      = filtered.filter(t=>t.type==='Income').reduce((a,t)=>a+Number(t.amount),0)
  const expense     = filtered.filter(t=>t.type==='Expense').reduce((a,t)=>a+Number(t.amount),0)
  const totalWealth = balance.bank + balance.cash + stockValue

  const saveBalance = async () => {
    const bank = parseFloat(balForm.bank)
    const cash = parseFloat(balForm.cash)
    if (isNaN(bank)||isNaN(cash)) return toast.error('กรุณากรอกตัวเลข')
    await supabase.from('balances').update({bank,cash,updated_at:new Date().toISOString()}).eq('id','main')
    setBalance({bank,cash}); setEditBal(false); toast.success('บันทึกยอดเงินแล้ว')
  }

  const openAdd = () => {
    setEditId(null)
    setForm({type:'Expense',category:'Operating',amount:'',note:'',date:nowLocal()})
    setImgFiles([]); setImgPreviews([]); setRemovedImgs([])
    setShowForm(true)
  }
  const openEdit = tx => {
    setEditId(tx.id)
    setForm({type:tx.type,category:tx.category,amount:tx.amount,note:tx.note||'',date:toLocal(tx.date),customer_note:tx.products?.customer_note||''})
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
  const save = async () => {
    if (!form.amount) return toast.error('กรุณาระบุจำนวนเงิน')
    setSaving(true)
    try {
      const payload = {type:form.type,category:form.category,amount:parseFloat(form.amount),note:form.note,date:new Date(form.date).toISOString()}
      if (editId) {
        // ลบรูปที่ถูก mark ว่าลบ
        for (const url of removedImgs) await deleteReceiptImage(supabase, url)
        // upload รูปใหม่
        let newUrls = []
        if (imgFiles.length) newUrls = await uploadReceiptImages(supabase, editId, imgFiles)
        // หา tx เดิมเพื่อ merge รูป
        const existing = txs.find(t=>t.id===editId)
        const kept = (existing?.images||[]).filter(u=>!removedImgs.includes(u))
        payload.images = [...kept, ...newUrls]
        await supabase.from('transactions').update(payload).eq('id',editId)
        if (form.category === 'Sale') {
          const tx = txs.find(t=>t.id===editId)
          if (tx?.product_id) await supabase.from('products').update({customer_note:form.customer_note?.trim()||null}).eq('id',tx.product_id)
        }
        toast.success('แก้ไขแล้ว')
      } else {
        const {data:newTx, error} = await supabase.from('transactions').insert(payload).select().single()
        if (error) throw error
        if (imgFiles.length) {
          const urls = await uploadReceiptImages(supabase, newTx.id, imgFiles)
          await supabase.from('transactions').update({images:urls}).eq('id',newTx.id)
        }
        toast.success('เพิ่มรายการแล้ว')
      }
      setShowForm(false); setEditId(null)
      setImgFiles([]); setImgPreviews([]); setRemovedImgs([])
      load()
    } catch(e){toast.error(e.message)}
    finally{setSaving(false)}
  }
  const del = async tx => {
    const willRevertSale   = tx.category === 'Sale'      && tx.product_id
    const willDeleteProduct = tx.category === 'Buy Stock' && tx.product_id
    const msg = willDeleteProduct
      ? 'ลบรายการนี้?\n⚠️ สินค้าที่เชื่อมอยู่จะถูกลบออกจากสต็อกด้วย'
      : willRevertSale
      ? 'ลบรายการนี้?\n• สินค้าที่เชื่อมอยู่จะกลับเป็นพร้อมขาย\n• ยอดเงินจะถูกหักคืนอัตโนมัติ'
      : 'ลบรายการนี้?'
    if (!confirm(msg)) return

    try {
      if (willRevertSale) {
        const price = Number(tx.amount)
        const method = tx.payment_method
        await supabase.from('products').update({
          status: 'Available', sold_price: null, sold_date: null,
          payment_method: null, warranty_expiry: null,
        }).eq('id', tx.product_id)
        if (price > 0 && method) {
          const { data: bal } = await supabase.from('balances').select('*').eq('id', 'main').single()
          if (bal) {
            const upd = method === 'โอน'
              ? { bank: Math.max(0, Number(bal.bank) - price) }
              : { cash: Math.max(0, Number(bal.cash) - price) }
            await supabase.from('balances').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', 'main')
          }
        }
        await supabase.from('transactions').delete().eq('id', tx.id)
        toast.success('ลบแล้ว — สินค้ากลับเป็นพร้อมขาย'); load(); return
      }

      if (willDeleteProduct) {
        await supabase.from('transactions').delete().eq('product_id', tx.product_id)
        await deleteAllProductImages(supabase, tx.product_id)
        await supabase.from('products').delete().eq('id', tx.product_id)
        toast.success('ลบแล้ว — สินค้าถูกลบออกจากสต็อก'); load(); return
      }

      await supabase.from('transactions').delete().eq('id', tx.id)
      toast.success('ลบแล้ว'); load()
    } catch(e) { toast.error(e.message) }
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
      <div className="bg-brand-dark px-4 pt-4 pb-4 space-y-3">
        {/* รายรับ / รายจ่าย / กำไร */}
        <div className="flex gap-2">
          <button onClick={()=>{setShowIncome(true);setDetailFrom('');setDetailTo('')}}
            className="flex-1 rounded-xl p-2.5 text-center active:scale-95 transition-all"
            style={{background:'rgba(255,255,255,0.08)'}}>
            <p className="text-white/50 text-xs">รายรับ 🔍</p>
            <p className="font-bold text-sm mt-0.5 text-green-400">฿{fmt(income)}</p>
          </button>
          <button onClick={()=>{setShowExpense(true);setDetailFrom('');setDetailTo('')}}
            className="flex-1 rounded-xl p-2.5 text-center active:scale-95 transition-all"
            style={{background:'rgba(255,255,255,0.08)'}}>
            <p className="text-white/50 text-xs">รายจ่าย 🔍</p>
            <p className="font-bold text-sm mt-0.5 text-red-400">฿{fmt(expense)}</p>
          </button>
          <button onClick={()=>setShowProfit(true)}
            className="flex-1 rounded-xl p-2.5 text-center active:scale-95 transition-all"
            style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,184,56,0.3)'}}>
            <p className="text-white/50 text-xs">กำไรขาย 🔍</p>
            <p className={`font-bold text-sm mt-0.5 ${soldProfit>=0?'text-brand-yellow':'text-red-400'}`}>
              {soldProfit<0?'-':''}฿{fmt(Math.abs(soldProfit))}
            </p>
          </button>
        </div>

        {/* Modal รายรับ */}
        {showIncome && (() => {
          const items = txs.filter(t=>{
            if (t.type!=='Income') return false
            if (detailFrom && new Date(t.date)<new Date(detailFrom)) return false
            if (detailTo   && new Date(t.date)>new Date(detailTo+'T23:59:59')) return false
            return true
          })
          const total = items.reduce((a,t)=>a+Number(t.amount),0)
          return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setShowIncome(false)}>
              <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
                <div className="px-5 pt-5 pb-3 border-b border-amber-100">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-lg text-brand-dark">รายละเอียดรายรับ</h2>
                    <button onClick={()=>setShowIncome(false)} className="text-gray-400 p-1">✕</button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <ThaiDatePicker value={detailFrom} onChange={setDetailFrom} className="input flex-1 text-sm py-1.5"/>
                    <span className="text-gray-400">—</span>
                    <ThaiDatePicker value={detailTo} onChange={setDetailTo} className="input flex-1 text-sm py-1.5"/>
                    {(detailFrom||detailTo) && <button onClick={()=>{setDetailFrom('');setDetailTo('')}} className="text-gray-400 text-lg">✕</button>}
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
            if (detailFrom && new Date(t.date)<new Date(detailFrom)) return false
            if (detailTo   && new Date(t.date)>new Date(detailTo+'T23:59:59')) return false
            return true
          })
          const total = items.reduce((a,t)=>a+Number(t.amount),0)
          return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setShowExpense(false)}>
              <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
                <div className="px-5 pt-5 pb-3 border-b border-amber-100">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-lg text-brand-dark">รายละเอียดรายจ่าย</h2>
                    <button onClick={()=>setShowExpense(false)} className="text-gray-400 p-1">✕</button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <ThaiDatePicker value={detailFrom} onChange={setDetailFrom} className="input flex-1 text-sm py-1.5"/>
                    <span className="text-gray-400">—</span>
                    <ThaiDatePicker value={detailTo} onChange={setDetailTo} className="input flex-1 text-sm py-1.5"/>
                    {(detailFrom||detailTo) && <button onClick={()=>{setDetailFrom('');setDetailTo('')}} className="text-gray-400 text-lg">✕</button>}
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
                  <button onClick={()=>setShowProfit(false)} className="text-gray-400 p-1">✕</button>
                </div>
                {/* date filter */}
                <div className="flex gap-2 items-center">
                  <ThaiDatePicker value={profitFrom} onChange={setProfitFrom} className="input flex-1 text-sm py-1.5" placeholder="จากวันที่"/>
                  <span className="text-gray-400 text-sm">—</span>
                  <ThaiDatePicker value={profitTo} onChange={setProfitTo} className="input flex-1 text-sm py-1.5" placeholder="ถึงวันที่"/>
                  {(profitFrom||profitTo) && (
                    <button onClick={()=>{setProfitFrom('');setProfitTo('')}} className="text-gray-400 text-lg">✕</button>
                  )}
                </div>
                <div className="mt-2 space-y-0.5">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-500">{filteredSoldItems.length} รายการขาย</p>
                    <p className="text-sm font-semibold text-green-600">+฿{fmt(filteredGross)}</p>
                  </div>
                  {filteredShipping > 0 && (
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-orange-500">🚚 ค่าขนส่ง (Shipping)</p>
                      <p className="text-sm font-semibold text-orange-500">-฿{fmt(filteredShipping)}</p>
                    </div>
                  )}
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
                  ? <div className="text-center py-10 text-gray-400"><div className="text-4xl mb-2">📊</div>ไม่มีข้อมูลในช่วงนี้</div>
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
        <div className="bg-white/8 rounded-xl p-3 space-y-2" style={{background:'rgba(255,255,255,0.08)'}}>
          <div className="flex items-center justify-between">
            <span className="text-white/60 text-xs font-medium">ยอดเงินคงเหลือ</span>
            <button onClick={()=>{setBalForm({bank:balance.bank,cash:balance.cash});setEditBal(!editBal)}}
              className="text-brand-yellow text-xs">✏️ แก้ไข</button>
          </div>
          {editBal ? (
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <span className="text-white/60 text-xs w-16">ยอดโอน</span>
                <input autoComplete="off" className="input flex-1 text-sm py-1.5" type="number" placeholder="0" value={balForm.bank} onChange={e=>setBalForm({...balForm,bank:e.target.value})}/>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-white/60 text-xs w-16">เงินสด</span>
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
                <p className="text-white/40 text-xs">💳 ยอดโอน</p>
                <p className="text-blue-300 font-bold text-sm">฿{fmt(balance.bank)}</p>
              </div>
              <div className="text-center">
                <p className="text-white/40 text-xs">💵 เงินสด</p>
                <p className="text-green-300 font-bold text-sm">฿{fmt(balance.cash)}</p>
              </div>
              <div className="text-center">
                <p className="text-white/40 text-xs">📦 สต็อก</p>
                <p className="text-amber-300 font-bold text-sm">฿{fmt(stockValue)}</p>
              </div>
            </div>
          )}
          {!editBal && (
            <div className="border-t border-white/10 pt-2 flex justify-between items-center">
              <span className="text-white/60 text-xs">มูลค่ารวมทั้งหมด</span>
              <span className="text-brand-yellow font-bold">฿{fmt(totalWealth)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Date filter + Filter button */}
      <div className="px-4 py-3 border-b border-amber-100 bg-white">
        <div className="flex gap-2 items-center">
          <ThaiDatePicker value={dateFrom} onChange={setDateFrom} className="input flex-1 text-sm py-1.5"/>
          <span className="text-gray-400 text-sm">—</span>
          <ThaiDatePicker value={dateTo} onChange={setDateTo} className="input flex-1 text-sm py-1.5"/>
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
          <select className="input text-sm" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
            {CATS.map(c=><option key={c}>{c}</option>)}
          </select>
          <input autoComplete="off" className="input text-sm" type="number" placeholder="จำนวนเงิน (บาท)" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลา</label>
            <ThaiDatePicker value={form.date} onChange={v=>setForm({...form,date:v})} showTime className="input text-sm w-full"/>
          </div>
          <input autoComplete="off" className="input text-sm" placeholder="หมายเหตุ" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/>
          {editId && form.category==='Sale' && (
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
            {searched.length===0 && <div className="text-center pt-16 text-gray-400"><div className="text-5xl mb-3">💰</div>ไม่มีรายการในช่วงนี้</div>}
            {searched.map(tx=>{
              const profit = tx.category==='Sale' && tx.products?.total_cost!=null
                ? Number(tx.amount)-Number(tx.products.total_cost) : null
              const warrantyDays = tx.category==='Sale' && tx.products?.warranty_expiry
                ? Math.ceil((new Date(tx.products.warranty_expiry)-new Date())/86400000) : null
              const isTrade = tx.category === 'Trade'

              // Trade transaction — แสดงแบบพิเศษสีน้ำเงิน
              if (isTrade) {
                return (
                  <div key={tx.id} className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-3 flex items-start gap-3">
                    <div className="w-2 rounded-full flex-shrink-0 self-stretch bg-blue-400"/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200 flex-shrink-0">🔄 Trade</span>
                        <div className="text-right flex-shrink-0">
                          {tx.trade_sell_a && <p className="text-xs text-gray-500">ขาย ฿{fmt(tx.trade_sell_a)}</p>}
                          {tx.trade_profit_a != null && (
                            <p className={`text-xs font-bold ${Number(tx.trade_profit_a)>=0?'text-green-600':'text-red-500'}`}>
                              กำไร {Number(tx.trade_profit_a)>=0?'+':''}฿{fmt(tx.trade_profit_a)}
                            </p>
                          )}
                        </div>
                      </div>
                      {tx.products?.model && (
                        <p className="text-sm font-semibold text-blue-700 mt-0.5 truncate">{tx.products.model}</p>
                      )}
                      {tx.note && (
                        <div className="mt-1 space-y-0.5">
                          {tx.note.split(' | ').map((line,i)=>(
                            <p key={i} className="text-xs text-blue-600/80 truncate">{line}</p>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-1">{thDate(tx.date)}</p>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button onClick={()=>cancelTrade(tx)} className="p-1.5 text-gray-300 hover:text-brand-red"><X size={14}/></button>
                    </div>
                  </div>
                )
              }

              return (
              <div key={tx.id} className="card flex items-center gap-3">
                <div className={`w-2 rounded-full flex-shrink-0 self-stretch ${TX_BAR[tx.category]||(tx.type==='Income'?'bg-green-400':'bg-red-400')}`}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap gap-1 flex-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${catColor(tx.category)}`}>{tx.category}</span>
                      {tx.category==='Sale' && tx.products?.payment_method && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${tx.products.payment_method==='โอน'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'}`}>
                          ชำระ: {tx.products.payment_method}
                        </span>
                      )}
                      {tx.category==='Sale' && warrantyDays!==null && (
                        warrantyDays>=0
                          ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">🛡️ ประกันเหลือ {warrantyDays} วัน</span>
                          : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex-shrink-0">🛡️ หมดประกัน</span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-bold ${tx.type==='Income'?'text-green-600':'text-brand-red'}`}>
                        {tx.type==='Income'?'+':'-'}฿{fmt(tx.amount)}
                      </p>
                      {profit!==null && (
                        <p className={`text-xs font-semibold ${profit>=0?'text-green-500':'text-red-500'}`}>
                          {profit>=0?'📈+':'📉'}฿{fmt(Math.abs(profit))}
                        </p>
                      )}
                    </div>
                  </div>
                  {tx.products?.model && (
                    <p className={`text-sm font-semibold truncate mt-0.5 ${tx.type==='Income'?'text-green-700':'text-red-600'}`}>
                      {tx.products.model}{tx.products.category?` (${tx.products.category})`:''}
                    </p>
                  )}
                  {tx.note && <p className="text-xs text-gray-400 truncate">{tx.note}</p>}
                  {tx.category==='Sale' && tx.products?.customer_note && (
                    <p className="text-xs text-blue-500 truncate">👤 {tx.products.customer_note}</p>
                  )}
                  {tx.images?.length > 0 && (
                    <div className="flex gap-1 mt-1 overflow-x-auto">
                      {tx.images.map((url,i)=>(
                        <img key={i} src={url} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-amber-100"
                          onClick={()=>window.open(url,'_blank')}/>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-300 mt-0.5">{thDate(tx.date)}</p>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={()=>openEdit(tx)} className="p-1.5 text-gray-300 hover:text-brand-dark"><Edit2 size={14}/></button>
                  <button onClick={()=>del(tx)} className="p-1.5 text-gray-300 hover:text-brand-red"><X size={14}/></button>
                </div>
              </div>
            )})}
          </div>
      }
    </div>
  )
}
