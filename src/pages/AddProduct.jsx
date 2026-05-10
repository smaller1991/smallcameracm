import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { uploadReceiptImages } from '../lib/imageUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, ImagePlus, X, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

const CATEGORIES = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']

const newItem = () => ({ _id: Math.random(), category: 'กล้อง', model: '', serial_number: '', condition: 5, base_cost: '', notes: '' })

export default function AddProduct() {
  const navigate = useNavigate()
  const [date, setDate]           = useState('')
  const [payMethod, setPayMethod] = useState('โอน')
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

  const totalCost = items.reduce((s, it) => s + (parseFloat(it.base_cost) || 0), 0)

  // ── save ────────────────────────────────────────────────────
  const save = async () => {
    for (const it of items) {
      if (!it.serial_number.trim() || !it.model.trim() || !it.base_cost) {
        return toast.error('กรุณากรอก ชื่อรุ่น, Serial Number และราคาซื้อ ให้ครบทุกรายการ')
      }
    }
    setSaving(true)
    try {
      const txDate  = date ? new Date(date).toISOString() : new Date().toISOString()
      const isMulti = items.length > 1
      const batchId = isMulti ? crypto.randomUUID() : null

      // upload receipt images once (shared across all items)
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

      if (isMulti) {
        // ONE shared transaction — no product_id, note lists all items
        const noteLines = created.map((p, i) =>
          `${i + 1}. ${p.model}  SN:${p.serial_number}  ฿${Number(p._cost).toLocaleString('th-TH')}`
        ).join('\n')
        const { error: txErr } = await supabase.from('transactions').insert({
          type: 'Expense', category: 'Buy Stock',
          amount: totalCost,
          product_id: null,
          payment_method: payMethod,
          date: txDate,
          note: `ซื้อสินค้า ${items.length} รายการ:\n${noteLines}`,
          images: receiptUrls.length ? receiptUrls : null,
        })
        if (txErr) throw txErr
      } else {
        // single item — link transaction to product as usual
        const p = created[0]
        const { error: txErr } = await supabase.from('transactions').insert({
          type: 'Expense', category: 'Buy Stock', amount: p._cost,
          product_id: p.id, payment_method: payMethod,
          date: txDate,
          note: `ซื้อสินค้า: ${p.model} SN:${p.serial_number}`,
          images: receiptUrls.length ? receiptUrls : null,
        })
        if (txErr) throw txErr
      }

      // deduct total from balance
      const { data: bal } = await supabase.from('balances').select('*').eq('id','main').single()
      if (bal) {
        const upd = payMethod === 'โอน'
          ? { bank: Math.max(0, Number(bal.bank) - totalCost) }
          : { cash: Math.max(0, Number(bal.cash) - totalCost) }
        await supabase.from('balances').update({ ...upd, updated_at: new Date().toISOString() }).eq('id','main')
      }

      const label = isMulti ? `${items.length} รายการ` : created[0].model
      toast.success(`เพิ่มสินค้าสำเร็จ — ${label} หัก${payMethod} ฿${totalCost.toLocaleString('th-TH')}`)
      navigate('/inventory')
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-100 bg-white sticky top-0 z-10">
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

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">ช่องทางการชำระ</label>
            <div className="flex gap-2">
              {['โอน','เงินสด'].map(m=>(
                <button key={m} onClick={()=>setPayMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                    ${payMethod===m?(m==='โอน'?'bg-blue-500 text-white border-blue-500':'bg-green-600 text-white border-green-600'):'bg-white text-gray-400 border-gray-200'}`}>
                  {m==='โอน'?'💳 โอน':'💵 เงินสด'}
                </button>
              ))}
            </div>
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

        {/* ── summary + save ── */}
        {items.length > 1 && (
          <div className="flex justify-between text-sm font-semibold text-gray-700 px-1">
            <span>รวม {items.length} รายการ</span>
            <span>฿{totalCost.toLocaleString('th-TH')}</span>
          </div>
        )}

        <button onClick={save} disabled={saving} className="btn-primary w-full py-3 text-base disabled:opacity-60">
          {saving ? 'กำลังบันทึก...' : `✓ บันทึก${items.length > 1 ? ` ${items.length} รายการ` : 'สินค้า'}`}
        </button>
      </div>
    </div>
  )
}
