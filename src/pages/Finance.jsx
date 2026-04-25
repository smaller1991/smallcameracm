import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Edit2, X, Check, ImagePlus } from 'lucide-react'
import { uploadReceiptImages, deleteReceiptImage } from '../lib/imageUtils'
import toast from 'react-hot-toast'

const CATS = ['Buy Stock','Add-on','Sale','Rent','Marketing','Operating','Other']
const fmt  = n => Number(n||0).toLocaleString('th-TH')
const thDate = d => new Date(d).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})
const toLocal = iso => { const d=new Date(iso); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16) }
const nowLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16) }

// สีตาม category
const CAT_COLOR = {
  'Sale':      'bg-green-100 text-green-700 border-green-200',
  'Buy Stock': 'bg-red-100 text-red-700 border-red-200',
  'Add-on':    'bg-yellow-100 text-yellow-700 border-yellow-200',
}
const catColor = cat => CAT_COLOR[cat] || 'bg-gray-100 text-gray-600 border-gray-200'
const TX_BAR   = { 'Sale':'bg-green-400', 'Buy Stock':'bg-red-400', 'Add-on':'bg-yellow-400' }
const txBar    = cat => TX_BAR[cat] || (cat==='Income'?'bg-green-400':'bg-gray-300')

export default function Finance() {
  const [txs,      setTxs]      = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState({type:'Expense',category:'Operating',amount:'',note:'',date:nowLocal()})
  const [saving,   setSaving]   = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [imgFiles,    setImgFiles]    = useState([])
  const [imgPreviews, setImgPreviews] = useState([])
  const [removedImgs, setRemovedImgs] = useState([])

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
  const [profitTo,     setProfitTo]     = useState('')

  const load = async () => {
    const [{data:txData},{data:bal},{data:products}] = await Promise.all([
      supabase.from('transactions').select('*,products(model,category,total_cost)').order('date',{ascending:false}),
      supabase.from('balances').select('*').eq('id','main').single(),
      supabase.from('products').select('id,model,serial_number,category,total_cost,sold_price,sold_date,payment_method').eq('status','Sold'),
    ])
    setTxs(txData||[])
    if (bal) setBalance({bank:Number(bal.bank),cash:Number(bal.cash)})

    const sold = (products||[]).filter(p=>p.sold_price)
    setSoldItems(sold)
    const sp = sold.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)
    setSoldProfit(sp)

    // stockValue จาก products ที่ยัง Available
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
    return true
  })

  // sold items filtered by profit date range
  const filteredSoldItems = soldItems.filter(p => {
    if (!p.sold_date) return false
    if (profitFrom && new Date(p.sold_date)<new Date(profitFrom)) return false
    if (profitTo   && new Date(p.sold_date)>new Date(profitTo+'T23:59:59')) return false
    return true
  })
  const filteredProfit = filteredSoldItems.reduce((a,p)=>a+(Number(p.sold_price)-Number(p.total_cost)),0)

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
    setForm({type:tx.type,category:tx.category,amount:tx.amount,note:tx.note||'',date:toLocal(tx.date)})
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
  const del = async id => {
    if (!confirm('ลบรายการนี้?')) return
    await supabase.from('transactions').delete().eq('id',id)
    toast.success('ลบแล้ว'); load()
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
                    <input className="input flex-1 text-sm py-1.5" type="date" value={detailFrom} onChange={e=>setDetailFrom(e.target.value)}/>
                    <span className="text-gray-400">—</span>
                    <input className="input flex-1 text-sm py-1.5" type="date" value={detailTo} onChange={e=>setDetailTo(e.target.value)}/>
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
                    <input className="input flex-1 text-sm py-1.5" type="date" value={detailFrom} onChange={e=>setDetailFrom(e.target.value)}/>
                    <span className="text-gray-400">—</span>
                    <input className="input flex-1 text-sm py-1.5" type="date" value={detailTo} onChange={e=>setDetailTo(e.target.value)}/>
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
                  <input className="input flex-1 text-sm py-1.5" type="date"
                    value={profitFrom} onChange={e=>setProfitFrom(e.target.value)} placeholder="จากวันที่"/>
                  <span className="text-gray-400 text-sm">—</span>
                  <input className="input flex-1 text-sm py-1.5" type="date"
                    value={profitTo} onChange={e=>setProfitTo(e.target.value)} placeholder="ถึงวันที่"/>
                  {(profitFrom||profitTo) && (
                    <button onClick={()=>{setProfitFrom('');setProfitTo('')}} className="text-gray-400 text-lg">✕</button>
                  )}
                </div>
                <div className="flex justify-between items-center mt-2">
                  <p className="text-xs text-gray-500">{filteredSoldItems.length} รายการ</p>
                  <p className={`font-bold text-base ${filteredProfit>=0?'text-green-600':'text-red-500'}`}>
                    รวม: {filteredProfit>=0?'+':''}฿{fmt(filteredProfit)}
                  </p>
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
                              <p className="text-xs text-gray-400 mt-0.5">
                                {p.sold_date ? new Date(p.sold_date).toLocaleDateString('th-TH',{dateStyle:'short'}) : ''}
                                {p.payment_method && <span className={"ml-2 px-1.5 py-0.5 rounded text-xs font-medium "+(p.payment_method==='โอน'?'bg-blue-100 text-blue-600':'bg-green-100 text-green-600')}>{p.payment_method}</span>}
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
                <input className="input flex-1 text-sm py-1.5" type="number" placeholder="0" value={balForm.bank} onChange={e=>setBalForm({...balForm,bank:e.target.value})}/>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-white/60 text-xs w-16">เงินสด</span>
                <input className="input flex-1 text-sm py-1.5" type="number" placeholder="0" value={balForm.cash} onChange={e=>setBalForm({...balForm,cash:e.target.value})}/>
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

      {/* Date filter */}
      <div className="px-4 py-3 border-b border-amber-100 bg-white">
        <p className="text-xs text-gray-500 mb-1.5 font-medium">กรองตามช่วงวันที่</p>
        <div className="flex gap-2 items-center">
          <input className="input flex-1 text-sm py-1.5" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
          <span className="text-gray-400 text-sm">—</span>
          <input className="input flex-1 text-sm py-1.5" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
          {(dateFrom||dateTo) && (
            <button onClick={()=>{setDateFrom('');setDateTo('')}} className="text-gray-400 hover:text-brand-red p-1"><X size={16}/></button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 flex justify-between items-center border-b border-amber-100">
        <p className="text-sm text-gray-500">{filtered.length} รายการ</p>
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
          <input className="input text-sm" type="number" placeholder="จำนวนเงิน (บาท)" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลา</label>
            <input className="input text-sm" type="datetime-local" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
          </div>
          <input className="input text-sm" placeholder="หมายเหตุ" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/>

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
                <input type="file" multiple accept="image/*" className="hidden" onChange={e=>addImgFiles(Array.from(e.target.files))}/>
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
            {filtered.length===0 && <div className="text-center pt-16 text-gray-400"><div className="text-5xl mb-3">💰</div>ไม่มีรายการในช่วงนี้</div>}
            {filtered.map(tx=>{
              const profit = tx.category==='Sale' && tx.products?.total_cost!=null
                ? Number(tx.amount)-Number(tx.products.total_cost) : null
              return (
              <div key={tx.id} className="card flex items-center gap-3">
                <div className={`w-2 rounded-full flex-shrink-0 self-stretch ${TX_BAR[tx.category]||(tx.type==='Income'?'bg-green-400':'bg-red-400')}`}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${catColor(tx.category)}`}>{tx.category}</span>
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
                  <button onClick={()=>del(tx.id)} className="p-1.5 text-gray-300 hover:text-brand-red"><X size={14}/></button>
                </div>
              </div>
            )})}
          </div>
      }
    </div>
  )
}
