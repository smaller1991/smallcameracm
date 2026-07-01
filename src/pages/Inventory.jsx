import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { thDateShort } from '../lib/dateUtils'
import { Search, Plus, ArrowUpDown, ArrowLeftRight, ShoppingCart, X } from 'lucide-react'
import DeferredImageButton from '../components/DeferredImageButton'
import CachedImage from '../components/CachedImage'

const TABS     = [{key:'all',label:'ทั้งหมด'},{key:'Available',label:'พร้อมขาย'},{key:'Reserved',label:'จอง'},{key:'Pending',label:'รอชำระ'},{key:'Sold',label:'ขายแล้ว'}]
const CAT_TABS = ['ทั้งหมด','กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const SORT_OPTIONS = [
  {key:'created_at_desc',label:'วันที่ล่าสุด'},{key:'created_at_asc',label:'วันที่เก่าสุด'},
  {key:'model_asc',label:'ชื่อ A-Z'},{key:'model_desc',label:'ชื่อ Z-A'},
  {key:'category_asc',label:'ประเภทสินค้า'},
  {key:'total_cost_asc',label:'ราคาน้อย→มาก'},{key:'total_cost_desc',label:'ราคามาก→น้อย'},
]
const STATUS_LABEL = {Available:'พร้อมขาย',Reserved:'จอง',Sold:'ขายแล้ว',Pending:'รอชำระ'}
const STATUS_CLASS  = {Available:'badge-available',Reserved:'badge-reserved',Sold:'badge-sold',Pending:'badge-pending'}
const fmt = n => Number(n||0).toLocaleString('th-TH')

