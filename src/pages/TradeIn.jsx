import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, Search, ArrowLeftRight, Plus, Minus, ImagePlus, X, Trash2 } from 'lucide-react'
import { uploadReceiptImages } from '../lib/imageUtils'
import toast from 'react-hot-toast'

const fmt = n => Number(n||0).toLocaleString('th-TH')
const CATEGORIES = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const nowLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16) }
const newB = () => ({ _id: Math.random().toString(36).slice(2), model:'', serial_number:'', category:'กล้องดิจิตอลเก่า', condition:1, buy_price:'', notes:'' })

export default function TradeIn() {
  const navigate = useNavigate()

  // A: selected shop products (multiple)
  const [itemsA, setItemsA]   = useState([]) // [{product, sellPrice:''}]
  const [products, setProducts] = useState([])
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)

  // B: customer trade-in items (multiple)
  const [itemsB, setItemsB] = useState([newB()])

  // common
  const [tradeDate, setTradeDate] = useState(nowLocal())
  const [payMethod, setPayMethod] = useState('โอน')
  const [bankAmount, setBankAmount] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [imgFiles,  setImgFiles]  = useState([])
  const [imgPrev,   setImgPrev]   = useState([])

  const loadProducts = async (q='') => {
    setLoading(true)
    let query = supabase.from('products').select('*').eq('status','Available').order('created_at',{ascending:false})
    if (q) query = query.or(`model.ilike.%${q}%,serial_number.ilike.%${q}%`)
    const { data } = await query
    setProducts(data||[])
    setLoading(false)
  }
  useEffect(() => { loadProducts() }, [])

  // Derived totals
  const selectedIds  = new Set(itemsA.map(x => x.product.id))
  const displayProds = products.filter(p => !selectedIds.has(p.id))
  const totalSellA   = itemsA.reduce((a,x) => a + Number(x.sellPrice||0), 0)
  const totalCostA   = itemsA.reduce((a,x) => a + Number(x.product.total_cost||0), 0)
  const totalProfitA = totalSellA - totalCostA
  const totalBuyB    = itemsB.reduce((a,x) => a + Number(x.buy_price||0), 0)
  const diff         = totalSellA - totalBuyB
  const diffAbs      = Math.abs(diff)
  const isSplitPay   = payMethod === 'แบ่งจ่าย'
  const splitBank    = Number(bankAmount || 0)
  const splitCash    = Number(cashAmount || 0)
  const splitTotal   = splitBank + splitCash

  const addA        = p  => setItemsA(prev => [...prev, { product: p, sellPrice: '' }])
  const removeA     = idx => setItemsA(prev => prev.filter((_,i) => i !== idx))
  const updateSellA = (idx, v) => setItemsA(prev => prev.map((x,i) => i===idx ? {...x, sellPrice:v} : x))

  const addBItem = () => setItemsB(prev => [...prev, newB()])
  const removeB  = id  => setItemsB(prev => prev.filter(x => x._id !== id))
  const updateB  = (id, field, val) => setItemsB(prev => prev.map(x => x._id===id ? {...x,[field]:val} : x))

  const profitColor = p => p > 0 ? 'text-green-600' : p < 0 ? 'text-red-500' : 'text-gray-500'

  const doTradeIn = async () => {
    if (!itemsA.length)                      return toast.error('กรุณาเลือกสินค้าร้านอย่างน้อย 1 รายการ')
    if (itemsA.some(x => !x.sellPrice))      return toast.error('กรุณากรอกราคาขายสินค้า A ให้ครบ')
    if (itemsB.some(x => !x.model))          return toast.error('กรุณากรอกชื่อสินค้า B ให้ครบ')
    if (itemsB.some(x => !x.serial_number))  return toast.error('กรุณากรอก Serial สินค้า B ให้ครบ')
    if (itemsB.some(x => !x.buy_price))      return toast.error('กรุณากรอกราคารับซื้อสินค้า B ให้ครบ')
    if (diff !== 0 && isSplitPay) {
      if (splitTotal <= 0)                   return toast.error('กรุณาระบุยอดโอนหรือเงินสด')
      if (splitTotal !== diffAbs)            return toast.error(`ยอดแบ่งจ่ายต้องรวมเท่ากับ ฿${fmt(diffAbs)}`)
    }

    setSaving(true)
    try {
      const now      = tradeDate ? new Date(tradeDate).toISOString() : new Date().toISOString()
      const warranty = new Date(new Date(now).getTime() + 15*86400000).toISOString()

      const tradeNote = [
        `🔄 แลกเปลี่ยน`,
        `A: ${itemsA.map(x=>`${x.product.model} ฿${fmt(Number(x.sellPrice))}`).join(', ')}`,
        `B: ${itemsB.map(x=>`${x.model} ฿${fmt(Number(x.buy_price))}`).join(', ')}`,
        diff>0 ? `ลูกค้าจ่ายเพิ่ม ฿${fmt(diff)} (${isSplitPay ? `โอน ฿${fmt(splitBank)} + สด ฿${fmt(splitCash)}` : payMethod})` : diff<0 ? `ร้านจ่ายคืน ฿${fmt(Math.abs(diff))} (${isSplitPay ? `โอน ฿${fmt(splitBank)} + สด ฿${fmt(splitCash)}` : payMethod})` : `แลกเท่ากันพอดี`,
      ].join(' | ')

      // 1. Insert B products into stock
      const bIds = []
      for (const b of itemsB) {
        const buyB = Number(b.buy_price||0)
        const { data: pb, error: e1 } = await supabase.from('products').insert({
          model: b.model.trim(), serial_number: b.serial_number.trim(),
          category: b.category, condition: Number(b.condition),
          base_cost: buyB, total_cost: buyB,
          status: 'Available', is_trade_in: true,
          notes: b.notes || tradeNote, created_at: now, images: [],
        }).select().single()
        if (e1) throw e1
        await supabase.from('transactions').delete()
          .eq('product_id', pb.id).eq('category','Buy Stock')
        bIds.push(pb.id)
      }

      // 2. Mark A products as Sold
      for (const x of itemsA) {
        const { error: e2 } = await supabase.from('products').update({
          status: 'Sold', sold_price: Number(x.sellPrice),
          sold_date: now, warranty_expiry: warranty,
          payment_method: payMethod, trade_ref_id: bIds[0]||null,
        }).eq('id', x.product.id)
        if (e2) throw e2
      }

      // 3. คำนวณยอดคงเหลือ + One combined Trade transaction
      const { data: balTrade } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
      let bank_afterTrade = Number(balTrade?.bank || 0)
      let cash_afterTrade = Number(balTrade?.cash || 0)
      if (diff > 0) {
        if (isSplitPay) { bank_afterTrade += splitBank; cash_afterTrade += splitCash }
        else if (payMethod==='โอน') bank_afterTrade += diff
        else cash_afterTrade += diff
      }
      else if (diff < 0) {
        const amt = Math.abs(diff)
        if (isSplitPay) {
          bank_afterTrade = Math.max(0, bank_afterTrade - splitBank)
          cash_afterTrade = Math.max(0, cash_afterTrade - splitCash)
        } else if (payMethod==='โอน') bank_afterTrade = Math.max(0, bank_afterTrade-amt)
        else cash_afterTrade = Math.max(0, cash_afterTrade-amt)
      }

      const { data: tradeTx, error: eTx } = await supabase.from('transactions').insert({
        date: now,
        type: diff >= 0 ? 'Income' : 'Expense',
        category: 'Trade',
        amount: Math.abs(diff) || totalSellA,
        product_id: itemsA[0].product.id,
        payment_method: payMethod,
        bank_amount: isSplitPay && diff !== 0 ? splitBank : null,
        cash_amount: isSplitPay && diff !== 0 ? splitCash : null,
        note: tradeNote,
        trade_sell_a: totalSellA,
        trade_profit_a: totalProfitA,
      }).select().single()
      if (eTx) throw eTx
      if (tradeTx) { try { await supabase.from('transactions').update({ bank_after: bank_afterTrade, cash_after: cash_afterTrade }).eq('id', tradeTx.id) } catch(_) {} }

      // Upload receipt images
      if (imgFiles.length && tradeTx) {
        const urls = await uploadReceiptImages(supabase, tradeTx.id, imgFiles)
        await supabase.from('transactions').update({ images: urls }).eq('id', tradeTx.id)
      }

      // 4. Update balance
      await supabase.from('balances').update({ bank: bank_afterTrade, cash: cash_afterTrade, updated_at: now }).eq('id','main')

      toast.success('บันทึกการแลกเปลี่ยนสำเร็จ!')
      navigate('/inventory')
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const canSubmit = itemsA.length > 0 && itemsA.every(x=>x.sellPrice) &&
    itemsB.every(x=>x.model&&x.serial_number&&x.buy_price)

  return (
    <div>
      <div className="liquid-sub-header flex items-center gap-3 px-4 py-3">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24}/></button>
        <h1 className="font-bold text-lg flex items-center gap-2">
          <ArrowLeftRight size={20} className="text-blue-500"/>แลกเปลี่ยนสินค้า
        </h1>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* Date */}
        <div className="card">
          <label className="text-xs text-gray-500 mb-1 block font-medium">วันที่และเวลาแลกเปลี่ยน</label>
          <ThaiDatePicker value={tradeDate} onChange={setTradeDate} showTime className="input w-full"/>
        </div>

        {/* ── A: Shop products ── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-brand-dark text-brand-yellow text-xs font-bold flex items-center justify-center">A</span>
            <h2 className="font-semibold">สินค้าร้านที่ลูกค้าต้องการ</h2>
            {itemsA.length > 0 && <span className="ml-auto text-xs text-gray-400">{itemsA.length} รายการ</span>}
          </div>

          {/* Selected A items */}
          {itemsA.map((x, idx) => {
            const costA = Number(x.product.total_cost||0)
            const sellA = Number(x.sellPrice||0)
            const profA = sellA - costA
            return (
              <div key={x.product.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{x.product.model}</p>
                    <p className="text-xs text-gray-400">SN: {x.product.serial_number} · ต้นทุน ฿{fmt(costA)}</p>
                  </div>
                  <button onClick={()=>removeA(idx)} className="text-gray-400 p-1 flex-shrink-0 ml-2"><X size={15}/></button>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ราคาที่ขายได้จริง (บาท) *</label>
                  <input autoComplete="off" className="input text-sm py-1.5" type="number" placeholder="0"
                    value={x.sellPrice} onChange={e=>updateSellA(idx,e.target.value)}/>
                  {x.sellPrice && (
                    <div className="flex justify-between mt-1 text-xs">
                      <span className="text-gray-400">กำไร = ฿{fmt(sellA)} - ฿{fmt(costA)}</span>
                      <span className={`font-bold ${profitColor(profA)}`}>{profA>=0?'+':''}฿{fmt(profA)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Search to add A */}
          <div className="space-y-2">
            {itemsA.length > 0 && <p className="text-xs text-gray-400 font-medium">ค้นหาเพิ่มเติม</p>}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoComplete="off" className="input pl-9 text-sm" placeholder="ค้นหารุ่นหรือ Serial..."
                value={search} onChange={e=>{setSearch(e.target.value);loadProducts(e.target.value)}}/>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {loading
                ? <p className="text-xs text-center text-gray-400 py-4">กำลังโหลด...</p>
                : displayProds.length===0
                  ? <p className="text-xs text-center text-gray-400 py-4">ไม่พบสินค้า</p>
                  : displayProds.map(p=>(
                      <button key={p.id} onClick={()=>addA(p)}
                        className="w-full text-left bg-gray-50 hover:bg-amber-50 rounded-xl px-3 py-2.5 transition-colors border border-transparent hover:border-amber-200">
                        <p className="font-medium text-sm">{p.model}</p>
                        <div className="flex justify-between mt-0.5">
                          <p className="text-xs text-gray-400">SN: {p.serial_number}</p>
                          <p className="text-xs font-semibold text-amber-600">ต้นทุน ฿{fmt(p.total_cost)}</p>
                        </div>
                      </button>
                    ))
              }
            </div>
          </div>
        </div>

        {/* ── B: Customer trade-in items ── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">B</span>
            <h2 className="font-semibold">สินค้าที่ลูกค้าเอามาแลก</h2>
            <button onClick={addBItem}
              className="ml-auto flex items-center gap-1 text-xs text-blue-600 font-medium border border-blue-300 px-2 py-1 rounded-lg active:scale-95 transition-all">
              <Plus size={12}/>เพิ่มรายการ
            </button>
          </div>

          {itemsB.map((b, idx) => (
            <div key={b._id} className="border border-blue-200 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs font-semibold text-blue-700">
                  {b.model ? b.model : `สินค้า B${idx+1}`}
                  {b.buy_price ? ` — ฿${fmt(Number(b.buy_price))}` : ''}
                </p>
                {itemsB.length > 1 && (
                  <button onClick={()=>removeB(b._id)} className="text-red-400 p-0.5"><Trash2 size={14}/></button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">ชื่อรุ่น *</label>
                  <input autoComplete="off" className="input text-sm py-1.5" placeholder="เช่น Canon 600D"
                    value={b.model} onChange={e=>updateB(b._id,'model',e.target.value)}/>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Serial Number *</label>
                  <input autoComplete="off" className="input text-sm py-1.5" placeholder="SN..."
                    value={b.serial_number} onChange={e=>updateB(b._id,'serial_number',e.target.value)}/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ประเภท</label>
                  <select className="input text-sm py-1.5" value={b.category}
                    onChange={e=>updateB(b._id,'category',e.target.value)}>
                    {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ราคารับซื้อ (บาท) *</label>
                  <input autoComplete="off" className="input text-sm py-1.5" type="number" placeholder="0"
                    value={b.buy_price} onChange={e=>updateB(b._id,'buy_price',e.target.value)}/>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">เกรดสภาพ</label>
                <div className="flex gap-2">
                  {[5,4,3,2,1].map(c=>(
                    <button key={c} onClick={()=>updateB(b._id,'condition',c)}
                      className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all
                        ${b.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
                <input autoComplete="off" className="input text-sm py-1.5" placeholder="สภาพ, อุปกรณ์ที่มาด้วย..."
                  value={b.notes} onChange={e=>updateB(b._id,'notes',e.target.value)}/>
              </div>
            </div>
          ))}
        </div>

        {/* ── Summary ── */}
        {itemsA.length > 0 && totalSellA > 0 && (
          <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 space-y-3">
            <h3 className="font-bold text-blue-800 flex items-center gap-2">
              <ArrowLeftRight size={16}/>สรุปการแลกเปลี่ยน
            </h3>

            <div className="space-y-2 text-sm">
              {/* A */}
              <div className="bg-white/70 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1.5 font-medium">A — สินค้าร้าน ({itemsA.length} ชิ้น)</p>
                {itemsA.map(x => {
                  const profA = Number(x.sellPrice||0) - Number(x.product.total_cost||0)
                  return (
                    <div key={x.product.id} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-600 truncate max-w-[55%]">{x.product.model}</span>
                      <div className="flex gap-3 items-center">
                        <span className="text-gray-400">฿{fmt(Number(x.sellPrice||0))}</span>
                        <span className={`font-semibold ${profitColor(profA)}`}>{profA>=0?'+':''}฿{fmt(profA)}</span>
                      </div>
                    </div>
                  )
                })}
                <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5">
                  <span className="font-medium text-xs">รวมกำไร A</span>
                  <span className={`font-bold text-sm ${profitColor(totalProfitA)}`}>{totalProfitA>=0?'+':''}฿{fmt(totalProfitA)}</span>
                </div>
              </div>

              {/* B */}
              <div className="bg-white/70 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1.5 font-medium">B — สินค้าลูกค้า ({itemsB.length} ชิ้น)</p>
                {itemsB.map(b=>(
                  <div key={b._id} className="flex justify-between py-0.5 text-xs">
                    <span className="text-gray-600 truncate max-w-[60%]">{b.model||'...'}</span>
                    <span className="text-gray-500">฿{fmt(Number(b.buy_price||0))}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5">
                  <span className="font-medium text-xs">รวมรับซื้อ B</span>
                  <span className="font-bold text-sm text-blue-600">฿{fmt(totalBuyB)}</span>
                </div>
              </div>

              {/* Net diff */}
              <div className={`rounded-xl p-3 border-2 ${diff>0?'bg-green-50 border-green-300':diff<0?'bg-red-50 border-red-300':'bg-blue-50 border-blue-200'}`}>
                <div className="flex items-center justify-between">
                  {diff>0
                    ? <><span className="font-bold text-green-700 flex items-center gap-1"><Plus size={14}/>ลูกค้าต้องจ่ายเพิ่ม</span><span className="font-bold text-green-700 text-lg">฿{fmt(diff)}</span></>
                    : diff<0
                      ? <><span className="font-bold text-red-600 flex items-center gap-1"><Minus size={14}/>ร้านต้องจ่ายคืน</span><span className="font-bold text-red-600 text-lg">฿{fmt(Math.abs(diff))}</span></>
                      : <><span className="font-bold text-blue-600">แลกเท่ากันพอดี</span><span className="font-bold text-blue-600 text-lg">฿0</span></>
                  }
                </div>
              </div>
            </div>

            {diff !== 0 && (
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">ช่องทางชำระส่วนต่าง</label>
                <div className="flex gap-2">
                  {['โอน','เงินสด','แบ่งจ่าย'].map(m=>(
                    <button key={m} onClick={()=>{setPayMethod(m);setBankAmount('');setCashAmount('')}}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                        ${payMethod===m
                          ? m==='โอน'?'bg-blue-600 text-white border-blue-600':m==='เงินสด'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red'
                          : 'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':m==='เงินสด'?'💵 เงินสด':'แบ่ง'}
                    </button>
                  ))}
                </div>
                {isSplitPay && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="ยอดโอน"
                      value={bankAmount} onChange={e=>setBankAmount(e.target.value)}/>
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="เงินสด"
                      value={cashAmount} onChange={e=>setCashAmount(e.target.value)}/>
                    <p className={`col-span-2 text-xs font-medium ${splitTotal === diffAbs ? 'text-green-600' : 'text-orange-600'}`}>
                      รวมแบ่งจ่าย ฿{fmt(splitTotal)} / ต้องเท่ากับ ฿{fmt(diffAbs)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Receipt images */}
        <div className="card space-y-2">
          <p className="text-sm font-medium text-gray-600">รูปใบเสร็จ / หลักฐาน (ไม่บังคับ)</p>
          <div className="flex gap-2 flex-wrap">
            {imgPrev.map((src,i)=>(
              <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-amber-200 flex-shrink-0">
                <img src={src} className="w-full h-full object-cover"/>
                <button onClick={()=>{
                  URL.revokeObjectURL(imgPrev[i])
                  setImgFiles(f=>f.filter((_,j)=>j!==i))
                  setImgPrev(p=>p.filter((_,j)=>j!==i))
                }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                  <X size={10} className="text-white"/>
                </button>
              </div>
            ))}
            <label className="w-16 h-16 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
              <ImagePlus size={16} className="text-amber-400"/>
              <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
              <input type="file" multiple accept="image/*" className="hidden" onChange={e=>{
                const files = Array.from(e.target.files)
                setImgFiles(p=>[...p,...files])
                setImgPrev(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
              }}/>
            </label>
          </div>
        </div>

        <button onClick={doTradeIn} disabled={saving||!canSubmit}
          className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50">
          <ArrowLeftRight size={18}/>
          {saving?'กำลังบันทึก...':'ยืนยันการแลกเปลี่ยน'}
        </button>

      </div>
    </div>
  )
}
