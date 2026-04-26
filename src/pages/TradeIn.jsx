import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, Search, ArrowLeftRight, Plus, Minus } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = n => Number(n||0).toLocaleString('th-TH')
const CATEGORIES = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']

export default function TradeIn() {
  const navigate = useNavigate()

  // ── step: 'select' | 'form' | 'confirm'
  const [step, setStep] = useState('select')

  // สินค้าในสต็อกที่ลูกค้าเลือกเอาไป
  const [products,    setProducts]    = useState([])
  const [search,      setSearch]      = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [selectedOut, setSelectedOut] = useState(null) // สินค้าที่ลูกค้าเอาออก

  // สินค้าที่ลูกค้าเอามาแลก
  const [tradeForm, setTradeForm] = useState({
    model: '', serial_number: '', category: 'กล้องดิจิตอลเก่า',
    condition: 1, trade_value: '', notes: '',
  })

  // ช่องทางชำระส่วนต่าง
  const [payMethod, setPayMethod] = useState('โอน')
  const [saving,    setSaving]    = useState(false)

  // โหลดสินค้า Available
  const loadProducts = async (q) => {
    setLoadingList(true)
    let query = supabase.from('products').select('*').eq('status','Available').order('created_at',{ascending:false})
    if (q) query = query.or(`model.ilike.%${q}%,serial_number.ilike.%${q}%`)
    const { data } = await query
    setProducts(data||[])
    setLoadingList(false)
  }
  useState(() => { loadProducts('') }, [])

  const handleSearch = (e) => {
    setSearch(e.target.value)
    loadProducts(e.target.value)
  }

  // คำนวณส่วนต่าง
  const outPrice   = Number(selectedOut?.total_cost || 0)   // ราคาสินค้าที่ลูกค้าเอาออก (ต้นทุนร้าน = ราคาขาย)
  const tradeValue = Number(tradeForm.trade_value || 0)      // มูลค่าสินค้าที่ลูกค้าเอามา
  const diff       = outPrice - tradeValue                   // บวก = ลูกค้าต้องจ่ายเพิ่ม, ลบ = ร้านต้องคืนเงิน

  const doTradeIn = async () => {
    if (!selectedOut) return toast.error('กรุณาเลือกสินค้าที่ลูกค้าต้องการ')
    if (!tradeForm.model || !tradeForm.serial_number || !tradeForm.trade_value)
      return toast.error('กรุณากรอกข้อมูลสินค้าแลกให้ครบ')
    setSaving(true)
    try {
      const now = new Date().toISOString()

      // 1. รับสินค้าแลกเข้าสต็อก (สีน้ำเงิน is_trade_in=true)
      const tradeCost = Number(tradeForm.trade_value)
      const { data: tradeProduct, error: e1 } = await supabase.from('products').insert({
        model:         tradeForm.model.trim(),
        serial_number: tradeForm.serial_number.trim(),
        category:      tradeForm.category,
        condition:     Number(tradeForm.condition),
        base_cost:     tradeCost,
        total_cost:    tradeCost,
        status:        'Available',
        is_trade_in:   true,
        trade_ref_id:  selectedOut.id,
        notes:         tradeForm.notes || `รับแลกเปลี่ยนกับ ${selectedOut.model}`,
        created_at:    now,
        images:        [],
      }).select().single()
      if (e1) throw e1

      // 2. เปลี่ยนสินค้าในสต็อกเป็น Sold (แลกออกไป)
      const soldPrice = outPrice // ราคาขาย = ต้นทุนรวม (แลก 1:1 บวกส่วนต่าง)
      const warranty  = new Date(new Date(now).getTime()+15*86400000).toISOString()
      const { error: e2 } = await supabase.from('products').update({
        status:         'Sold',
        sold_price:     soldPrice,
        sold_date:      now,
        warranty_expiry: warranty,
        payment_method: diff > 0 ? payMethod : (diff < 0 ? payMethod : 'แลกเปลี่ยน'),
        trade_ref_id:   tradeProduct.id,
      }).eq('id', selectedOut.id)
      if (e2) throw e2

      // 3. บันทึก transaction แลกเปลี่ยน
      const txBase = {
        date: now,
        product_id: selectedOut.id,
        note: `แลกเปลี่ยน: ${selectedOut.model} ↔ ${tradeForm.model}`,
      }

      // transaction รับสินค้าแลกเข้า (Expense = ต้นทุนสินค้าที่รับมา)
      await supabase.from('transactions').insert({
        ...txBase,
        type: 'Expense', category: 'Buy Stock', amount: tradeCost,
        product_id: tradeProduct.id,
        note: `รับสินค้าแลก: ${tradeForm.model} SN:${tradeForm.serial_number}`,
      })

      // transaction ส่วนต่าง (ถ้ามี)
      if (diff !== 0) {
        await supabase.from('transactions').insert({
          ...txBase,
          type: diff > 0 ? 'Income' : 'Expense',
          category: 'Sale',
          amount: Math.abs(diff),
          payment_method: payMethod,
          note: diff > 0
            ? `ลูกค้าจ่ายเพิ่ม (แลกเปลี่ยน): ${selectedOut.model} ↔ ${tradeForm.model}`
            : `ร้านจ่ายคืนลูกค้า (แลกเปลี่ยน): ${selectedOut.model} ↔ ${tradeForm.model}`,
        })

        // อัปเดต balance
        const { data: bal } = await supabase.from('balances').select('*').eq('id','main').single()
        if (bal) {
          if (diff > 0) {
            // ลูกค้าจ่ายเพิ่ม → รับเงินเข้า
            const upd = payMethod === 'โอน'
              ? { bank: Number(bal.bank) + diff }
              : { cash: Number(bal.cash) + diff }
            await supabase.from('balances').update({...upd, updated_at: now}).eq('id','main')
          } else {
            // ร้านจ่ายคืน → เงินออก
            const amt = Math.abs(diff)
            const upd = payMethod === 'โอน'
              ? { bank: Math.max(0, Number(bal.bank) - amt) }
              : { cash: Math.max(0, Number(bal.cash) - amt) }
            await supabase.from('balances').update({...upd, updated_at: now}).eq('id','main')
          }
        }
      }

      toast.success('บันทึกการแลกเปลี่ยนสำเร็จ!')
      navigate('/inventory')
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-100 bg-white sticky top-0 z-10">
        <button onClick={() => navigate(-1)}><ChevronLeft size={24}/></button>
        <h1 className="font-bold text-lg flex items-center gap-2">
          <ArrowLeftRight size={20} className="text-blue-500"/>
          แลกเปลี่ยนสินค้า
        </h1>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ── Step 1: เลือกสินค้าที่ลูกค้าต้องการ ── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-brand-dark text-brand-yellow text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <h2 className="font-semibold">สินค้าที่ลูกค้าต้องการ (จากสต็อก)</h2>
          </div>

          {selectedOut ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-blue-800">{selectedOut.model}</p>
                <p className="text-xs text-blue-500">SN: {selectedOut.serial_number} | ต้นทุน ฿{fmt(selectedOut.total_cost)}</p>
              </div>
              <button onClick={() => setSelectedOut(null)} className="text-blue-400 p-1"><ChevronLeft size={16} className="rotate-180"/></button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input className="input pl-9 text-sm" placeholder="ค้นหารุ่นหรือ Serial..."
                  value={search} onChange={handleSearch}/>
              </div>
              <div className="max-h-52 overflow-y-auto space-y-1.5">
                {loadingList
                  ? <p className="text-xs text-center text-gray-400 py-4">กำลังโหลด...</p>
                  : products.length === 0
                    ? <p className="text-xs text-center text-gray-400 py-4">ไม่พบสินค้า</p>
                    : products.map(p => (
                        <button key={p.id} onClick={() => setSelectedOut(p)}
                          className="w-full text-left bg-gray-50 hover:bg-amber-50 rounded-xl px-3 py-2.5 transition-colors border border-transparent hover:border-amber-200">
                          <p className="font-medium text-sm">{p.model}</p>
                          <div className="flex justify-between mt-0.5">
                            <p className="text-xs text-gray-400">SN: {p.serial_number}</p>
                            <p className="text-xs font-semibold text-amber-600">฿{fmt(p.total_cost)}</p>
                          </div>
                        </button>
                      ))
                }
              </div>
            </>
          )}
        </div>

        {/* ── Step 2: กรอกข้อมูลสินค้าแลก ── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-brand-dark text-brand-yellow text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
            <h2 className="font-semibold">สินค้าที่ลูกค้าเอามาแลก</h2>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">ชื่อรุ่น *</label>
            <input className="input" placeholder="เช่น Canon 600D" value={tradeForm.model}
              onChange={e => setTradeForm({...tradeForm, model: e.target.value})}/>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Serial Number *</label>
            <input className="input" placeholder="SN..." value={tradeForm.serial_number}
              onChange={e => setTradeForm({...tradeForm, serial_number: e.target.value})}/>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ประเภท</label>
            <select className="input" value={tradeForm.category}
              onChange={e => setTradeForm({...tradeForm, category: e.target.value})}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">เกรดสภาพ</label>
            <div className="flex gap-2">
              {[5,4,3,2,1].map(c => (
                <button key={c} onClick={() => setTradeForm({...tradeForm, condition: c})}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all
                    ${tradeForm.condition===c ? 'bg-brand-dark text-brand-yellow border-brand-dark' : 'bg-white text-gray-400 border-gray-200'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">มูลค่าที่รับแลก (บาท) *</label>
            <input className="input" type="number" placeholder="0" value={tradeForm.trade_value}
              onChange={e => setTradeForm({...tradeForm, trade_value: e.target.value})}/>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
            <input className="input" placeholder="สภาพ, อุปกรณ์ที่มาด้วย..." value={tradeForm.notes}
              onChange={e => setTradeForm({...tradeForm, notes: e.target.value})}/>
          </div>
        </div>

        {/* ── สรุปส่วนต่าง ── */}
        {selectedOut && tradeForm.trade_value && (
          <div className={`rounded-2xl p-4 border-2 space-y-3 ${
            diff > 0 ? 'bg-green-50 border-green-300'
            : diff < 0 ? 'bg-red-50 border-red-300'
            : 'bg-blue-50 border-blue-300'
          }`}>
            <h3 className="font-bold text-center text-base">สรุปการแลกเปลี่ยน</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">สินค้าร้าน ({selectedOut.model})</span>
                <span className="font-semibold">฿{fmt(outPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">มูลค่าสินค้าแลก ({tradeForm.model||'...'})</span>
                <span className="font-semibold">฿{fmt(tradeValue)}</span>
              </div>
              <div className="border-t border-current/20 pt-2 flex justify-between items-center">
                {diff > 0 ? (
                  <>
                    <span className="font-bold text-green-700 flex items-center gap-1"><Plus size={14}/>ลูกค้าต้องจ่ายเพิ่ม</span>
                    <span className="font-bold text-green-700 text-lg">฿{fmt(diff)}</span>
                  </>
                ) : diff < 0 ? (
                  <>
                    <span className="font-bold text-red-600 flex items-center gap-1"><Minus size={14}/>ร้านต้องจ่ายคืนลูกค้า</span>
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

            {diff !== 0 && (
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">ช่องทางชำระส่วนต่าง</label>
                <div className="flex gap-2">
                  {['โอน','เงินสด'].map(m => (
                    <button key={m} onClick={() => setPayMethod(m)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                        ${payMethod===m
                          ? m==='โอน' ? 'bg-blue-600 text-white border-blue-600' : 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':'💵 เงินสด'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ยืนยัน ── */}
        <button onClick={doTradeIn} disabled={saving || !selectedOut || !tradeForm.model || !tradeForm.serial_number || !tradeForm.trade_value}
          className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50">
          <ArrowLeftRight size={18}/>
          {saving ? 'กำลังบันทึก...' : 'ยืนยันการแลกเปลี่ยน'}
        </button>
      </div>
    </div>
  )
}