export default function Inventory() {
  const navigate = useNavigate()
  const [products,setProducts] = useState([])
  const [loading, setLoading]  = useState(true)
  const [search,  setSearch]   = useState('')
  const [tab,     setTab]      = useState('Available')
  const [catTab,  setCatTab]   = useState('ทั้งหมด')
  const [sortKey, setSortKey]  = useState('created_at_desc')
  const [showSort,setShowSort] = useState(false)
  const [inventoryValue, setInventoryValue] = useState(0)
  const [lightboxImg,   setLightboxImg]   = useState(null)
  const [tradeImageMap, setTradeImageMap] = useState({})

  useEffect(() => {
    supabase.from('products').select('*, transactions(images, category)')
      .then(async ({data}) => {
        const prods = data || []
        setProducts(prods)
        setLoading(false)

        // หา receipt image สำหรับสินค้า trade-in:
        // product B (is_trade_in) ไม่มี transaction ตรงๆ
        // ต้องหา product A ที่มี trade_ref_id = productB.id → ดึง Trade transaction ของ A
        const tradeIns = prods.filter(p => p.is_trade_in)
        if (tradeIns.length > 0) {
          const { data: productAs } = await supabase
            .from('products')
            .select('trade_ref_id, transactions(images, category)')
            .in('trade_ref_id', tradeIns.map(p => p.id))
          const map = {}
          ;(productAs || []).forEach(pA => {
            const img = pA.transactions?.find(t => t.category === 'Trade')?.images?.[0]
            if (img && pA.trade_ref_id) map[pA.trade_ref_id] = img
          })
          setTradeImageMap(map)
        }
      })

    // มูลค่าสินค้าคงคลัง = Available + Reserved เท่านั้น
    supabase.from('products').select('total_cost, status')
      .in('status', ['Available', 'Reserved'])
      .then(({data: p}) => {
        setInventoryValue((p||[]).reduce((a,x) => a + Number(x.total_cost), 0))
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
  const activeTabIndex = Math.max(0, TABS.findIndex(t => t.key === tab))

  // มูลค่าคงคลัง โหลดจาก state ที่ query มาแล้ว

  return (
    <div>
      <div className="inventory-filter-panel sticky top-0 z-10 px-4 py-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input autoComplete="off" className="input pl-9" placeholder="ค้นหารุ่นหรือ Serial..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <button onClick={()=>setShowSort(!showSort)}
            className={`liquid-chip flex items-center gap-1 px-3 py-2 text-sm font-medium ${showSort?'is-active':''}`}>
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
        <div className="liquid-filter-track grid-cols-5 mt-2">
          <span
            className="liquid-filter-indicator"
            style={{ width: 'calc((100% - .5rem) / 5)', transform: `translateX(${activeTabIndex * 100}%)` }}
          />
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)}
              className={`liquid-filter-btn inventory-filter-btn px-1 text-[11px] ${tab===t.key?'is-active':''}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="liquid-chip-grid grid-cols-4 mt-1.5">
          {CAT_TABS.map(c=>(
            <button key={c} onClick={()=>setCatTab(c)}
              className={`liquid-chip inventory-filter-btn px-1.5 text-[11px] font-semibold ${c.length > 8 ? 'inventory-filter-btn-compact' : ''} ${catTab===c?'is-active':''}`}>
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
        <div className="flex gap-2">
          <button onClick={()=>navigate('/tradein')}
            className="inventory-action-btn inventory-action-btn-trade flex items-center gap-1 px-3 py-1.5 text-sm font-semibold active:scale-95 transition-all">
            <ArrowLeftRight size={14}/>แลกเปลี่ยน
          </button>
          <button onClick={()=>navigate('/bulk-sale')}
            className="inventory-action-btn inventory-action-btn-sale flex items-center gap-1 px-3 py-1.5 text-sm font-semibold active:scale-95 transition-all">
            <ShoppingCart size={14}/>ขายรวม
          </button>
          <button onClick={()=>navigate('/inventory/add')} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1">
            <Plus size={15}/>เพิ่มสินค้า
          </button>
        </div>
      </div>

      {loading
        ? <div className="flex justify-center pt-20"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
        : filtered.length===0
          ? <div className="flex flex-col items-center pt-24 text-gray-400"><span className="text-5xl mb-3">📷</span><p>ไม่พบสินค้า</p></div>
          : <div className="px-4 pb-4 space-y-1.5 mt-1">
              {(() => {
                // batch image map: batch_id → รูปแรกจากชิ้นที่มี Buy Stock transaction
                const batchImageMap = {}
                products.forEach(p => {
                  if (p.batch_id) {
                    const img = p.transactions?.find(t => t.category === 'Buy Stock')?.images?.[0]
                    if (img) batchImageMap[p.batch_id] = img
                  }
                })
                return filtered.map(p => {
                const coverImg =
                  p.transactions?.find(t => t.category === 'Buy Stock')?.images?.[0]  // ซื้อปกติ
                  || (p.batch_id && batchImageMap[p.batch_id])                          // ซื้อพร้อมกัน
                  || (p.is_trade_in && tradeImageMap[p.id])                             // แลกเปลี่ยน
                return (
                  <div key={p.id} onClick={()=>navigate(`/inventory/${p.id}`)}
                    className={`card p-2.5 flex items-center gap-2.5 cursor-pointer active:scale-[0.98] transition-transform ${p.is_trade_in?'border-blue-300 border-2':''}`}>
                    <div className="flex-shrink-0">
                      {coverImg
                        ? <DeferredImageButton
                            imageUrl={coverImg}
                            className="w-12 h-12"
                            onClick={(e,src)=>{e.stopPropagation();setLightboxImg(src || coverImg)}}
                          />
                        : <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${p.is_trade_in?'bg-blue-100':'bg-amber-100'}`}>📷</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-sm truncate flex-1">{p.model}</p>
                        <div className="flex gap-1 flex-shrink-0">
                          {p.is_trade_in && <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">🔄</span>}
                          <span className={`${STATUS_CLASS[p.status]} text-xs font-semibold px-2 py-0.5 rounded-full`}>{STATUS_LABEL[p.status]}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-medium">{p.category||'กล้อง'}</span>
                        <span className="text-xs text-gray-400 truncate">SN: {p.serial_number}</span>
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <p className="text-xs text-gray-500">฿{fmt(p.total_cost)} · เกรด {p.condition}</p>
                        {p.sold_date
                          ? <p className="text-xs text-gray-300">📤 {thDateShort(p.sold_date)}</p>
                          : p.created_at && <p className="text-xs text-gray-300">📥 {thDateShort(p.created_at)}</p>}
                      </div>
                      {p.status==='Pending' && p.installment_total && (
                        <p className="text-xs text-orange-500 font-medium mt-0.5">
                          รอชำระ ฿{fmt(Number(p.installment_total)-Number(p.installment_paid||0))}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })})()}
            </div>
      }

      {lightboxImg && (
        <div className="fixed inset-0 bg-black/92 z-50 flex items-center justify-center p-4"
          onClick={()=>setLightboxImg(null)}>
          <button className="absolute top-4 right-4 bg-black/50 rounded-full p-2 text-white z-10">
            <X size={20}/>
          </button>
          <CachedImage src={lightboxImg} className="max-w-full max-h-full rounded-xl object-contain"/>
        </div>
      )}
    </div>
  )
}
