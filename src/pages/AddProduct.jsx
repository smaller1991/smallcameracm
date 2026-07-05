import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { uploadReceiptImages } from '../lib/imageUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, ImagePlus, X, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

const CATEGORIES = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']

const newItem    = () => ({ _id: Math.random(), category: 'กล้อง', model: '', serial_number: '', condition: 5, base_cost: '', notes: '' })
const newPayment = () => ({ _id: Math.random(), amount: '', method: 'โอน' })

export default function AddProduct() {
  const navigate = useNavigate()
  const [date, setDate]           = useState('')
  const [payments, setPayments]   = useState([newPayment()])
  const [imgFiles,    setImgFiles]    = useState([])
  const [imgPreviews, setImgPreviews] = useState([])
  const [items, setItems] = useState([newItem()])
  const [saving, setSaving] = useState(false)

  // ── receipt images ──────────────────────────────────────────
  const addImgFiles = files => {
    setImgFiles(p => [...p, ...files])
    setImgPreviews(p => [...p, ...files.map(f => URL.createObjectURL(f))])
  }
  const removeImg = i => {
    URL.revokeObjectURL(imgPreviews[i])
    setImgFiles(f => f.filter((_,j) => j !== i))
    setImgPreviews(p => p.filter((_,j) => j !== i))
  }

  // ── item list ───────────────────────────────────────────────
  const setField = (_id, k, v) => setItems(prev => prev.map(it => it._id === _id ? { ...it, [k]: v } : it))
  const addItem  = () => setItems(prev => [...prev, newItem()])
  const removeItem = _id => setItems(prev => prev.filter(it => it._id !== _id))

  // ── payment splits ──────────────────────────────────────────
  const setPayField = (_id, k, v) => setPayments(prev => prev.map(p => p._id === _id ? { ...p, [k]: v } : p))
  const addPayment    = () => setPayments(prev => [...prev, newPayment()])
  const removePayment = _id => setPayments(prev => prev.filter(p => p._id !== _id))

  const totalCost = items.reduce((s, it) => s + (parseFloat(it.base_cost) || 0), 0)
  const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
  const remaining = Math.max(0, totalCost - totalPaid)

  // ── save ────────────────────────────────────────────────────
  const save = async () => {
    for (const it of items) {
      if (!it.serial_number.trim() || !it.model.trim() || !it.base_cost) {
        return toast.error('กรุณากรอก ชื่อรุ่น, Serial Number และราคาซื้อ ให้ครบทุกรายการ')
      }
    }
    const validPayments = payments.filter(p => parseFloat(p.amount) > 0)
    if (validPayments.length === 0) {
      return toast.error('กรุณากรอกจำนวนเงินที่ชำระอย่างน้อย 1 รายการ')
    }

    setSaving(true)
    try {
      const txDate  = date ? new Date(date).toISOString() : new Date().toISOString()
      const isMulti = items.length > 1
      const batchId = isMulti ? crypto.randomUUID() : null

      let receiptUrls = []
      if (imgFiles.length) {
        receiptUrls = await uploadReceiptImages(supabase, `batch_${Date.now()}`, imgFiles)
      }

      // create all products
      const created = []
      for (const it of items) {
        const cost = parseFloat(it.base_cost)
        const { data: p, error: pErr } = await supabase.from('products').insert({
          serial_number: it.serial_number.trim(),
          model: it.model.trim(),
          condition: Number(it.condition),
          base_cost: cost, total_cost: cost,
          notes: it.notes,
          category: it.category,
          created_at: txDate,
          ...(batchId ? { batch_id: batchId } : {}),
        }).select().single()
        if (pErr) throw pErr
        created.push({ ...p, _cost: cost })
      }

      // คำนวณยอดหักตามช่องทางชำระ
      const bankDeduct = validPayments.filter(p => p.method === 'โอน').reduce((s,p) => s + parseFloat(p.amount), 0)
      const cashDeduct = validPayments.filter(p => p.method === 'เงินสด').reduce((s,p) => s + parseFloat(p.amount), 0)
      const isSplitTender = bankDeduct > 0 && cashDeduct > 0

      const { data: bal } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
      const bank_after = Math.max(0, Number(bal?.bank||0) - bankDeduct)
      const cash_after = Math.max(0, Number(bal?.cash||0) - cashDeduct)

      // สรุปช่องทางชำระสำหรับโน้ต
      const methods = [...new Set(validPayments.map(p => p.method))]
      const paymentMethod = methods.length === 1 ? methods[0] : (bankDeduct >= cashDeduct ? 'โอน' : 'เงินสด')

      const payBreakdown = validPayments.map(p =>
        `  • ${p.method === 'โอน' ? '💳 โอน' : '💵 เงินสด'} ฿${parseFloat(p.amount).toLocaleString('th-TH')}`
      ).join('\n')

      const remainNote = remaining > 0 ? `\n⚠️ ค้างจ่าย ฿${remaining.toLocaleString('th-TH')}` : ''

      // สร้าง transaction
      if (isMulti) {
        const noteLines = created.map((p, i) =>
          `${i + 1}. ${p.model}  SN:${p.serial_number}  ฿${Number(p._cost).toLocaleString('th-TH')}`
        ).join('\n')
        const note = `ซื้อสินค้า ${items.length} รายการ:\n${noteLines}\n\nการชำระ:\n${payBreakdown}${remainNote}`
        const { data: tx, error: txErr } = await supabase.from('transactions').insert({
          type: 'Expense', category: 'Buy Stock',
          amount: totalPaid,
          product_id: created[0].id,
          payment_method: paymentMethod,
          bank_amount: isSplitTender ? bankDeduct : null,
          cash_amount: isSplitTender ? cashDeduct : null,
          date: txDate,
          note,
          images: receiptUrls.length ? receiptUrls : null,
        }).select().single()
        if (txErr) throw txErr
        if (tx) { try { await supabase.from('transactions').update({ bank_after, cash_after }).eq('id', tx.id) } catch(_) {} }
      } else {
        const p = created[0]
        const note = `ซื้อสินค้า: ${p.model} SN:${p.serial_number}\n\nการชำระ:\n${payBreakdown}${remainNote}`
        const { data: tx, error: txErr } = await supabase.from('transactions').insert({
          type: 'Expense', category: 'Buy Stock',
          amount: totalPaid,
          product_id: p.id,
          payment_method: paymentMethod,
          bank_amount: isSplitTender ? bankDeduct : null,
          cash_amount: isSplitTender ? cashDeduct : null,
          date: txDate,
          note,
          images: receiptUrls.length ? receiptUrls : null,
        }).select().single()
        if (txErr) throw txErr
        if (tx) { try { await supabase.from('transactions').update({ bank_after, cash_after }).eq('id', tx.id) } catch(_) {} }
      }

      await supabase.from('balances').update({ bank: bank_after, cash: cash_after, updated_at: new Date().toISOString() }).eq('id','main')

      // อัปเดต bank_after/cash_after ของรายการก่อนหน้า เพื่อให้หน้าบัญชีคำนวณย้อนหลังได้แม่นยำ
      // (bal.bank/cash = ยอดก่อนหักซื้อสินค้า = bank_after ที่ถูกต้องของรายการก่อนหน้า)
      try {
        const { data: prevTx } = await supabase.from('transactions')
          .select('id').order('date', { ascending: false }).limit(2)
        if (prevTx && prevTx.length === 2) {
          await supabase.from('transactions')
            .update({ bank_after: Number(bal?.bank||0), cash_after: Number(bal?.cash||0) })
            .eq('id', prevTx[1].id)
        }
      } catch(_) {}

      const label = isMulti ? `${items.length} รายการ` : created[0].model
      const paidLabel = remaining > 0 ? `ชำระ ฿${totalPaid.toLocaleString('th-TH')} (ค้าง ฿${remaining.toLocaleString('th-TH')})` : `฿${totalPaid.toLocaleString('th-TH')}`
      toast.success(`เพิ่มสินค้าสำเร็จ — ${label} ${paidLabel}`)
      navigate('/inventory')
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="liquid-sub-header flex items-center gap-3 px-4 py-3">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24} className="text-brand-dark"/></button>
        <h1 className="font-bold text-brand-dark text-lg">รับสินค้าเข้าสต็อก</h1>
      </div>

      <div className="px-4 py-4 space-y-5">

        {/* ── shared header ── */}
        <div className="space-y-4 pb-4 border-b border-amber-100">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">วันที่รับเข้า</label>
            <ThaiDatePicker value={date} onChange={setDate} showTime className="input w-full"/>
            <p className="text-xs text-gray-400 mt-1">หากไม่ระบุจะใช้วันที่และเวลาปัจจุบัน</p>
          </div>

          {/* ── payment splits ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-600">การชำระเงิน</label>
              <button onClick={addPayment}
                className="flex items-center gap-1 text-xs text-blue-500 font-semibold py-1 px-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors">
                <Plus size={12}/>แบ่งชำระ
              </button>
            </div>

            <div className="space-y-2">
              {payments.map((pay, idx) => (
                <div key={pay._id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">{idx+1}.</span>
                  <input
                    autoComplete="off"
                    className="input flex-1 min-w-0"
                    type="number"
                    placeholder="จำนวนเงิน"
                    value={pay.amount}
                    onChange={e => setPayField(pay._id, 'amount', e.target.value)}
                  />
                  <div className="flex gap-1 flex-shrink-0">
                    {['โอน','เงินสด'].map(m => (
                      <button key={m} onClick={() => setPayField(pay._id, 'method', m)}
                        className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap
                          ${pay.method===m
                            ? (m==='โอน' ? 'bg-blue-500 text-white border-blue-500' : 'bg-green-600 text-white border-green-600')
                            : 'bg-white text-gray-400 border-gray-200'}`}>
                        {m==='โอน' ? '💳' : '💵'} {m}
                      </button>
                    ))}
                  </div>
                  {payments.length > 1 && (
                    <button onClick={() => removePayment(pay._id)} className="text-red-400 hover:text-red-600 flex-shrink-0 p-1">
                      <X size={14}/>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* payment summary */}
            {totalCost > 0 && (
              <div className="mt-3 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>ต้นทุนรวม</span>
                  <span className="font-semibold">฿{totalCost.toLocaleString('th-TH')}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>ชำระแล้ว</span>
                  <span className="font-semibold text-blue-600">฿{totalPaid.toLocaleString('th-TH')}</span>
                </div>
                {remaining > 0 && (
                  <div className="flex justify-between text-red-500 font-semibold border-t border-gray-200 pt-1 mt-1">
                    <span>ค้างจ่าย</span>
                    <span>฿{remaining.toLocaleString('th-TH')}</span>
                  </div>
                )}
                {remaining === 0 && totalPaid > 0 && (
                  <div className="flex justify-between text-green-600 font-semibold border-t border-gray-200 pt-1 mt-1">
                    <span>ชำระครบแล้ว</span>
                    <span>✓</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">รูปใบเสร็จ / หลักฐานการซื้อ</label>
            <div className="flex gap-2 flex-wrap">
              {imgPreviews.map((src,i)=>(
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-amber-200 flex-shrink-0">
                  <img src={src} className="w-full h-full object-cover"/>
                  <button onClick={()=>removeImg(i)} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <X size={11} className="text-white"/>
                  </button>
                </div>
              ))}
              <label className="w-20 h-20 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
                <ImagePlus size={18} className="text-amber-400"/>
                <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
                <input type="file" multiple accept="image/*" className="hidden" onChange={e=>addImgFiles(Array.from(e.target.files))}/>
              </label>
            </div>
          </div>
        </div>

        {/* ── item list ── */}
        <div className="space-y-4">
          {items.map((it, idx) => (
            <div key={it._id} className="border border-amber-200 rounded-2xl p-4 space-y-3 bg-amber-50/40">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500">สินค้า #{idx + 1}</span>
                {items.length > 1 && (
                  <button onClick={()=>removeItem(it._id)} className="text-red-400 hover:text-red-600 p-1">
                    <Trash2 size={15}/>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ประเภทสินค้า</label>
                <select className="input" value={it.category} onChange={e=>setField(it._id,'category',e.target.value)}>
                  {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ชื่อรุ่น *</label>
                <input autoComplete="off" className="input" placeholder="เช่น Fujifilm X100V" value={it.model} onChange={e=>setField(it._id,'model',e.target.value)}/>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Serial Number *</label>
                <input autoComplete="off" className="input" placeholder="SN..." value={it.serial_number} onChange={e=>setField(it._id,'serial_number',e.target.value)}/>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">เกรดสภาพ</label>
                <div className="flex gap-2">
                  {[5,4,3,2,1].map(c=>(
                    <button key={c} onClick={()=>setField(it._id,'condition',c)}
                      className={`flex-1 py-1.5 rounded-xl text-sm font-semibold border transition-all ${it.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-500 border-gray-200'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ราคาซื้อ (บาท) *</label>
                <input autoComplete="off" className="input" type="number" placeholder="0" value={it.base_cost} onChange={e=>setField(it._id,'base_cost',e.target.value)}/>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">หมายเหตุ</label>
                <input autoComplete="off" className="input" placeholder="(ไม่บังคับ)" value={it.notes} onChange={e=>setField(it._id,'notes',e.target.value)}/>
              </div>
            </div>
          ))}

          <button onClick={addItem}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-amber-300 text-amber-500 hover:border-brand-yellow hover:text-brand-yellow transition-colors flex items-center justify-center gap-2 text-sm font-semibold">
            <Plus size={16}/>เพิ่มสินค้าอีกชิ้น
          </button>
        </div>

        {/* ── save ── */}
        <button onClick={save} disabled={saving} className="btn-primary w-full py-3 text-base disabled:opacity-60">
          {saving ? 'กำลังบันทึก...' : `✓ บันทึก${items.length > 1 ? ` ${items.length} รายการ` : 'สินค้า'}`}
        </button>
      </div>
    </div>
  )
}
