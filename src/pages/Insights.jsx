import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const fmt = n => Number(n || 0).toLocaleString('th-TH')

export default function Insights() {
  const [sold, setSold]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('products').select('*').eq('status','Sold').not('sold_date','is',null)
      .then(({ data }) => { setSold(data || []); setLoading(false) })
  }, [])

  if (loading) return <div className="flex justify-center pt-20"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>

  const withDays = sold.map(p => ({
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
    avgDays:     Math.round(g.items.reduce((a,p) => a + p.days, 0) / g.items.length),
    totalProfit: g.items.reduce((a,p) => a + p.profit, 0),
  }))

  const hot    = [...models].sort((a,b) => a.avgDays - b.avgDays).slice(0,5)
  const profit = [...models].sort((a,b) => b.totalProfit - a.totalProfit).slice(0,5)
  const maxDays = Math.max(...hot.map(m => m.avgDays), 1)
  const maxProf = Math.max(...profit.map(m => m.totalProfit), 1)
  const avg     = withDays.length ? Math.round(withDays.reduce((a,p) => a + p.days, 0) / withDays.length) : 0

  const Bar = ({ items, max, color, valFn }) => items.length
    ? items.map((m,i) => (
        <div key={m.model} className="mb-2.5">
          <div className="flex justify-between text-sm mb-1">
            <span className="truncate max-w-[70%] font-medium">{i+1}. {m.model}</span>
            <span className="text-gray-500 text-xs">{valFn(m)}</span>
          </div>
          <div className="h-2 bg-amber-50 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round((m.avgDays||m.totalProfit)/max*100)}%` }}/>
          </div>
        </div>
      ))
    : <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีข้อมูล</p>

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="font-bold text-xl">สถิติร้าน</h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center"><p className="text-3xl font-bold text-brand-yellow">{sold.length}</p><p className="text-xs text-gray-400 mt-1">ขายแล้วทั้งหมด</p></div>
        <div className="card text-center"><p className="text-3xl font-bold text-brand-yellow">{avg}</p><p className="text-xs text-gray-400 mt-1">เฉลี่ยวันในสต็อก</p></div>
      </div>
      <div className="card">
        <div className="flex items-center gap-2 mb-3"><span>⚡</span><h2 className="font-semibold">Hot Items — ออกไวที่สุด</h2></div>
        <Bar items={hot} max={maxDays} color="bg-brand-yellow" valFn={m=>`${m.avgDays} วัน`}/>
      </div>
      <div className="card">
        <div className="flex items-center gap-2 mb-3"><span>📈</span><h2 className="font-semibold">Profit Leader — กำไรสูงสุด</h2></div>
        <Bar items={profit} max={maxProf} color="bg-green-400" valFn={m=>`฿${fmt(m.totalProfit)}`}/>
      </div>
    </div>
  )
}
