import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Edit2, X, Check, TrendingUp, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'

const CATS = ['Buy Stock','Add-on','Sale','Rent','Marketing','Operating','Other']
const fmt  = n => Number(n || 0).toLocaleString('th-TH')
const thDate = d => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
const toLocal = iso => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16) }
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16) }

export default function Finance() {
  const [txs,    setTxs]    = useState([])
  const [loading,setLoading]= useState(true)
  const [showForm,setShowForm]=useState(false)
  const [editId, setEditId] = useState(null)
  const [form,   setForm]   = useState({ type:'Expense', category:'Operating', amount:'', note:'', date: nowLocal() })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('transactions').select('*, products(model)').order('date', { ascending: false })
    setTxs(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const income  = txs.filter(t => t.type === 'Income').reduce((a,t) => a + Number(t.amount), 0)
  const expense = txs.filter(t => t.type === 'Expense').reduce((a,t) => a + Number(t.amount), 0)
  const net = income - expense

  const openAdd = () => {
    setEditId(null)
    setForm({ type:'Expense', category:'Operating', amount:'', note:'', date: nowLocal() })
    setShowForm(true)
  }
  const openEdit = tx => {
    setEditId(tx.id)
    setForm({ type: tx.type, category: tx.category, amount: tx.amount, note: tx.note || '', date: toLocal(tx.date) })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.amount) return toast.error('กรุณาระบุจำนวนเงิน')
    setSaving(true)
    try {
      const payload = { type: form.type, category: form.category, amount: parseFloat(form.amount), note: form.note, date: new Date(form.date).toISOString() }
      if (editId) {
        await supabase.from('transactions').update(payload).eq('id', editId)
        toast.success('แก้ไขแล้ว')
      } else {
        await supabase.from('transactions').insert(payload)
        toast.success('เพิ่มรายการแล้ว')
      }
      setShowForm(false); setEditId(null); load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const del = async id => {
    if (!confirm('ลบรายการนี้?')) return
    await supabase.from('transactions').delete().eq('id', id)
    toast.success('ลบแล้ว'); load()
  }

  return (
    <div>
      {/* Summary */}
      <div className="bg-brand-dark px-4 pt-4 pb-4">
        <p className="text-white/50 text-xs mb-2">สรุปทั้งหมด</p>
        <div className="flex gap-2">
          {[
            { label:'รายรับ',  value: income,        color:'text-green-400' },
            { label:'รายจ่าย', value: expense,        color:'text-red-400' },
            { label:'กำไร',    value: Math.abs(net), color: net>=0?'text-brand-yellow':'text-red-400', prefix: net<0?'-':'' },
          ].map(({ label, value, color, prefix='' }) => (
            <div key={label} className="flex-1 bg-white/8 rounded-xl p-3 text-center" style={{ background:'rgba(255,255,255,0.08)' }}>
              <p className="text-white/50 text-xs">{label}</p>
              <p className={`font-bold text-sm mt-1 ${color}`}>{prefix}฿{fmt(value)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 flex justify-between items-center border-b border-amber-100">
        <p className="text-sm text-gray-500">{txs.length} รายการ</p>
        <button onClick={openAdd} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1">
          <Plus size={15}/>เพิ่มรายการ
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mx-4 my-3 card space-y-3">
          <h3 className="font-semibold text-sm">{editId ? 'แก้ไขรายการ' : 'รายการใหม่'}</h3>
          <div className="flex gap-2">
            {['Income','Expense'].map(t => (
              <button key={t} onClick={() => setForm({...form,type:t})}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                  ${form.type===t ? (t==='Income'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red') : 'bg-white text-gray-400 border-gray-200'}`}>
                {t==='Income'?'รายรับ':'รายจ่าย'}
              </button>
            ))}
          </div>
          <select className="input text-sm" value={form.category} onChange={e => setForm({...form,category:e.target.value})}>
            {CATS.map(c => <option key={c}>{c}</option>)}
          </select>
          <input className="input text-sm" type="number" placeholder="จำนวนเงิน (บาท)" value={form.amount} onChange={e => setForm({...form,amount:e.target.value})}/>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลา</label>
            <input className="input text-sm" type="datetime-local" value={form.date} onChange={e => setForm({...form,date:e.target.value})}/>
          </div>
          <input className="input text-sm" placeholder="หมายเหตุ" value={form.note} onChange={e => setForm({...form,note:e.target.value})}/>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-1">
              <Check size={14}/>{editId?'บันทึก':'เพิ่ม'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }} className="btn-ghost px-4">
              <X size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading
        ? <div className="flex justify-center pt-12"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
        : <div className="px-4 pb-4 space-y-2 mt-2">
            {txs.length === 0 && <div className="text-center pt-16 text-gray-400"><div className="text-5xl mb-3">💰</div>ยังไม่มีรายการ</div>}
            {txs.map(tx => (
              <div key={tx.id} className="card flex items-center gap-3">
                <div className={`w-2 h-12 rounded-full flex-shrink-0 ${tx.type==='Income'?'bg-green-400':'bg-red-400'}`}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{tx.category}</span>
                    <span className={`text-sm font-bold ${tx.type==='Income'?'text-green-600':'text-brand-red'}`}>
                      {tx.type==='Income'?'+':'-'}฿{fmt(tx.amount)}
                    </span>
                  </div>
                  {tx.products?.model && <p className="text-xs text-gray-400 truncate">{tx.products.model}</p>}
                  {tx.note && <p className="text-xs text-gray-400 truncate">{tx.note}</p>}
                  <p className="text-xs text-gray-300 mt-0.5">{thDate(tx.date)}</p>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(tx)} className="p-1.5 text-gray-300 hover:text-brand-dark"><Edit2 size={14}/></button>
                  <button onClick={() => del(tx.id)} className="p-1.5 text-gray-300 hover:text-brand-red"><X size={14}/></button>
                </div>
              </div>
            ))}
          </div>
      }
    </div>
  )
}
