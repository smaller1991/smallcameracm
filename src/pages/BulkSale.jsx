import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, Search, ShoppingCart, X, ImagePlus } from 'lucide-react'
import { uploadReceiptImages } from '../lib/imageUtils'
import toast from 'react-hot-toast'

const fmt = n => Number(n||0).toLocaleString('th-TH')
const nowLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16) }

export default function BulkSale() {
  const navigate = useNavigate()

  // selected products
  const [items, setItems]     = useState([]) // [{product, sellPrice:''}]
  const [products, setProducts] = useState([])
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)

  // payment
  const [payType,       setPayType]       = useState('full') // 'full' | 'installment'
  const [installFirst,  setInstallFirst]  = useState('')
  const [payMethod,     setPayMethod]     = useState('โอน')
  const [bankAmount,    setBankAmount]    = useState('')
  const [cashAmount,    setCashAmount]    = useState('')
  const [saleDate,      setSaleDate]      = useState(nowLocal())
  const [customerNote,  setCustomerNote]  = useState('')
  const [saving,        setSaving]        = useState(false)
  const [imgFiles,      setImgFiles]      = useState([])
  const [imgPrev,       setImgPrev]       = useState([])

  const loadProducts = async (q='') => {
    setLoading(true)
    let query = supabase.from('products').select('*').eq('status','Available').order('created_at',{ascending:false})
    if (q) query = query.or(`model.ilike.%${q}%,serial_number.ilike.%${q}%`)
    const { data } = await query
    setProducts(data||[])
    setLoading(false)
  }
  useEffect(() => { loadProducts() }, [])

  const selectedIds  = new Set(items.map(x => x.product.id))
  const displayProds = products.filter(p => !selectedIds.has(p.id))
  const totalSell    = items.reduce((a,x) => a + Number(x.sellPrice||0), 0)
  const totalCost    = items.reduce((a,x) => a + Number(x.product.total_cost||0), 0)
  const totalProfit  = totalSell - totalCost
  const firstNum     = Number(installFirst||0)
  const remaining    = totalSell - firstNum

  const addItem    = p   => { setItems(prev => [...prev, {product:p, sellPrice:''}]); setSearch('') }
  const removeItem = idx => setItems(prev => prev.filter((_,i) => i !== idx))
  const updatePrice = (idx, v) => setItems(prev => prev.map((x,i) => i===idx ? {...x, sellPrice:v} : x))

  const profitColor = p => p > 0 ? 'text-green-600' : p < 0 ? 'text-red-500' : 'text-gray-500'

  const paymentTarget = payType === 'installment' ? firstNum : totalSell
  const splitBank = Number(bankAmount || 0)
  const splitCash = Number(cashAmount || 0)
  const splitTotal = splitBank + splitCash
  const isSplitPay = payMethod === 'แบ่งจ่าย'
  const productPayMethod = isSplitPay ? (splitBank >= splitCash ? 'โอน' : 'เงินสด') : payMethod

  const paymentForProduct = (price, index, count, paidSoFar, totalPaid, targetPaid) => {
    const amount = index === count - 1
      ? targetPaid - paidSoFar
      : Math.floor(targetPaid * (price / totalSell))
    if (!isSplitPay) return { amount, bank: payMethod === 'โอน' ? amount : 0, cash: payMethod === 'เงินสด' ? amount : 0 }
    const bank = index === count - 1
      ? splitBank - totalPaid.bank
      : Math.floor(splitBank * (price / totalSell))
    const cash = index === count - 1
      ? splitCash - totalPaid.cash
      : Math.floor(splitCash * (price / totalSell))
    return { amount: bank + cash, bank, cash }
  }

  const doSell = async () => {
    if (!items.length)                      return toast.error('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ')
    if (items.some(x => !x.sellPrice))      return toast.error('กรุณากรอกราคาขายให้ครบทุกรายการ')
    if (payType === 'installment') {
      if (!installFirst)                    return toast.error('กรุณากรอกยอดชำระงวดแรก')
      if (firstNum > totalSell)             return toast.error('ยอดชำระงวดแรกมากกว่ายอดรวม')
    }
    if (isSplitPay) {
      if (splitTotal <= 0)                  return toast.error('กรุณาระบุยอดโอนหรือเงินสด')
      if (splitTotal !== paymentTarget)     return toast.error(`ยอดแบ่งจ่ายต้องรวมเท่ากับ ฿${fmt(paymentTarget)}`)
    }

    setSaving(true)
    try {
      const now      = saleDate ? new Date(saleDate).toISOString() : new Date().toISOString()
      const warranty = new Date(new Date(now).getTime() + 15*86400000).toISOString()
      const note     = customerNote.trim() || null
      const txIds    = []

      const batchId = items.length > 1 ? crypto.randomUUID() : null

      const batchPrefix = batchId ? `ขายรวม ${items.length} ชิ้น` : null

      // อ่าน balance ก่อนทำรายการ
      const { data: balBulk } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
      let runBank = Number(balBulk?.bank || 0)
      let runCash = Number(balBulk?.cash || 0)

      if (payType === 'full') {
        const splitUsed = { bank: 0, cash: 0 }
        let paidSoFar = 0
        for (let i = 0; i < items.length; i++) {
          const x = items[i]
          const price = Number(x.sellPrice)
          const pay = paymentForProduct(price, i, items.length, paidSoFar, splitUsed, totalSell)
          paidSoFar += pay.amount
          splitUsed.bank += pay.bank
          splitUsed.cash += pay.cash
          runBank += pay.bank
          runCash += pay.cash

          const { error: e1 } = await supabase.from('products').update({
            status: 'Sold', sold_price: price, sold_date: now,
            warranty_expiry: warranty, payment_method: productPayMethod,
            customer_note: note, sale_batch_id: batchId,
          }).eq('id', x.product.id)
          if (e1) throw e1

          const txNote = [
            batchPrefix,
            `${x.product.model} SN:${x.product.serial_number}`,
            `ราคา ฿${fmt(price)}`,
          ].filter(Boolean).join(' | ')

          const { data: tx, error: e2 } = await supabase.from('transactions').insert({
            date: now, type: 'Income', category: 'Sale',
            amount: price, product_id: x.product.id,
            payment_method: productPayMethod, note: txNote,
            bank_amount: isSplitPay ? pay.bank : null,
            cash_amount: isSplitPay ? pay.cash : null,
          }).select().single()
          if (e2) throw e2
          txIds.push(tx.id)
          try { await supabase.from('transactions').update({ bank_after: runBank, cash_after: runCash }).eq('id', tx.id) } catch(_) {}
        }

        await supabase.from('balances').update({ bank: runBank, cash: runCash, updated_at: now }).eq('id','main')

      } else {
        // Installment — distribute first payment proportionally across products
        let paidSoFar = 0
        const splitUsed = { bank: 0, cash: 0 }
        for (let i = 0; i < items.length; i++) {
          const x     = items[i]
          const price = Number(x.sellPrice)
          const pay = paymentForProduct(price, i, items.length, paidSoFar, splitUsed, firstNum)
          const productFirstPaid = pay.amount
          paidSoFar += productFirstPaid
          splitUsed.bank += pay.bank
          splitUsed.cash += pay.cash
          runBank += pay.bank
          runCash += pay.cash

          const newStatus = productFirstPaid >= price ? 'Sold' : 'Pending'

          const { error: e1 } = await supabase.from('products').update({
            status:            newStatus,
            sold_price:        newStatus === 'Sold' ? price : null,
            sold_date:         newStatus === 'Sold' ? now : null,
            warranty_expiry:   newStatus === 'Sold' ? warranty : null,
            payment_method:    productPayMethod,
            customer_note:     note,
            installment_total: price,
            installment_paid:  productFirstPaid,
            sale_batch_id:     batchId,
          }).eq('id', x.product.id)
          if (e1) throw e1

          const txNote = newStatus === 'Sold'
            ? [batchPrefix, `${x.product.model} SN:${x.product.serial_number}`, `ราคา ฿${fmt(price)} | ชำระครบ`].filter(Boolean).join(' | ')
            : [
                batchPrefix ? `${batchPrefix} ผ่อนจ่าย` : 'ผ่อนจ่าย',
                `${x.product.model} SN:${x.product.serial_number}`,
                `ราคาตกลง ฿${fmt(price)}`,
                `งวดแรก ฿${fmt(productFirstPaid)}`,
                `คงเหลือ ฿${fmt(price - productFirstPaid)}`,
              ].filter(Boolean).join(' | ')

          const { data: tx, error: e2 } = await supabase.from('transactions').insert({
            date: now, type: 'Income', category: 'Sale',
            amount: productFirstPaid, product_id: x.product.id,
            payment_method: productPayMethod, note: txNote,
            bank_amount: isSplitPay ? pay.bank : null,
            cash_amount: isSplitPay ? pay.cash : null,
          }).select().single()
          if (e2) throw e2
          txIds.push(tx.id)
          try { await supabase.from('transactions').update({ bank_after: runBank, cash_after: runCash }).eq('id', tx.id) } catch(_) {}
        }

        await supabase.from('balances').update({ bank: runBank, cash: runCash, updated_at: now }).eq('id','main')
      }

      // Upload receipt images to first transaction
      if (imgFiles.length && txIds[0]) {
        const urls = await uploadReceiptImages(supabase, txIds[0], imgFiles)
        await supabase.from('transactions').update({ images: urls }).eq('id', txIds[0])
      }

      toast.success(`ขายสำเร็จ ${items.length} รายการ!`)
      navigate('/inventory')
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const canSubmit = items.length > 0 && items.every(x=>x.sellPrice) &&
    (payType === 'full' || installFirst)

  return (
    <div>
      <div className="liquid-sub-header flex items-center gap-3 px-4 py-3">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24}/></button>
        <h1 className="font-bold text-lg flex items-center gap-2">
          <ShoppingCart size={20} className="text-amber-500"/>ขายสินค้ารวม
        </h1>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* Date */}
        <div className="card">
          <label className="text-xs text-gray-500 mb-1 block font-medium">วันที่และเวลาขาย</label>
          <ThaiDatePicker value={saleDate} onChange={setSaleDate} showTime className="input w-full"/>
        </div>

        {/* Product selection */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">
              {items.length || '?'}
            </span>
            <h2 className="font-semibold">สินค้าที่ขาย</h2>
          </div>

          {/* Selected items */}
          {items.map((x, idx) => {
            const cost = Number(x.product.total_cost||0)
            const sell = Number(x.sellPrice||0)
            const prof = sell - cost
            return (
              <div key={x.product.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{x.product.model}</p>
                    <p className="text-xs text-gray-400">SN: {x.product.serial_number} · ต้นทุน ฿{fmt(cost)}</p>
                  </div>
                  <button onClick={()=>removeItem(idx)} className="text-gray-400 p-1 flex-shrink-0 ml-2"><X size={15}/></button>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ราคาขาย (บาท) *</label>
                  <input autoComplete="off" className="input text-sm py-1.5" type="number" placeholder="0"
                    value={x.sellPrice} onChange={e=>updatePrice(idx,e.target.value)}/>
                  {x.sellPrice && (
                    <div className="flex justify-between mt-1 text-xs">
                      <span className="text-gray-400">กำไร = ฿{fmt(sell)} - ฿{fmt(cost)}</span>
                      <span className={`font-bold ${profitColor(prof)}`}>{prof>=0?'+':''}฿{fmt(prof)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Search to add */}
          <div className="space-y-2">
            {items.length > 0 && <p className="text-xs text-gray-400 font-medium">ค้นหาเพิ่มเติม</p>}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoComplete="off" className="input pl-9 text-sm" placeholder="ค้นหารุ่นหรือ Serial..."
                value={search} onChange={e=>{setSearch(e.target.value);loadProducts(e.target.value)}}/>
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1.5">
              {loading
                ? <p className="text-xs text-center text-gray-400 py-4">กำลังโหลด...</p>
                : displayProds.length===0
                  ? <p className="text-xs text-center text-gray-400 py-4">ไม่พบสินค้า</p>
                  : displayProds.map(p=>(
                      <button key={p.id} onClick={()=>addItem(p)}
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

        {/* Payment info — shown only after selecting items */}
        {items.length > 0 && (
          <div className="card space-y-3">
            <h2 className="font-semibold">ข้อมูลการชำระเงิน</h2>

            {/* Payment type */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">ประเภทการชำระ</p>
              <div className="flex gap-2">
                {[['full','เต็มจำนวน'],['installment','ผ่อนจ่าย']].map(([v,l])=>(
                  <button key={v} onClick={()=>setPayType(v)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                      ${payType===v?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Installment fields */}
            {payType === 'installment' && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ยอดตกลงรวม</label>
                  <p className="text-sm font-bold text-orange-700">฿{fmt(totalSell)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ชำระงวดแรก (บาท) *</label>
                  <input autoComplete="off" className="input text-sm" type="number" placeholder="0"
                    value={installFirst} onChange={e=>setInstallFirst(e.target.value)}/>
                  {installFirst && (
                    <div className="flex justify-between mt-1.5 text-xs">
                      <span className="text-gray-500">คงเหลือที่ต้องชำระ</span>
                      <span className={`font-bold ${remaining > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        ฿{fmt(remaining)}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-orange-600/70">สินค้าแต่ละรายการจะแสดงเป็น "รอชำระ" และสามารถรับชำระต่อได้ในหน้ารายละเอียดสินค้า</p>
              </div>
            )}

            {/* Payment method */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">ช่องทางชำระ</p>
              <div className="flex gap-2">
                {['โอน','เงินสด','แบ่งจ่าย'].map(m=>(
                  <button key={m} onClick={()=>{setPayMethod(m);setBankAmount('');setCashAmount('')}}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                      ${payMethod===m?(m==='โอน'?'bg-blue-600 text-white border-blue-600':m==='เงินสด'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red'):'bg-white text-gray-400 border-gray-200'}`}>
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
                  <p className={`col-span-2 text-xs font-medium ${splitTotal === paymentTarget ? 'text-green-600' : 'text-orange-600'}`}>
                    รวมแบ่งจ่าย ฿{fmt(splitTotal)} / ต้องเท่ากับ ฿{fmt(paymentTarget)}
                  </p>
                </div>
              )}
            </div>

            {/* Customer note */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ชื่อ / เบอร์โทร / หมายเหตุลูกค้า</label>
              <input autoComplete="off" className="input text-sm" placeholder="ไม่บังคับ..."
                value={customerNote} onChange={e=>setCustomerNote(e.target.value)}/>
            </div>
          </div>
        )}

        {/* Summary card */}
        {items.length > 0 && totalSell > 0 && (
          <div className="card bg-brand-dark space-y-2">
            <p className="text-white/50 text-xs font-medium">สรุปการขาย</p>
            {items.map(x => {
              const prof = Number(x.sellPrice||0) - Number(x.product.total_cost||0)
              return (
                <div key={x.product.id} className="flex justify-between items-center text-sm">
                  <span className="text-white/70 truncate max-w-[50%]">{x.product.model}</span>
                  <div className="flex gap-3 items-center">
                    <span className="text-white/40 text-xs">฿{fmt(Number(x.sellPrice||0))}</span>
                    <span className={`text-xs font-semibold ${profitColor(prof)}`}>{prof>=0?'+':''}฿{fmt(prof)}</span>
                  </div>
                </div>
              )
            })}
            <div className="border-t border-white/10 pt-2 flex justify-between items-center">
              <span className="text-white/60 text-sm">รวม {items.length} ชิ้น</span>
              <span className="font-bold text-brand-yellow text-xl">฿{fmt(totalSell)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/40 text-xs">กำไรรวม</span>
              <span className={`text-sm font-bold ${profitColor(totalProfit)}`}>
                {totalProfit>=0?'+':''}฿{fmt(totalProfit)}
              </span>
            </div>
            {payType === 'installment' && installFirst && (
              <div className="bg-orange-500/20 rounded-xl p-2.5 flex justify-between items-center mt-1">
                <span className="text-orange-300 text-xs">รับงวดแรก</span>
                <span className="text-orange-200 font-bold">฿{fmt(firstNum)}</span>
              </div>
            )}
            {isSplitPay && (
              <div className="bg-white/10 rounded-xl p-2.5 flex justify-between items-center mt-1 text-xs">
                <span className="text-white/50">แบ่งจ่าย</span>
                <span className="text-white/80 font-semibold">โอน ฿{fmt(splitBank)} + สด ฿{fmt(splitCash)}</span>
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

        <button onClick={doSell} disabled={saving||!canSubmit}
          className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50">
          <ShoppingCart size={18}/>
          {saving ? 'กำลังบันทึก...' : `ยืนยันการขาย${items.length > 0 ? ` (${items.length} รายการ)` : ''}`}
        </button>

      </div>
    </div>
  )
}
