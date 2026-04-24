import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { X } from 'lucide-react'

const fmt = n => Number(n||0).toLocaleString('th-TH')

export default function Insights() {
  const [sold,    setSold]    = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom,setDateFrom]= useState('')
  const [dateTo,  setDateTo]  = useState('')

  useEffect(()=>{
    supabase.from('products').select('*').eq('status','Sold').not('sold_date','is',null)
      .then(({data})=>{ setSold(data||[]); setLoading(false) })
  },[])

  const filtered = sold.filter(p=>{
    if (dateFrom && new Date(p.sold_date)<new Date(dateFrom)) return false
    if (dateTo   && new Date(p.sold_date)>new Date(dateTo+'T23:59:59')) return false
    return true
  })

  const withDays = filtered.map(p=>({
    ...p,
    days:   Math.max(0,Math.ceil((new Date(p.sold_date)-new Date(p.created_at))/86400000)),
    profit: Number(p.sold_price||0)-Number(p.total_cost),
  }))

  const byModel={}
  withDays.forEach(p=>{
    if (!byModel[p.model]) byModel[p.model]={model:p.model,items:[]}
    byModel[p.model].items.push(p)
  })
  const models=Object.values(byModel).map(g=>({
    model:g.model,count:g.items.length,
    avgDays:Math.round(g.items.reduce((a,p)=>a+p.days,0)/g.items.length),
    totalProfit:g.items.reduce((a,p)=>a+p.profit,0),
  }))

  const hot    = [...models].sort((a,b)=>a.avgDays-b.avgDays).slice(0,5)
  const profit = [...models].sort((a,b)=>b.totalProfit-a.totalProfit).slice(0,5)
  const maxDays = Math.max(...hot.map(m=>m.avgDays),1)
  const maxProf = Math.max(...profit.map(m=>m.totalProfit),1)
  const avg     = withDays.length ? Math.round(withDays.reduce((a,p)=>a+p.days,0)/withDays.length) : 0
  const totalProfit = withDays.reduce((a,p)=>a+p.profit,0)

  const Bar = ({items,max,color,valFn}) => items.length
    ? items.map((m,i)=>(
        <div key={m.model} className="mb-2.5">
          <div className="flex justify-between text-sm mb-1">
            <span className="truncate max-w-[70%] font-medium">{i+1}. {m.model}</span>
            <span className="text-gray-500 text-xs">{valFn(m)}</span>
          </div>
          <div className="h-2 bg-amber-50 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{width:`${Math.round((m.avgDays!=null?m.avgDays:m.totalProfit)/max*100)}%`}}/>
          </div>
        </div>
      ))
    : <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีข้อมูล</p>

  if (loading) return <div className="flex justify-center pt-20"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="font-bold text-xl">สถิติร้าน</h1>

      {/* Date filter */}
      <div className="card">
        <p className="text-xs text-gray-500 mb-2 font-medium">กรองตามช่วงวันที่ขาย</p>
        <div className="flex gap-2 items-center">
          <input className="input flex-1 text-sm py-1.5" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
          <span className="text-gray-400 text-sm">—</span>
          <input className="input flex-1 text-sm py-1.5" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
          {(dateFrom||dateTo) && (
            <button onClick={()=>{setDateFrom('');setDateTo('')}} className="text-gray-400 hover:text-brand-red p-1"><X size={16}/></button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center"><p className="text-3xl font-bold text-brand-yellow">{filtered.length}</p><p className="text-xs text-gray-400 mt-1">ขายแล้ว</p></div>
        <div className="card text-center"><p className="text-3xl font-bold text-brand-yellow">{avg}</p><p className="text-xs text-gray-400 mt-1">เฉลี่ยวันในสต็อก</p></div>
        <div className="card text-center col-span-2">
          <p className={`text-2xl font-bold ${totalProfit>=0?'text-green-600':'text-red-500'}`}>{totalProfit>=0?'+':''}฿{fmt(totalProfit)}</p>
          <p className="text-xs text-gray-400 mt-1">กำไรรวมในช่วงนี้</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3"><span>⚡</span><h2 className="font-semibold">Hot Items — ออกไวที่สุด</h2></div>
        <Bar items={hot} max={maxDays} color="bg-brand-yellow" valFn={m=>`${m.avgDays} วัน (${m.count} ชิ้น)`}/>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3"><span>📈</span><h2 className="font-semibold">Profit Leader — กำไรสูงสุด</h2></div>
        <Bar items={profit} max={maxProf} color="bg-green-400" valFn={m=>`฿${fmt(m.totalProfit)}`}/>
      </div>
    </div>
  )
}
