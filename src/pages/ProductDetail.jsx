import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { uploadImages, deleteImage } from '../lib/imageUtils'
import { ChevronLeft, Plus, Trash2, Edit2, Check, X, ShoppingBag, ImagePlus, Shield } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = n => Number(n || 0).toLocaleString('th-TH')
const STATUS_LABEL = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว' }
const STATUS_CLASS  = { Available: 'badge-available', Reserved: 'badge-reserved', Sold: 'badge-sold' }

function WarrantyBadge({ expiry }) {
  if (!expiry) return null
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000)
  return days >= 0
    ? <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"><Shield size={11}/>ประกันเหลือ {days} วัน</span>
    : <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"><Shield size={11}/>หมดประกันแล้ว</span>
}

export default function ProductDetail() {
  const { id } = useParams(); const navigate = useNavigate()
  const galleryRef = useRef()
  const [product, setProduct] = useState(null)
  const [accs,    setAccs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [ef,      setEf]      = useState({})
  const [addAcc,  setAddAcc]  = useState(false)
  const [accForm, setAccForm] = useState({ name: '', cost: '' })
  const [sellMode,setSellMode]= useState(false)
  const [soldPrice,setSoldPrice]=useState('')
  const [imgIdx,  setImgIdx]  = useState(0)
  const [saving,  setSaving]  = useState(false)

  const load = async () => {
    const [{ data: p }, { data: a }] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).single(),
      supabase.from('accessories').select('*').eq('product_id', id).order('created_at'),
    ])
    setProduct(p); setAccs(a || [])
    setEf({ model: p.model, serial_number: p.serial_number, condition: p.condition,
            base_cost: p.base_cost, status: p.status, notes: p.notes || '' })
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  const saveEdit = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('products').update({
        model: ef.model, serial_number: ef.serial_number,
        condition: Number(ef.condition), base_cost: parseFloat(ef.base_cost),
        status: ef.status, notes: ef.notes,
      }).eq('id', id)
      if (error) throw error
      toast.success('บันทึกแล้ว'); setEditing(false); load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const saveAcc = async () => {
    if (!accForm.name || !accForm.cost) return toast.error('กรุณากรอกชื่อและราคา')
    setSaving(true)
    try {
      const { error } = await supabase.from('accessories').insert({
        product_id: id, name: accForm.name, cost: parseFloat(accForm.cost)
      })
      if (error) throw error
      toast.success('เพิ่มอุปกรณ์เสริมแล้ว')
      setAccForm({ name: '', cost: '' }); setAddAcc(false); load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const deleteAcc = async acc => {
    if (!confirm(`ลบ "${acc.name}"?`)) return
    await supabase.from('accessories').delete().eq('id', acc.id)
    toast.success('ลบแล้ว'); load()
  }

  const sell = async () => {
    if (!soldPrice) return toast.error('กรุณาระบุราคาขาย')
    setSaving(true)
    try {
      const { error } = await supabase.from('products').update({
        status: 'Sold', sold_price: parseFloat(soldPrice)
      }).eq('id', id)
      if (error) throw error
      toast.success('ขายสำเร็จ! ประกัน 15 วัน')
      setSellMode(false); load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const deleteProduct = async () => {
    if (!confirm('ลบสินค้านี้?')) return
    for (const url of (product.images || [])) await deleteImage(supabase, url)
    await supabase.from('products').delete().eq('id', id)
    toast.success('ลบสินค้าแล้ว'); navigate('/inventory')
  }

  if (loading) return <div className="flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
  if (!product) return <div className="p-8 text-center text-gray-400">ไม่พบสินค้า</div>

  const profit = product.sold_price ? Number(product.sold_price) - Number(product.total_cost) : null

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100 bg-white sticky top-0 z-10">
        <button onClick={() => navigate(-1)}><ChevronLeft size={24}/></button>
        <span className="font-bold truncate max-w-[60%]">{product.model}</span>
        <button onClick={() => setEditing(!editing)} className="p-1.5 text-gray-400 hover:text-brand-dark">
          {editing ? <X size={18}/> : <Edit2 size={18}/>}
        </button>
      </div>

      {/* Gallery */}
      <div className="bg-gray-100 relative">
        {product.images?.length > 0 ? (
          <>
            <div className="swipe-gallery flex overflow-x-auto" ref={galleryRef}
              onScroll={e => setImgIdx(Math.round(e.target.scrollLeft / e.target.offsetWidth))}>
              {product.images.map((src, i) => (
                <div key={i} className="flex-shrink-0 w-full">
                  <img src={src} className="w-full aspect-square object-cover"/>
                </div>
              ))}
            </div>
            {product.images.length > 1 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                {product.images.map((_, i) => (
                  <div key={i} className={`h-1.5 rounded-full transition-all ${i === imgIdx ? 'bg-white w-3' : 'bg-white/50 w-1.5'}`}/>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="aspect-square flex items-center justify-center bg-amber-50 text-6xl">📷</div>
        )}
      </div>

      <div className="px-4 py-4 space-y-3">
        {/* Info / Edit */}
        <div className="card space-y-3">
          {editing ? (
            <>
              {[['ชื่อรุ่น','model','text'],['Serial Number','serial_number','text'],['ราคาซื้อ (บาท)','base_cost','number']].map(([lbl, k, t]) => (
                <div key={k}>
                  <label className="text-xs text-gray-500 mb-1 block">{lbl}</label>
                  <input className="input" type={t} value={ef[k]} onChange={e => setEf({...ef,[k]:e.target.value})}/>
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-500 mb-2 block">เกรดสภาพ</label>
                <div className="flex gap-2">
                  {[5,4,3,2,1].map(c => (
                    <button key={c} onClick={() => setEf({...ef,condition:c})}
                      className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all
                        ${ef.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">สถานะ</label>
                <select className="input" value={ef.status} onChange={e => setEf({...ef,status:e.target.value})}>
                  <option value="Available">พร้อมขาย</option>
                  <option value="Reserved">จอง</option>
                  <option value="Sold">ขายแล้ว</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
                <textarea className="input resize-none" rows={2} value={ef.notes} onChange={e => setEf({...ef,notes:e.target.value})}/>
              </div>
              <button onClick={saveEdit} disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
                <Check size={16}/>บันทึก
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-xl">{product.model}</h2>
                  <p className="text-sm text-gray-400">SN: {product.serial_number}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`${STATUS_CLASS[product.status]} text-xs font-semibold px-2.5 py-0.5 rounded-full`}>{STATUS_LABEL[product.status]}</span>
                  <span className="text-xs text-gray-400">เกรด {product.condition}</span>
                </div>
              </div>
              <WarrantyBadge expiry={product.warranty_expiry}/>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-xs text-gray-400">ต้นทุนเริ่มต้น</p><p className="font-semibold">฿{fmt(product.base_cost)}</p></div>
                <div><p className="text-xs text-gray-400">ต้นทุนรวม</p><p className="font-semibold text-amber-600">฿{fmt(product.total_cost)}</p></div>
                {product.sold_price && (
                  <>
                    <div><p className="text-xs text-gray-400">ราคาขาย</p><p className="font-semibold text-green-600">฿{fmt(product.sold_price)}</p></div>
                    <div><p className="text-xs text-gray-400">กำไร</p><p className={`font-semibold ${profit>=0?'text-green-600':'text-red-500'}`}>{profit>=0?'+':''}฿{fmt(profit)}</p></div>
                  </>
                )}
              </div>
              {product.notes && <p className="text-sm text-gray-500 italic">{product.notes}</p>}
            </>
          )}
        </div>

        {/* Accessories */}
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">อุปกรณ์เสริม</h3>
            {product.status !== 'Sold' && (
              <button onClick={() => setAddAcc(!addAcc)} className="text-brand-yellow text-sm font-medium flex items-center gap-1">
                <Plus size={15}/>เพิ่ม
              </button>
            )}
          </div>
          {addAcc && (
            <div className="bg-amber-50 rounded-xl p-3 mb-3 space-y-2">
              <input className="input text-sm" placeholder="ชื่ออุปกรณ์..." value={accForm.name} onChange={e => setAccForm({...accForm,name:e.target.value})}/>
              <input className="input text-sm" type="number" placeholder="ราคา (บาท)" value={accForm.cost} onChange={e => setAccForm({...accForm,cost:e.target.value})}/>
              <div className="flex gap-2">
                <button onClick={saveAcc} disabled={saving} className="btn-primary flex-1 py-2 text-sm">บันทึก</button>
                <button onClick={() => setAddAcc(false)} className="btn-ghost flex-1 py-2 text-sm">ยกเลิก</button>
              </div>
            </div>
          )}
          {accs.length === 0
            ? <p className="text-xs text-gray-400 text-center py-2">ยังไม่มีอุปกรณ์เสริม</p>
            : accs.map(a => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-amber-50 last:border-0">
                  <div><p className="text-sm">{a.name}</p><p className="text-xs text-gray-400">฿{fmt(a.cost)}</p></div>
                  {product.status !== 'Sold' && (
                    <button onClick={() => deleteAcc(a)} className="p-2 text-gray-300 hover:text-brand-red"><Trash2 size={15}/></button>
                  )}
                </div>
              ))
          }
        </div>

        {/* Sell */}
        {product.status === 'Available' && (
          sellMode ? (
            <div className="card space-y-3">
              <h3 className="font-semibold text-sm">ยืนยันการขาย</h3>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ราคาขายจริง (บาท)</label>
                <input className="input" type="number" placeholder="0" value={soldPrice} onChange={e => setSoldPrice(e.target.value)} autoFocus/>
                {soldPrice && <p className={`text-xs mt-1 font-medium ${Number(soldPrice)-Number(product.total_cost)>=0?'text-green-600':'text-red-500'}`}>
                  กำไร: ฿{fmt(Number(soldPrice)-Number(product.total_cost))}
                </p>}
              </div>
              <div className="flex gap-2">
                <button onClick={sell} disabled={saving} className="btn-primary flex-1 py-3 flex items-center justify-center gap-2">
                  <ShoppingBag size={16}/>ยืนยันขาย
                </button>
                <button onClick={() => setSellMode(false)} className="btn-ghost px-4">ยกเลิก</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setSellMode(true)} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
              <ShoppingBag size={18}/>ขายสินค้า
            </button>
          )
        )}

        {product.status === 'Reserved' && (
          <button onClick={async () => { await supabase.from('products').update({ status: 'Available' }).eq('id', id); load() }}
            className="w-full btn-ghost py-3 text-sm">ยกเลิกการจอง → พร้อมขาย</button>
        )}

        <button onClick={deleteProduct} className="w-full flex items-center justify-center gap-2 text-sm text-red-400 py-2 hover:text-brand-red">
          <Trash2 size={15}/>ลบสินค้านี้
        </button>
      </div>
    </div>
  )
}
