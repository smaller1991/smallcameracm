import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { thDateShort } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { TrendingUp, TrendingDown, Package, ShoppingBag, AlertCircle, X } from 'lucide-react'

const fmt = n => Number(n || 0).toLocaleString('th-TH')

export default function Dashboard() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom,setDateFrom]= useState('')
  const [dateTo,  setDateTo]  = useState('')

  const now = new Date()
  const ms  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const me  = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
  const monthLabel = `${thDateShort(ms)} — ${thDateShort(me)}`

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
      const stockValue = (products || []).filter(p => p.status === 'Available' || p.status === 'Reserved').reduce((a, p) => a + Number(p.total_cost || 0), 0)
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

  // ── Insights ──
  const soldAll = data.products.filter(p => p.status === 'Sold' && p.sold_date)
  const filtered = soldAll.filter(p => {
    if (dateFrom && new Date(p.sold_date) < new Date(dateFrom)) return false
    if (dateTo   && new Date(p.sold_date) > new Date(dateTo + 'T23:59:59')) return false
    return true
  })
  const withDays = filtered.map(p => ({
    ...p,
    days:   Math.max(0, Math.ceil((new Date(p.sold_date) - new Date(p.created_at)) / 86400000)),
    profit: Number(p.sold_price || 0) - Number(p.total_cost),
  }))
  const byModel = {}
  withDays.forEach(p => {
    if (!byModel[p.model]) byModel[p.model] = { model: p.model, items: [] }
    byModel[p.model].items.push(p)
  })
  const models = Object.values(byModel).map(g => ({
    model: g.model, count: g.items.length,
    avgDays:     Math.round(g.items.reduce((a, p) => a + p.days,   0) / g.items.length),
    totalProfit: g.items.reduce((a, p) => a + p.profit, 0),
  }))
  const hot    = [...models].sort((a, b) => a.avgDays - b.avgDays).slice(0, 5)
  const profit = [...models].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 5)
  const maxDays = Math.max(...hot.map(m => m.avgDays), 1)
  const maxProf = Math.max(...profit.map(m => m.totalProfit), 1)
  const avgDays     = withDays.length ? Math.round(withDays.reduce((a, p) => a + p.days, 0) / withDays.length) : 0
  const totalProfit = withDays.reduce((a, p) => a + p.profit, 0)

  const Bar = ({ items, max, color, valFn }) => items.length
    ? items.map((m, i) => (
        <div key={m.model} className="mb-2.5">
          <div className="flex justify-between text-sm mb-1">
            <span className="truncate max-w-[70%] font-medium">{i + 1}. {m.model}</span>
            <span className="text-gray-500 text-xs">{valFn(m)}</span>
          </div>
          <div className="h-2 bg-amber-50 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`}
              style={{ width: `${Math.round((m.avgDays != null ? m.avgDays : m.totalProfit) / max * 100)}%` }}/>
          </div>
        </div>
      ))
    : <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีข้อมูล</p>

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="bg-brand-dark px-4 pt-4 pb-6">
        <p className="text-white/50 text-xs mb-1">สรุปประจำเดือน</p>
        <h2 className="text-brand-yellow font-bold text-xl">{monthLabel}</h2>
      </div>

      {/* Warranty alert */}
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

      {/* Stats grid */}
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

      {/* Net profit */}
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
          { label: 'สต็อกสินค้า',      value: data.stockValue, pct: pct(data.stockValue), color: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-600' },
          { label: 'ยอดโอน (ธนาคาร)', value: data.bank,       pct: pct(data.bank),       color: 'bg-blue-400',  dot: 'bg-blue-400',  text: 'text-blue-600'  },
          { label: 'เงินสด',           value: data.cash,       pct: pct(data.cash),       color: 'bg-green-400', dot: 'bg-green-400', text: 'text-green-600' },
        ]
        return (
          <div className="mx-4 mt-3 card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-brand-dark">สัดส่วนมูลค่ารวม</p>
              <p className="text-sm font-bold text-brand-dark">฿{fmt(total)}</p>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
              {segments.map(s => s.value > 0 && (
                <div key={s.label} className={`${s.color} transition-all`} style={{ width: `${s.pct}%` }}/>
              ))}
              {total === 0 && <div className="bg-gray-100 w-full"/>}
            </div>
            <div className="space-y-2">
              {segments.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${s.dot}`}/>
                  <p className="text-xs text-gray-500 flex-1">{s.label}</p>
                  <div className="text-right">
                    <span className={`text-xs font-bold ${s.text}`}>{s.pct.toFixed(1)}%</span>
                    <span className="text-xs text-gray-400 ml-2">฿{fmt(s.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── Insights ── */}
      <div className="px-4 mt-5 space-y-3">
        <h3 className="font-bold text-brand-dark text-lg">สถิติร้าน</h3>

        {/* Date filter */}
        <div className="card">
          <p className="text-xs text-gray-500 mb-2 font-medium">กรองตามช่วงวันที่ขาย</p>
          <div className="flex gap-2 items-center">
            <ThaiDatePicker value={dateFrom} onChange={setDateFrom} className="input flex-1 text-sm py-1.5"/>
            <span className="text-gray-400 text-sm">—</span>
            <ThaiDatePicker value={dateTo}   onChange={setDateTo}   className="input flex-1 text-sm py-1.5"/>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-gray-400 p-1">
                <X size={16}/>
              </button>
            )}
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card text-center">
            <p className="text-3xl font-bold text-brand-yellow">{filtered.length}</p>
            <p className="text-xs text-gray-400 mt-1">ขายแล้ว</p>
          </div>
          <div className="card text-center">
            <p className="text-3xl font-bold text-brand-yellow">{avgDays}</p>
            <p className="text-xs text-gray-400 mt-1">เฉลี่ยวันในสต็อก</p>
          </div>
          <div className="card text-center col-span-2">
            <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {totalProfit >= 0 ? '+' : ''}฿{fmt(totalProfit)}
            </p>
            <p className="text-xs text-gray-400 mt-1">กำไรรวมในช่วงนี้</p>
          </div>
        </div>

        {/* Hot Items */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><span>⚡</span><h2 className="font-semibold">Hot Items — ออกไวที่สุด</h2></div>
          <Bar items={hot} max={maxDays} color="bg-brand-yellow" valFn={m => `${m.avgDays} วัน (${m.count} ชิ้น)`}/>
        </div>

        {/* Profit Leader */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><span>📈</span><h2 className="font-semibold">Profit Leader — กำไรสูงสุด</h2></div>
          <Bar items={profit} max={maxProf} color="bg-green-400" valFn={m => `฿${fmt(m.totalProfit)}`}/>
        </div>
      </div>
    </div>
  )
}
