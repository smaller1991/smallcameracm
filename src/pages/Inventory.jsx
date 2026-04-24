import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Search, Plus } from 'lucide-react'

const TABS = [
  { key: 'all', label: 'ทั้งหมด' }, { key: 'Available', label: 'พร้อมขาย' },
  { key: 'Reserved', label: 'จอง' }, { key: 'Sold', label: 'ขายแล้ว' },
]
const STATUS_LABEL = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว' }
const STATUS_CLASS = { Available: 'badge-available', Reserved: 'badge-reserved', Sold: 'badge-sold' }
const fmt = n => Number(n || 0).toLocaleString('th-TH')

export default function Inventory() {
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [tab,      setTab]      = useState('all')

  useEffect(() => {
    supabase.from('products').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setProducts(data || []); setLoading(false) })
  }, [])

  const filtered = products.filter(p => {
    const ok = tab === 'all' || p.status === tab
    const q  = !search || p.model.toLowerCase().includes(search.toLowerCase()) ||
                p.serial_number.toLowerCase().includes(search.toLowerCase())
    return ok && q
  })

  return (
    <div>
      <div className="sticky top-0 bg-brand-light z-10 px-4 py-3 border-b border-amber-100">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input className="input pl-9" placeholder="ค้นหารุ่นหรือ Serial..." value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap border transition-all
                ${tab === t.key ? 'bg-brand-dark text-brand-yellow border-brand-dark' : 'bg-white text-gray-500 border-gray-200'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 pt-3 pb-1 flex justify-between items-center">
        <p className="text-sm text-gray-500">{filtered.length} รายการ</p>
        <button onClick={() => navigate('/inventory/add')} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1">
          <Plus size={15}/>เพิ่มสินค้า
        </button>
      </div>
      {loading
        ? <div className="flex justify-center pt-20"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
        : filtered.length === 0
          ? <div className="flex flex-col items-center pt-24 text-gray-400"><span className="text-5xl mb-3">📷</span><p>ไม่พบสินค้า</p></div>
          : <div className="px-4 pb-4 space-y-2 mt-1">
              {filtered.map(p => (
                <div key={p.id} onClick={() => navigate(`/inventory/${p.id}`)}
                  className="card flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform">
                  {p.images?.[0]
                    ? <img src={p.images[0]} className="w-16 h-16 rounded-xl object-cover flex-shrink-0"/>
                    : <div className="w-16 h-16 rounded-xl bg-amber-100 flex items-center justify-center text-3xl flex-shrink-0">📷</div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate flex-1">{p.model}</p>
                      <span className={STATUS_CLASS[p.status]+' text-xs font-semibold px-2 py-0.5 rounded-full'}>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">SN: {p.serial_number}</p>
                    <div className="flex justify-between mt-1">
                      <p className="text-xs text-gray-500">ต้นทุน ฿{fmt(p.total_cost)}</p>
                      <p className="text-xs font-semibold text-amber-600">เกรด {p.condition}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
      }
    </div>
  )
}
