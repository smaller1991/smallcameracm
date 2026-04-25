import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { thDateShort } from '../lib/dateUtils'
import { Search, Plus, ArrowUpDown } from 'lucide-react'

const TABS     = [{key:'all',label:'ทั้งหมด'},{key:'Available',label:'พร้อมขาย'},{key:'Reserved',label:'จอง'},{key:'Sold',label:'ขายแล้ว'}]
const CAT_TABS = ['ทั้งหมด','กล้อง','เลนส์','แฟลช','อุปกรณ์','อื่นๆ']
const SORT_OPTIONS = [
  {key:'created_at_desc',label:'วันที่ล่าสุด'},{key:'created_at_asc',label:'วันที่เก่าสุด'},
  {key:'model_asc',label:'ชื่อ A-Z'},{key:'model_desc',label:'ชื่อ Z-A'},
  {key:'category_asc',label:'ประเภทสินค้า'},
  {key:'total_cost_asc',label:'ราคาน้อย→มาก'},{key:'total_cost_desc',label:'ราคามาก→น้อย'},
]
const STATUS_LABEL = {Available:'พร้อมขาย',Reserved:'จอง',Sold:'ขายแล้ว'}
const STATUS_CLASS  = {Available:'badge-available',Reserved:'badge-reserved',Sold:'badge-sold'}
const fmt = n => Number(n||0).toLocaleString('th-TH')

export default function Inventory() {
  const navigate = useNavigate()
  const [products,setProducts] = useState([])
  const [loading, setLoading]  = useState(true)
  const [search,  setSearch]   = useState('')
  const [tab,     setTab]      = useState('all')
  const [catTab,  setCatTab]   = useState('ทั้งหมด')
  const [sortKey, setSortKey]  = useState('created_at_desc')
  const [showSort,setShowSort] = useState(false)
  const [inventoryValue, setInventoryValue] = useState(0)

  useEffect(() => {
    // โหลดสินค้าทั้งหมด
    supabase.from('products').select('*')
      .then(({data}) => { setProducts(data || []); setLoading(false) })

    // คำนวณมูลค่าคงคลัง Available เท่านั้น + อุปกรณ์เสริม
    supabase.rpc('get_inventory_value')
      .then(({data, error}) => {
        if (!error && data !== null) {
          setInventoryValue(Number(data))
        } else {
          // fallback กรณี function ยังไม่ได้ run migration_v3
          supabase.from('products').select('total_cost, status')
            .eq('status', 'Available')
            .then(({data: p}) => {
              setInventoryValue((p||[]).reduce((a,x) => a + Number(x.total_cost), 0))
            })
        }
      })
  }, [])

  const filtered = products
    .filter(p => tab==='all' || p.status===tab)
    .filter(p => catTab==='ทั้งหมด' || p.category===catTab)
    .filter(p => !search || p.model.toLowerCase().includes(search.toLowerCase()) || p.serial_number.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => {
      switch(sortKey) {
        case 'created_at_asc':  return new Date(a.created_at)-new Date(b.created_at)
        case 'created_at_desc': return new Date(b.created_at)-new Date(a.created_at)
        case 'model_asc':       return a.model.localeCompare(b.model,'th')
        case 'model_desc':      return b.model.localeCompare(a.model,'th')
        case 'category_asc':    return (a.category||'').localeCompare(b.category||'','th')
        case 'total_cost_asc':  return Number(a.total_cost)-Number(b.total_cost)
        case 'total_cost_desc': return Number(b.total_cost)-Number(a.total_cost)
        default: return 0
      }
    })

  // มูลค่าคงคลัง โหลดจาก state ที่ query มาแล้ว

  return (
    <div>
      <div className="sticky top-0 bg-brand-light z-10 px-4 py-3 border-b border-amber-100">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9" placeholder="ค้นหารุ่นหรือ Serial..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <button onClick={()=>setShowSort(!showSort)}
            className={`flex items-center gap-1 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${showSort?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-500 border-gray-200'}`}>
            <ArrowUpDown size={15}/>
          </button>
        </div>
        {showSort && (
          <div className="mt-2 bg-white rounded-xl border border-amber-100 shadow-sm overflow-hidden">
            {SORT_OPTIONS.map(o=>(
              <button key={o.key} onClick={()=>{setSortKey(o.key);setShowSort(false)}}
                className={`w-full text-left px-4 py-2.5 text-sm border-b border-amber-50 last:border-0 transition-colors ${sortKey===o.key?'bg-amber-50 text-brand-dark font-semibold':'text-gray-600'}`}>
                {sortKey===o.key?'✓ ':''}{o.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${tab===t.key?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-500 border-gray-200'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-1.5 overflow-x-auto pb-1">
          {CAT_TABS.map(c=>(
            <button key={c} onClick={()=>setCatTab(c)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${catTab===c?'bg-brand-yellow text-brand-dark border-brand-yellow':'bg-white text-gray-400 border-gray-100'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex justify-between items-center">
        <span className="text-sm text-amber-700 font-medium">📦 มูลค่าสินค้าคงคลัง</span>
        <span className="font-bold text-brand-dark text-lg">฿{fmt(inventoryValue)}</span>
      </div>

      <div className="px-4 pt-3 pb-1 flex justify-between items-center">
        <p className="text-sm text-gray-500">{filtered.length} รายการ</p>
        <button onClick={()=>navigate('/inventory/add')} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1">
          <Plus size={15}/>เพิ่มสินค้า
        </button>
      </div>

      {loading
        ? <div className="flex justify-center pt-20"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
        : filtered.length===0
          ? <div className="flex flex-col items-center pt-24 text-gray-400"><span className="text-5xl mb-3">📷</span><p>ไม่พบสินค้า</p></div>
          : <div className="px-4 pb-4 space-y-2 mt-1">
              {filtered.map(p=>(
                <div key={p.id} onClick={()=>navigate(`/inventory/${p.id}`)}
                  className="card flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform">
                  {p.images?.[0]
                    ? <img src={p.images[0]} className="w-16 h-16 rounded-xl object-cover flex-shrink-0"/>
                    : <div className="w-16 h-16 rounded-xl bg-amber-100 flex items-center justify-center text-3xl flex-shrink-0">📷</div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate flex-1">{p.model}</p>
                      <span className={`${STATUS_CLASS[p.status]} text-xs font-semibold px-2 py-0.5 rounded-full`}>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-medium">{p.category||'กล้อง'}</span>
                      <span className="text-xs text-gray-400 truncate">SN: {p.serial_number}</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <p className="text-xs text-gray-500">ต้นทุน ฿{fmt(p.total_cost)}</p>
                      <p className="text-xs font-semibold text-amber-600">เกรด {p.condition}</p>
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {p.created_at && (
                        <p className="text-xs text-gray-300">📥 {thDateShort(p.created_at)}</p>
                      )}
                      {p.sold_date && (
                        <p className="text-xs text-gray-300">📤 {thDateShort(p.sold_date)}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
      }
    </div>
  )
}
