import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toLocal } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, Search, ArrowLeftRight, Plus, Minus } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = n => Number(n||0).toLocaleString('th-TH')
const CATEGORIES = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const nowLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16) }

export default function TradeIn() {
  const navigate = useNavigate()

  // A = สินค้าร้านที่ลูกค้าเอาไป
  const [products,    setProducts]    = useState([])
  const [search,      setSearch]      = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [selectedOut, setSelectedOut] = useState(null)
  const [sellPriceA,  setSellPriceA]  = useState('')   // ราคาที่ขายได้จริง

  // B = สินค้าลูกค้าเอามาแลก
  const [tradeForm, setTradeForm] = useState({
    model: '', serial_number: '', category: 'กล้องดิจิตอลเก่า',
    condition: 1, buy_price: '', notes: '',
  })

  // ส่วนกลาง
  const [tradeDate, setTradeDate] = useState(nowLocal())
  const [payMethod, setPayMethod] = useState('โอน')
  const [saving,    setSaving]    = useState(false)

  const loadProducts = async (q='') => {
    setLoadingList(true)
    let query = supabase.from('products').select('*').eq('status','Available').order('created_at',{ascending:false})
    if (q) query = query.or(`model.ilike.%${q}%,serial_number.ilike.%${q}%`)
    const { data } = await query
    setProducts(data||[])
    setLoadingList(false)
  }
  useState(()=>{ loadProducts() },[])

  // A: กำไรจาก A = ราคาขาย - total_cost
  const totalCostA = Number(selectedOut?.total_cost || 0)
  const sellA      = Number(sellPriceA || 0)
  const profitA    = sellA - totalCostA

  // B: ต้นทุน B = ราคาที่รับซื้อมา
  const buyB    = Number(tradeForm.buy_price || 0)

  // ส่วนต่าง = ราคาขาย A - ราคารับซื้อ B
  // บวก = ลูกค้าต้องจ่ายเพิ่ม, ลบ = ร้านจ่ายคืน
  const diff = sellA - buyB

  const doTradeIn = async () => {
    if (!selectedOut)            return toast.error('กรุณาเลือกสินค้า A')
    if (!sellPriceA)             return toast.error('กรุณากรอกราคาขายสินค้า A')
    if (!tradeForm.model)        return toast.error('กรุณากรอกชื่อสินค้า B')
    if (!tradeForm.serial_number)return toast.error('กรุณากรอก Serial สินค้า B')
    if (!tradeForm.buy_price)    return toast.error('กรุณากรอกราคารับซื้อสินค้า B')

    setSaving(true)
    try {
      const now = tradeDate ? new Date(tradeDate).toISOString() : new Date().toISOString()
      const warranty = new Date(new Date(now).getTime()+15*86400000).toISOString()

      const tradeNote = [
        `🔄 แลกเปลี่ยน`,
        `A: ${selectedOut.model} SN:${selectedOut.serial_number} ขายได้ ฿${fmt(sellA)} (กำไร ${profitA>=0?'+':''}฿${fmt(profitA)})`,
        `B: ${tradeForm.model} SN:${tradeForm.serial_number} รับซื้อ ฿${fmt(buyB)}`,
        diff>0 ? `ลูกค้าจ่ายเพิ่ม ฿${fmt(diff)} (${payMethod})` : diff<0 ? `ร้านจ่ายคืน ฿${fmt(Math.abs(diff))} (${payMethod})` : `แลกเท่ากันพอดี`,
      ].join(' | ')

      // ── 1. เพิ่มสินค้า B เข้าสต็อก (is_trade_in=true) ──
      const { data: productB, error: e1 } = await supabase.from('products').insert({
        model:         tradeForm.model.trim(),
        serial_number: tradeForm.serial_number.trim(),
        category:      tradeForm.category,
        condition:     Number(tradeForm.condition),
        base_cost:     buyB,
        total_cost:    buyB,
        status:        'Available',
        is_trade_in:   true,
        trade_ref_id:  selectedOut.id,
        notes:         tradeForm.notes || tradeNote,
        created_at:    now,
        images:        [],
      }).select().single()
      if (e1) throw e1

      // ลบ Buy Stock ที่ trigger สร้างอัตโนมัติ (จะสร้างเองใน transaction รวม)
      await supabase.from('transactions').delete()
        .eq('product_id', productB.id).eq('category','Buy Stock')

      // ── 2. เปลี่ยนสถานะสินค้า A เป็น Sold ──
      const { error: e2 } = await supabase.from('products').update({
        status:          'Sold',
        sold_price:      sellA,
        sold_date:       now,
        warranty_expiry: warranty,
        payment_method:  payMethod,
        trade_ref_id:    productB.id,
      }).eq('id', selectedOut.id)
      if (e2) throw e2

      // ── 3. Transaction รวมอันเดียว สีน้ำเงิน (category='Trade') ──

      await supabase.from('transactions').insert({
        date:           now,
        type:           diff >= 0 ? 'Income' : 'Expense',
        category:       'Trade',
        amount:         Math.abs(diff) || sellA, // ถ้าเท่ากันพอดีให้บันทึกยอดขาย A
        product_id:     selectedOut.id,
        payment_method: payMethod,
        note:           tradeNote,
        // เก็บ sold_price A และ buy_price B ไว้สำหรับคำนวณกำไร
        trade_sell_a:   sellA,
        trade_buy_b:    buyB,
        trade_profit_a: profitA,
      })

      // ── 4. อัปเดต balance ──
      // รับเงินจากการขาย A เต็มจำนวน แล้วหัก B (ถ้าร้านจ่ายเพิ่ม)
      const { data: bal } = await supabase.from('balances').select('*').eq('id','main').single()
      if (bal) {
        let bank = Number(bal.bank)
        let cash = Number(bal.cash)

        if (diff > 0) {
          // ลูกค้าจ่ายเพิ่ม → รับเงินส่วนต่างเข้า
          if (payMethod==='โอน') bank += diff
          else cash += diff
        } else if (diff < 0) {
          // ร้านจ่ายคืนลูกค้า → เงินออก
          const amt = Math.abs(diff)
          if (payMethod==='โอน') bank = Math.max(0, bank - amt)
          else cash = Math.max(0, cash - amt)
        }
        // diff === 0 → แลกเท่ากันพอดี ไม่มีเงินเข้าออก

        await supabase.from('balances').update({bank, cash, updated_at:now}).eq('id','main')
      }

      toast.success('บันทึกการแลกเปลี่ยนสำเร็จ!')
      navigate('/inventory')
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const profitColor = p => p > 0 ? 'text-green-600' : p < 0 ? 'text-red-500' : 'text-gray-500'

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-100 bg-white sticky top-0 z-10">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24}/></button>
        <h1 className="font-bold text-lg flex items-center gap-2">
          <ArrowLeftRight size={20} className="text-blue-500"/>แลกเปลี่ยนสินค้า
        </h1>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* วันที่ */}
        <div className="card">
          <label className="text-xs text-gray-500 mb-1 block font-medium">วันที่และเวลาแลกเปลี่ยน</label>
          <ThaiDatePicker value={tradeDate} onChange={setTradeDate} showTime className="input w-full"/>
          <p className="text-xs text-gray-400 mt-1">หากไม่ระบุจะใช้เวลาปัจจุบัน</p>
        </div>

        {/* ── สินค้า A ── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-brand-dark text-brand-yellow text-xs font-bold flex items-center justify-center">A</span>
            <h2 className="font-semibold">สินค้าร้านที่ลูกค้าต้องการ</h2>
          </div>

          {selectedOut ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{selectedOut.model}</p>
                    <p className="text-xs text-gray-400">SN: {selectedOut.serial_number}</p>
                    <p className="text-xs text-gray-500 mt-0.5">ต้นทุน ฿{fmt(totalCostA)}</p>
                  </div>
                  <button onClick={()=>{ setSelectedOut(null); setSellPriceA('') }}
                    className="text-gray-400 p-1 text-lg">✕</button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ราคาที่ขายได้จริง (บาท) *</label>
                <input autoComplete="off" className="input" type="number" placeholder="0" value={sellPriceA}
                  onChange={e=>setSellPriceA(e.target.value)}/>
                {sellPriceA && (
                  <div className="flex justify-between mt-1.5 text-xs">
                    <span className="text-gray-400">กำไร A = ฿{fmt(sellA)} - ฿{fmt(totalCostA)}</span>
                    <span className={`font-bold ${profitColor(profitA)}`}>
                      {profitA>=0?'+':''}฿{fmt(profitA)}
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input autoComplete="off" className="input pl-9 text-sm" placeholder="ค้นหารุ่นหรือ Serial..."
                  value={search} onChange={e=>{ setSearch(e.target.value); loadProducts(e.target.value) }}/>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {loadingList
                  ? <p className="text-xs text-center text-gray-400 py-4">กำลังโหลด...</p>
                  : products.length===0
                    ? <p className="text-xs text-center text-gray-400 py-4">ไม่พบสินค้า</p>
                    : products.map(p=>(
                        <button key={p.id} onClick={()=>setSelectedOut(p)}
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
            </>
          )}
        </div>

        {/* ── สินค้า B ── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">B</span>
            <h2 className="font-semibold">สินค้าที่ลูกค้าเอามาแลก</h2>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">ชื่อรุ่น *</label>
            <input autoComplete="off" className="input" placeholder="เช่น Canon 600D" value={tradeForm.model}
              onChange={e=>setTradeForm({...tradeForm,model:e.target.value})}/>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Serial Number *</label>
            <input autoComplete="off" className="input" placeholder="SN..." value={tradeForm.serial_number}
              onChange={e=>setTradeForm({...tradeForm,serial_number:e.target.value})}/>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ประเภท</label>
            <select className="input" value={tradeForm.category}
              onChange={e=>setTradeForm({...tradeForm,category:e.target.value})}>
              {CATEGORIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">เกรดสภาพ</label>
            <div className="flex gap-2">
              {[5,4,3,2,1].map(c=>(
                <button key={c} onClick={()=>setTradeForm({...tradeForm,condition:c})}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all
                    ${tradeForm.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ราคารับซื้อ / มูลค่าแลก (บาท) *</label>
            <input autoComplete="off" className="input" type="number" placeholder="0" value={tradeForm.buy_price}
              onChange={e=>setTradeForm({...tradeForm,buy_price:e.target.value})}/>
            <p className="text-xs text-gray-400 mt-1">ราคานี้จะเป็นต้นทุนของสินค้า B ในสต็อก</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
            <input autoComplete="off" className="input" placeholder="สภาพ, อุปกรณ์ที่มาด้วย..." value={tradeForm.notes}
              onChange={e=>setTradeForm({...tradeForm,notes:e.target.value})}/>
          </div>
        </div>

        {/* ── สรุปการแลกเปลี่ยน ── */}
        {selectedOut && sellPriceA && tradeForm.buy_price && (
          <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 space-y-3">
            <h3 className="font-bold text-blue-800 flex items-center gap-2">
              <ArrowLeftRight size={16}/>สรุปการแลกเปลี่ยน
            </h3>

            <div className="space-y-2 text-sm">
              {/* A */}
              <div className="bg-white/70 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1 font-medium">A — {selectedOut.model}</p>
                <div className="flex justify-between">
                  <span className="text-gray-600">ราคาขาย</span>
                  <span className="font-semibold">฿{fmt(sellA)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">ต้นทุน</span>
                  <span className="text-gray-500">฿{fmt(totalCostA)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                  <span className="font-medium">กำไร A</span>
                  <span className={`font-bold ${profitColor(profitA)}`}>{profitA>=0?'+':''}฿{fmt(profitA)}</span>
                </div>
              </div>

              {/* B */}
              <div className="bg-white/70 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1 font-medium">B — {tradeForm.model||'...'}</p>
                <div className="flex justify-between">
                  <span className="text-gray-600">รับซื้อ (ต้นทุน)</span>
                  <span className="font-semibold">฿{fmt(buyB)}</span>
                </div>
                <p className="text-xs text-blue-500 mt-1">เข้าสต็อกเป็น Available สีน้ำเงิน</p>
              </div>

              {/* ส่วนต่าง */}
              <div className={`rounded-xl p-3 border-2 ${
                diff>0?'bg-green-50 border-green-300':diff<0?'bg-red-50 border-red-300':'bg-blue-50 border-blue-200'}`}>
                <div className="flex items-center justify-between">
                  {diff>0 ? (
                    <>
                      <span className="font-bold text-green-700 flex items-center gap-1"><Plus size={14}/>ลูกค้าต้องจ่ายเพิ่ม</span>
                      <span className="font-bold text-green-700 text-lg">฿{fmt(diff)}</span>
                    </>
                  ) : diff<0 ? (
                    <>
                      <span className="font-bold text-red-600 flex items-center gap-1"><Minus size={14}/>ร้านต้องจ่ายคืน</span>
                      <span className="font-bold text-red-600 text-lg">฿{fmt(Math.abs(diff))}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-blue-600">แลกเท่ากันพอดี</span>
                      <span className="font-bold text-blue-600 text-lg">฿0</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {diff !== 0 && (
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">ช่องทางชำระส่วนต่าง</label>
                <div className="flex gap-2">
                  {['โอน','เงินสด'].map(m=>(
                    <button key={m} onClick={()=>setPayMethod(m)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                        ${payMethod===m
                          ? m==='โอน'?'bg-blue-600 text-white border-blue-600':'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':'💵 เงินสด'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button onClick={doTradeIn}
          disabled={saving||!selectedOut||!sellPriceA||!tradeForm.model||!tradeForm.serial_number||!tradeForm.buy_price}
          className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50">
          <ArrowLeftRight size={18}/>
          {saving?'กำลังบันทึก...':'ยืนยันการแลกเปลี่ยน'}
        </button>

      </div>
    </div>
  )
}
