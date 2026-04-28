import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { thDateShort } from '../lib/dateUtils'
import { TrendingUp, TrendingDown, Package, ShoppingBag, Plus, AlertCircle } from 'lucide-react'

const fmt = n => Number(n || 0).toLocaleString('th-TH')
const STATUS_CLASS = { Available: 'badge-available', Reserved: 'badge-reserved', Sold: 'badge-sold' }

export default function Dashboard() {
  const navigate = useNavigate()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const ms  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const me  = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
  const firstDay = thDateShort(ms)
  const lastDay  = thDateShort(me)
  const monthLabel = `${firstDay} — ${lastDay}`

  useEffect(() => {
    Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('transactions').select('*').gte('date', ms).lte('date', me),
      supabase.from('balances').select('*').eq('id', 'main').single(),
    ]).then(([{ data: products }, { data: txs }, { data: bal }]) => {
      const avail      = products?.filter(p => p.status === 'Available').length ?? 0
      const soldM      = products?.filter(p => p.status === 'Sold' && p.sold_date >= ms).length ?? 0
      const income     = txs?.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0) ?? 0
      const expense    = txs?.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0) ?? 0
      const stockValue = (products || []).filter(p => p.status !== 'Sold').reduce((a, p) => a + Number(p.total_cost || 0), 0)
      const bank       = Number(bal?.bank || 0)
      const cash       = Number(bal?.cash || 0)
      setData({ avail, soldM, income, expense, products: products || [], stockValue, bank, cash })
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>

  const net = data.income - data.expense
  const expiring = data.products.filter(p => {
    if (!p.warranty_expiry || p.status !== 'Sold') return false
    const d = Math.ceil((new Date(p.warranty_expiry) - new Date()) / 86400000)
    return d >= 0 && d <= 3
  })

  return (
    <div className="pb-4">
      <div className="bg-brand-dark px-4 pt-4 pb-6">
        <p className="text-white/50 text-xs mb-1">สรุปประจำเดือน</p>
        <h2 className="text-brand-yellow font-bold text-xl">{monthLabel}</h2>
      </div>

      {expiring.length > 0 && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-2xl p-3 flex gap-2">
          <AlertCircle size={18} className="text-brand-red flex-shrink-0 mt-0.5"/>
          <div>
            <p className="text-sm font-semibold text-brand-red">ประกันใกล้หมด</p>
            {expiring.map(p => {
              const d = Math.ceil((new Date(p.warranty_expiry) - new Date()) / 86400000)
              return <p key={p.id} className="text-xs text-red-600 mt-0.5">{p.model} — เหลืออีก {d} วัน</p>
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 px-4 mt-4">
        {[
          { label: 'สินค้าพร้อมขาย', value: `${data.avail} ชิ้น`, icon: Package,      color: 'bg-amber-100 text-amber-600' },
          { label: 'ขายแล้วเดือนนี้', value: `${data.soldM} ชิ้น`, icon: ShoppingBag,  color: 'bg-rose-100 text-rose-600' },
          { label: 'รายรับ',          value: `฿${fmt(data.income)}`,  icon: TrendingUp,   color: 'bg-green-100 text-green-600', sub: 'เดือนนี้' },
          { label: 'รายจ่าย',         value: `฿${fmt(data.expense)}`, icon: TrendingDown, color: 'bg-red-100 text-red-500',   sub: 'เดือนนี้' },
        ].map(({ label, value, icon: Icon, color, sub }) => (
          <div key={label} className="card flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={20}/>
            </div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="font-bold text-lg text-brand-dark leading-tight">{value}</p>
              {sub && <p className="text-xs text-gray-400">{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-4 mt-3 card bg-brand-dark text-center">
        <p className="text-white/50 text-xs mb-1">กำไรสุทธิเดือนนี้</p>
        <p className={`text-2xl font-bold ${net >= 0 ? 'text-brand-yellow' : 'text-brand-red'}`}>
          {net >= 0 ? '+' : ''}฿{fmt(net)}
        </p>
      </div>

      {/* Wealth breakdown */}
      {(() => {
        const total = data.stockValue + data.bank + data.cash
        const pct   = v => total > 0 ? (v / total * 100) : 0
        const segments = [
          { label: 'สต็อกสินค้า',      value: data.stockValue, pct: pct(data.stockValue), color: 'bg-amber-400',  dot: 'bg-amber-400',  text: 'text-amber-600'  },
          { label: 'ยอดโอน (ธนาคาร)', value: data.bank,       pct: pct(data.bank),       color: 'bg-blue-400',   dot: 'bg-blue-400',   text: 'text-blue-600'   },
          { label: 'เงินสด',           value: data.cash,       pct: pct(data.cash),       color: 'bg-green-400',  dot: 'bg-green-400',  text: 'text-green-600'  },
        ]
        return (
          <div className="mx-4 mt-3 card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-brand-dark">สัดส่วนมูลค่ารวม</p>
              <p className="text-sm font-bold text-brand-dark">฿{fmt(total)}</p>
            </div>

            {/* Stacked bar */}
            <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
              {segments.map(s => s.value > 0 && (
                <div key={s.label}
                  className={`${s.color} transition-all`}
                  style={{ width: `${s.pct}%` }}
                  title={`${s.label}: ${s.pct.toFixed(1)}%`}
                />
              ))}
              {total === 0 && <div className="bg-gray-100 w-full"/>}
            </div>

            {/* Legend rows */}
            <div className="space-y-2">
              {segments.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${s.dot}`}/>
                  <p className="text-xs text-gray-500 flex-1">{s.label}</p>
                  <div className="text-right">
                    <span className={`text-xs font-bold ${s.text}`}>
                      {s.pct.toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-400 ml-2">฿{fmt(s.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <div className="px-4 mt-3">
        <button onClick={() => navigate('/inventory/add')} className="btn-primary w-full flex items-center justify-center gap-2 py-3">
          <Plus size={18}/>รับสินค้าเข้าสต็อก
        </button>
      </div>

      <div className="px-4 mt-5">
        <h3 className="font-semibold text-brand-dark mb-2">สินค้าพร้อมขายล่าสุด</h3>
        <div className="space-y-2">
          {data.products.filter(p => p.status === 'Available').slice(0, 5).map(p => (
            <div key={p.id} onClick={() => navigate(`/inventory/${p.id}`)}
              className="card flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform">
              {p.images?.[0]
                ? <img src={p.images[0]} className="w-14 h-14 rounded-xl object-cover flex-shrink-0"/>
                : <div className="w-14 h-14 rounded-xl bg-amber-100 flex items-center justify-center text-2xl flex-shrink-0">📷</div>}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{p.model}</p>
                <p className="text-xs text-gray-400">SN: {p.serial_number}</p>
                <p className="text-xs text-gray-500 mt-0.5">ต้นทุน ฿{fmt(p.total_cost)}</p>
              </div>
              <span className={STATUS_CLASS[p.status]+' badge'}>เกรด {p.condition}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
