import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { thDateShort } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import {
  AlertCircle,
  Banknote,
  Clock3,
  Gauge,
  Package,
  PiggyBank,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'

const fmt = n => Number(n || 0).toLocaleString('th-TH')
const pad = n => String(n).padStart(2, '0')
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toLocalDateStr = iso => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const monthRange = offset => {
  const d = new Date()
  return {
    from: localDate(new Date(d.getFullYear(), d.getMonth() + offset, 1)),
    to: localDate(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0)),
  }
}
const yearRange = () => {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}
const PROD_CATS = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const PROFIT_DEDUCT_CATS = new Set(['Shipping','Marketing','Operating','Other'])
const STOCK_COLORS = ['#fbbf24','#60a5fa','#34d399','#fb7185','#a78bfa','#9ca3af']
const polarPoint = (cx, cy, r, angle) => {
  const rad = (angle - 90) * Math.PI / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
const donutSlicePath = (startPct, endPct, outerR = 94, innerR = 48) => {
  const startAngle = startPct * 3.6
  const endAngle = endPct * 3.6
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  const outerStart = polarPoint(110, 110, outerR, startAngle)
  const outerEnd = polarPoint(110, 110, outerR, endAngle)
  const innerEnd = polarPoint(110, 110, innerR, endAngle)
  const innerStart = polarPoint(110, 110, innerR, startAngle)
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

export default function Dashboard() {
  const [raw, setRaw] = useState({ products: [], txs: [], balance: { bank: 0, cash: 0 } })
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(monthRange(0).from)
  const [dateTo, setDateTo] = useState(monthRange(0).to)
  const [ageDetail, setAgeDetail] = useState(null)
  const [saleDetail, setSaleDetail] = useState(null)
  const [activeStockIndex, setActiveStockIndex] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('transactions').select('*,products(model,category,total_cost,sold_price,created_at,sold_date,installment_total,status)').order('date', { ascending: false }),
      supabase.from('balances').select('*').eq('id', 'main').single(),
    ]).then(([{ data: products }, { data: txs }, { data: bal }]) => {
      setRaw({
        products: products || [],
        txs: txs || [],
        balance: { bank: Number(bal?.bank || 0), cash: Number(bal?.cash || 0) },
      })
      setLoading(false)
    })
  }, [])

  const stats = useMemo(() => {
    const inRange = iso => {
      if (!iso) return false
      const ds = toLocalDateStr(iso)
      if (dateFrom && ds < dateFrom) return false
      if (dateTo && ds > dateTo) return false
      return true
    }
    const txs = raw.txs.filter(t => inRange(t.date))
    const sold = raw.products.filter(p => p.status === 'Sold' && inRange(p.sold_date))
    const available = raw.products.filter(p => p.status === 'Available')
    const reserved = raw.products.filter(p => p.status === 'Reserved')
    const stockProducts = raw.products.filter(p => p.status === 'Available' || p.status === 'Reserved')

    const income = txs.filter(t => t.type === 'Income').reduce((a,t)=>a+Number(t.amount),0)
    const expense = txs.filter(t => t.type === 'Expense').reduce((a,t)=>a+Number(t.amount),0)
    const salesGross = sold.reduce((a,p)=>a+(Number(p.sold_price || 0)-Number(p.total_cost || 0)),0)
    const deductions = txs
      .filter(t => t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category))
      .reduce((a,t)=>a+Number(t.amount),0)
    const profit = salesGross - deductions
    const stockValue = stockProducts.reduce((a,p)=>a+Number(p.total_cost || 0),0)
    const avgDays = sold.length
      ? Math.round(sold.reduce((a,p)=>a+Math.max(0, Math.ceil((new Date(p.sold_date)-new Date(p.created_at))/86400000)),0)/sold.length)
      : 0

    const catTotals = PROD_CATS.map(cat => ({
      cat,
      count: stockProducts.filter(p => (p.category || 'กล้อง') === cat).length,
      value: stockProducts.filter(p => (p.category || 'กล้อง') === cat).reduce((a,p)=>a+Number(p.total_cost || 0),0),
    })).filter(c => c.count > 0)

    const ageBuckets = [
      { label: '0-30 วัน', min: 0, max: 30 },
      { label: '31-60 วัน', min: 31, max: 60 },
      { label: '61-90 วัน', min: 61, max: 90 },
      { label: '90+ วัน', min: 91, max: Infinity },
    ].map(bucket => {
      const items = stockProducts.filter(p => {
        const days = Math.max(0, Math.ceil((new Date() - new Date(p.created_at)) / 86400000))
        return days >= bucket.min && days <= bucket.max
      })
      return {
        label: bucket.label,
        count: items.length,
        value: items.reduce((a,p)=>a+Number(p.total_cost || 0),0),
        items: items
          .map(p => ({
            ...p,
            ageDays: Math.max(0, Math.ceil((new Date() - new Date(p.created_at)) / 86400000)),
          }))
          .sort((a,b)=>b.ageDays-a.ageDays),
      }
    })

    const soldItems = sold.map(p => ({
      ...p,
      profit: Number(p.sold_price || 0) - Number(p.total_cost || 0),
      daysToSell: Math.max(0, Math.ceil((new Date(p.sold_date) - new Date(p.created_at)) / 86400000)),
    }))
    const topProfit = [...soldItems].sort((a,b)=>b.profit-a.profit).slice(0,5)
    const fastest = [...soldItems].sort((a,b)=>a.daysToSell-b.daysToSell || b.profit-a.profit).slice(0,5)

    return {
      txs,
      sold,
      available,
      reserved,
      income,
      expense,
      netCashflow: income - expense,
      salesGross,
      deductions,
      profit,
      stockValue,
      avgDays,
      catTotals,
      ageBuckets,
      soldItems,
      topProfit,
      fastest,
    }
  }, [raw, dateFrom, dateTo])

  if (loading) {
    return <div className="flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
  }

  const selectedLabel = `${thDateShort(dateFrom)} — ${thDateShort(dateTo)}`
  const totalWealth = stats.stockValue + raw.balance.bank + raw.balance.cash
  const stockTotalForShare = stats.stockValue || 1
  const rangeClass = active => `py-2 rounded-xl text-xs font-semibold border active:scale-95 transition-all ${
    active ? 'bg-brand-dark text-brand-yellow border-brand-dark shadow-sm' : 'bg-white text-gray-500 border-gray-200'
  }`
  const isRange = r => dateFrom === r.from && dateTo === r.to
  const setRange = r => { setDateFrom(r.from); setDateTo(r.to) }
  const selectedAgeBucket = stats.ageBuckets.find(b => b.label === ageDetail)
  const saleDetailItems = saleDetail === 'profit'
    ? [...stats.soldItems].sort((a,b)=>b.profit-a.profit)
    : saleDetail === 'fast'
      ? [...stats.soldItems].sort((a,b)=>a.daysToSell-b.daysToSell || b.profit-a.profit)
      : []
  const saleDetailTitle = saleDetail === 'profit' ? 'กำไรสูงสุดทั้งหมด' : 'ขายเร็วสุดทั้งหมด'
  let pieStart = 0
  const stockPie = stats.catTotals.map((c, i) => {
    const pct = c.value / stockTotalForShare * 100
    const seg = { ...c, color: STOCK_COLORS[i % STOCK_COLORS.length], start: pieStart, end: pieStart + pct }
    pieStart += pct
    return seg
  })
  const activeStock = activeStockIndex == null ? null : stockPie[activeStockIndex]
  const activeStockPct = activeStock ? activeStock.value / stockTotalForShare * 100 : 100
  const stockItemCount = stockPie.reduce((a,c)=>a+c.count,0)
  const summaryCards = [
    { label: 'รายรับ', value: `฿${fmt(stats.income)}`, icon: TrendingUp, accent: 'text-green-500', iconBg: 'bg-green-500/15' },
    { label: 'รายจ่าย', value: `฿${fmt(stats.expense)}`, icon: TrendingDown, accent: 'text-red-500', iconBg: 'bg-red-500/15' },
    { label: 'ขายแล้ว', value: `${stats.sold.length} ชิ้น`, icon: ShoppingBag, accent: 'text-rose-500', iconBg: 'bg-rose-500/15' },
    { label: 'เฉลี่ยในสต็อก', value: `${stats.avgDays} วัน`, icon: Gauge, accent: 'text-blue-500', iconBg: 'bg-blue-500/15' },
  ]
  const moneyCards = [
    {
      label: 'กำไรขายสุทธิ',
      value: `${stats.profit >= 0 ? '+' : ''}฿${fmt(stats.profit)}`,
      icon: PiggyBank,
      accent: stats.profit >= 0 ? 'text-brand-yellow' : 'text-brand-red',
      iconBg: stats.profit >= 0 ? 'bg-amber-500/15' : 'bg-red-500/15',
    },
    {
      label: 'เงินสดสุทธิ',
      value: `${stats.netCashflow >= 0 ? '+' : ''}฿${fmt(stats.netCashflow)}`,
      icon: Banknote,
      accent: stats.netCashflow >= 0 ? 'text-green-600' : 'text-red-500',
      iconBg: stats.netCashflow >= 0 ? 'bg-green-500/15' : 'bg-red-500/15',
    },
  ]
  const stockStatusCards = [
    { label: 'พร้อมขาย', value: stats.available.length, icon: Package, accent: 'text-brand-yellow', iconBg: 'bg-amber-500/15' },
    { label: 'จองอยู่', value: stats.reserved.length, icon: Clock3, accent: 'text-blue-500', iconBg: 'bg-blue-500/15' },
  ]

  const expiring = raw.products.filter(p => {
    if (!p.warranty_expiry || p.status !== 'Sold') return false
    const d = Math.ceil((new Date(p.warranty_expiry) - new Date()) / 86400000)
    return d >= 0 && d <= 3
  })

  return (
    <div className="pb-5">
      <div className="bg-brand-dark px-4 pt-4 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-white/50 text-xs">ศูนย์ควบคุมแดชบอร์ด</p>
            <h1 className="text-brand-yellow font-bold text-xl">ภาพรวมร้าน</h1>
          </div>
          <div className="text-right">
            <p className="text-white/40 text-xs">ช่วงที่เลือก</p>
            <p className="text-white text-xs font-semibold">{selectedLabel}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={()=>setRange(monthRange(0))} className={rangeClass(isRange(monthRange(0)))}>เดือนนี้</button>
          <button onClick={()=>setRange(monthRange(-1))} className={rangeClass(isRange(monthRange(-1)))}>เดือนที่แล้ว</button>
          <button onClick={()=>setRange(yearRange())} className={rangeClass(isRange(yearRange()))}>ทั้งปี</button>
        </div>
        <div className="flex gap-2 items-center">
          <ThaiDatePicker value={dateFrom} onChange={setDateFrom} mode="calendar" className="input flex-1 text-sm py-1.5"/>
          <span className="text-white/40 text-sm">—</span>
          <ThaiDatePicker value={dateTo} onChange={setDateTo} mode="calendar" className="input flex-1 text-sm py-1.5"/>
          {(dateFrom || dateTo) && (
            <button onClick={()=>setRange(monthRange(0))} className="text-white/40 p-1"><X size={16}/></button>
          )}
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-2xl p-3 flex gap-2">
          <AlertCircle size={18} className="text-brand-red flex-shrink-0 mt-0.5"/>
          <div>
            <p className="text-sm font-semibold text-brand-red">ประกันใกล้หมด</p>
            {expiring.slice(0, 3).map(p => {
              const d = Math.ceil((new Date(p.warranty_expiry) - new Date()) / 86400000)
              return <p key={p.id} className="text-xs text-red-600 mt-0.5">{p.model} เหลืออีก {d} วัน</p>
            })}
          </div>
        </div>
      )}

      <div className="px-4 mt-4 space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          {summaryCards.map(({ label, value, icon: Icon, accent, iconBg }) => (
            <div key={label} className="card summary-card p-3 min-h-[84px] flex flex-col items-center justify-center gap-1.5 text-center">
              <div className="flex items-center justify-center gap-1.5 min-w-0">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg} ${accent}`}>
                  <Icon size={16} strokeWidth={2.5}/>
                </span>
                <p className="font-semibold text-gray-500 leading-tight truncate" style={{ fontSize: 14 }}>{label}</p>
              </div>
              <p className={`w-full font-bold leading-none tracking-normal truncate ${accent}`} style={{ fontSize: 28 }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {moneyCards.map(({ label, value, icon: Icon, accent, iconBg }) => (
            <div key={label} className="card summary-card p-3 min-h-[90px] flex flex-col items-center justify-center gap-1.5 text-center">
              <div className="flex items-center justify-center gap-1.5 min-w-0">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg} ${accent}`}>
                  <Icon size={16} strokeWidth={2.5}/>
                </span>
                <p className="font-semibold text-gray-500 leading-tight truncate" style={{ fontSize: 14 }}>{label}</p>
              </div>
              <p className={`w-full font-bold leading-none tracking-normal truncate ${accent}`} style={{ fontSize: 30 }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {stockStatusCards.map(({ label, value, icon: Icon, accent, iconBg }) => (
            <div key={label} className="card summary-card p-3 min-h-[84px] flex flex-col items-center justify-center gap-1 text-center">
              <div className="flex items-center justify-center gap-1.5 min-w-0">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg} ${accent}`}>
                  <Icon size={16} strokeWidth={2.5}/>
                </span>
                <p className="font-semibold text-gray-500 leading-tight truncate" style={{ fontSize: 14 }}>{label}</p>
              </div>
              <p className={`font-bold leading-none ${accent}`} style={{ fontSize: 34 }}>{value}</p>
             </div>
          ))}
        </div>

        <div className="card summary-card p-3 space-y-3 text-center">
          <div className="flex flex-col items-center gap-1">
            <p className="font-semibold text-gray-500 leading-tight" style={{ fontSize: 14 }}>สินทรัพย์ตอนนี้</p>
            <p className="w-full font-bold leading-none text-brand-dark truncate" style={{ fontSize: 31 }}>฿{fmt(totalWealth)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'สต็อก', value: stats.stockValue, icon: Package, color: 'text-amber-600 bg-amber-50' },
            { label: 'ยอดโอน', value: raw.balance.bank, icon: Banknote, color: 'text-blue-600 bg-blue-50' },
            { label: 'เงินสด', value: raw.balance.cash, icon: Wallet, color: 'text-green-600 bg-green-50' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-amber-100 p-2 min-w-0 flex flex-col items-center text-center">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-1.5 ${color}`}><Icon size={16}/></div>
              <p className="font-semibold text-gray-400 truncate" style={{ fontSize: 13 }}>{label}</p>
              <p className="w-full font-bold text-brand-dark leading-tight truncate" style={{ fontSize: 16 }}>฿{fmt(value)}</p>
            </div>
          ))}
          </div>
        </div>
      </div>

      <div className="px-4 mt-5 space-y-3">
        <div className="card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp size={17} className="text-green-600 flex-shrink-0"/>
              <h2 className="font-semibold truncate">กำไรสูงสุด 5 อันดับ</h2>
            </div>
            <button onClick={()=>setSaleDetail('profit')} className="text-xs font-semibold text-brand-dark bg-amber-100 px-2.5 py-1 rounded-lg active:scale-95">
              ดูทั้งหมด
            </button>
          </div>
          {stats.topProfit.length ? (
            <div className="space-y-2">
              {stats.topProfit.map((p, i) => (
                <button key={p.id} onClick={()=>setSaleDetail('profit')} className="w-full rounded-xl bg-green-50/70 px-3 py-2 text-left active:opacity-70">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-lg bg-white text-green-700 font-bold text-sm flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-brand-dark truncate">{p.model}</p>
                      <p className="text-xs text-gray-400">{p.category || 'กล้อง'} · ขาย {thDateShort(p.sold_date)}</p>
                    </div>
                    <p className={`text-sm font-bold flex-shrink-0 ${p.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {p.profit >= 0 ? '+' : ''}฿{fmt(p.profit)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีรายการขายในช่วงนี้</p>}
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Gauge size={17} className="text-blue-600 flex-shrink-0"/>
              <h2 className="font-semibold truncate">ขายเร็วสุด 5 อันดับ</h2>
            </div>
            <button onClick={()=>setSaleDetail('fast')} className="text-xs font-semibold text-brand-dark bg-blue-100 px-2.5 py-1 rounded-lg active:scale-95">
              ดูทั้งหมด
            </button>
          </div>
          {stats.fastest.length ? (
            <div className="space-y-2">
              {stats.fastest.map((p, i) => (
                <button key={p.id} onClick={()=>setSaleDetail('fast')} className="w-full rounded-xl bg-blue-50/80 px-3 py-2 text-left active:opacity-70">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-lg bg-white text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-brand-dark truncate">{p.model}</p>
                      <p className="text-xs text-gray-400">อยู่ในสต็อก {p.daysToSell} วัน · ขาย {thDateShort(p.sold_date)}</p>
                    </div>
                    <p className="text-sm font-bold text-blue-700 flex-shrink-0">{p.daysToSell} วัน</p>
                  </div>
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีรายการขายในช่วงนี้</p>}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Clock3 size={17} className="text-brand-dark flex-shrink-0"/>
            <h2 className="font-semibold truncate">สต็อกค้างนาน</h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {stats.ageBuckets.map(b => (
              <button key={b.label} onClick={()=>setAgeDetail(b.label)}
                className={`rounded-xl p-3 text-left border active:opacity-70 ${
                  b.label === '90+ วัน' ? 'bg-red-50 border-red-100' :
                  b.label === '61-90 วัน' ? 'bg-orange-50 border-orange-100' :
                  'bg-blue-50 border-blue-100'
                }`}>
                <p className="text-sm font-semibold text-brand-dark">{b.label}</p>
                <p className="text-2xl font-bold text-brand-dark mt-1">{b.count}</p>
                <p className="text-xs text-gray-500">฿{fmt(b.value)} ›</p>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <PiggyBank size={17} className="text-brand-dark flex-shrink-0"/>
            <h2 className="font-semibold truncate">ต้นทุนสต็อกตามประเภท</h2>
          </div>
          {stats.catTotals.length ? (
            <div className="space-y-3" onMouseLeave={() => setActiveStockIndex(null)}>
              <div className="flex justify-center">
                <div className="relative w-[230px] h-[230px]">
                  <svg viewBox="0 0 220 220" className="w-full h-full overflow-visible" role="img" aria-label="ต้นทุนสต็อกตามประเภท">
                    {stockPie.map((c, i) => {
                      const isActive = i === activeStockIndex
                      const middleAngle = ((c.start + c.end) / 2) * 3.6 - 90
                      const offset = isActive ? 5 : 0
                      const dx = Math.cos(middleAngle * Math.PI / 180) * offset
                      const dy = Math.sin(middleAngle * Math.PI / 180) * offset
                      return (
                        <path
                          key={c.cat}
                          d={donutSlicePath(c.start, c.end)}
                          fill={c.color}
                          className="cursor-pointer transition-all duration-200 outline-none"
                          style={{
                            opacity: activeStock ? (isActive ? 1 : 0.42) : 1,
                            filter: isActive ? 'drop-shadow(0 10px 14px rgba(0,0,0,.18))' : 'none',
                            transform: `translate(${dx}px, ${dy}px)`,
                          }}
                          tabIndex="0"
                          onMouseEnter={() => setActiveStockIndex(i)}
                          onFocus={() => setActiveStockIndex(i)}
                          onTouchStart={() => setActiveStockIndex(i)}
                        />
                      )
                    })}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[118px] h-[118px] rounded-full bg-white/95 border border-amber-100 shadow-sm flex flex-col items-center justify-center text-center px-3">
                      <span className="w-3 h-3 rounded-full mb-1" style={{ background: activeStock?.color || '#fbbf24' }}/>
                      <p className="text-xs font-semibold text-brand-dark leading-tight max-w-[96px] truncate">{activeStock?.cat || 'รวมสต็อก'}</p>
                      <p className="text-lg font-bold text-brand-dark leading-tight">฿{fmt(activeStock?.value || stats.stockValue)}</p>
                      <p className="text-xs text-gray-400">{activeStockPct.toFixed(1)}% · {activeStock?.count || stockItemCount} ชิ้น</p>
                    </div>
                  </div>
                  <div className="absolute left-2 right-2 bottom-1 flex items-center justify-center gap-1.5 pointer-events-none">
                    {stockPie.map((c, i) => (
                      <span
                        key={c.cat}
                        className={`h-1.5 rounded-full transition-all ${i === activeStockIndex ? 'w-5' : 'w-1.5'}`}
                        style={{ background: c.color, opacity: activeStockIndex == null || i === activeStockIndex ? 1 : 0.45 }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {stockPie.map((c, i) => {
                  const isActive = i === activeStockIndex
                  const pct = c.value / stockTotalForShare * 100
                  return (
                    <button
                      key={c.cat}
                      type="button"
                      onMouseEnter={() => setActiveStockIndex(i)}
                      onFocus={() => setActiveStockIndex(i)}
                      onTouchStart={() => setActiveStockIndex(i)}
                      className={`w-full rounded-xl text-left transition-all duration-200 ${
                        isActive
                          ? 'bg-white shadow-sm border border-amber-200 px-3 py-2.5 scale-[1.015]'
                          : 'bg-transparent border border-transparent px-2 py-1.5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }}/>
                        <p className={`flex-1 truncate ${isActive ? 'text-sm font-bold text-brand-dark' : 'text-xs text-gray-500'}`}>{c.cat}</p>
                        <p className={`${isActive ? 'text-sm font-bold text-brand-dark' : 'text-xs text-gray-400'}`}>฿{fmt(c.value)}</p>
                      </div>
                      {isActive && (
                        <div className="mt-1 pl-4 flex items-center justify-between text-xs text-gray-400">
                          <span>{c.count} ชิ้นในสต็อก</span>
                          <span>{pct.toFixed(1)}% ของต้นทุนรวม</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีสต็อก</p>}
        </div>

      </div>

      {saleDetail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setSaleDetail(null)}>
          <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-amber-100">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold text-lg text-brand-dark truncate">{saleDetailTitle}</h2>
                  <p className="text-xs text-gray-400">{saleDetailItems.length} รายการ · {selectedLabel}</p>
                </div>
                <button onClick={()=>setSaleDetail(null)} className="text-gray-400 p-1 flex-shrink-0"><X size={18}/></button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
              {saleDetailItems.length ? saleDetailItems.map((p, i) => (
                <div key={p.id} className="bg-amber-50 rounded-xl px-4 py-3">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-brand-dark truncate">{i + 1}. {p.model}</p>
                      <p className="text-xs text-gray-400">{p.category || 'กล้อง'} · ขาย {thDateShort(p.sold_date)} · อยู่ในสต็อก {p.daysToSell} วัน</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-bold ${p.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {p.profit >= 0 ? '+' : ''}฿{fmt(p.profit)}
                      </p>
                      <p className="text-xs text-gray-400">ขาย ฿{fmt(p.sold_price)}</p>
                    </div>
                  </div>
                </div>
              )) : <p className="text-xs text-gray-400 text-center py-10">ไม่มีรายการขายในช่วงนี้</p>}
            </div>
          </div>
        </div>
      )}

      {selectedAgeBucket && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" onClick={()=>setAgeDetail(null)}>
          <div className="bg-white w-full max-w-[430px] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-amber-100">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-lg text-brand-dark">สต็อกค้าง {selectedAgeBucket.label}</h2>
                  <p className="text-xs text-gray-400">{selectedAgeBucket.count} ชิ้น · ฿{fmt(selectedAgeBucket.value)}</p>
                </div>
                <button onClick={()=>setAgeDetail(null)} className="text-gray-400 p-1"><X size={18}/></button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
              {selectedAgeBucket.items.length ? selectedAgeBucket.items.map(p => (
                <div key={p.id} className="bg-amber-50 rounded-xl px-4 py-3">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-brand-dark truncate">{p.model}</p>
                      <p className="text-xs text-gray-400">{p.category || 'กล้อง'} · รับเข้า {thDateShort(p.created_at)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-amber-600">฿{fmt(p.total_cost)}</p>
                      <p className="text-xs text-gray-400">{p.ageDays} วัน</p>
                    </div>
                  </div>
                </div>
              )) : <p className="text-xs text-gray-400 text-center py-10">ไม่มีสินค้าในช่วงนี้</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
