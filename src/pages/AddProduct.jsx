import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { uploadImages } from '../lib/imageUtils'
import { ChevronLeft, X, ImagePlus } from 'lucide-react'
import toast from 'react-hot-toast'

const CATEGORIES = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','อื่นๆ']

export default function AddProduct() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ serial_number:'', model:'', condition:5, base_cost:'', notes:'', category:'กล้อง' })
  const [files,    setFiles]    = useState([])
  const [previews, setPreviews] = useState([])
  const [saving,   setSaving]   = useState(false)

  const F = (k,v) => setForm(f=>({...f,[k]:v}))

  const addFiles = e => {
    const f = Array.from(e.target.files)
    setFiles(p=>[...p,...f])
    setPreviews(p=>[...p,...f.map(x=>URL.createObjectURL(x))])
  }
  const removeImg = i => {
    URL.revokeObjectURL(previews[i])
    setFiles(f=>f.filter((_,j)=>j!==i))
    setPreviews(p=>p.filter((_,j)=>j!==i))
  }

  const save = async () => {
    if (!form.serial_number||!form.model||!form.base_cost) return toast.error('กรุณากรอกข้อมูลที่จำเป็น')
    setSaving(true)
    try {
      const cost = parseFloat(form.base_cost)
      const {data:p, error} = await supabase.from('products').insert({
        serial_number: form.serial_number.trim(),
        model: form.model.trim(),
        condition: Number(form.condition),
        base_cost: cost, total_cost: cost,
        notes: form.notes,
        category: form.category,
      }).select().single()
      if (error) throw error
      if (files.length) {
        const urls = await uploadImages(supabase, p.id, files)
        await supabase.from('products').update({images:urls}).eq('id',p.id)
      }
      toast.success('เพิ่มสินค้าสำเร็จ!')
      navigate(`/inventory/${p.id}`)
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-100 bg-white sticky top-0 z-10">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24} className="text-brand-dark"/></button>
        <h1 className="font-bold text-brand-dark text-lg">รับสินค้าเข้าสต็อก</h1>
      </div>
      <div className="px-4 py-4 space-y-4">
        {/* Images */}
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-2">รูปภาพ</label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {previews.map((src,i)=>(
              <div key={i} className="relative flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-amber-200">
                <img src={src} className="w-full h-full object-cover"/>
                <button onClick={()=>removeImg(i)} className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5">
                  <X size={12} className="text-white"/>
                </button>
              </div>
            ))}
            <label className="flex-shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow">
              <ImagePlus size={22} className="text-amber-400"/>
              <span className="text-xs text-amber-400 mt-1">เพิ่มรูป</span>
              <input type="file" multiple accept="image/*" className="hidden" onChange={addFiles}/>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">ประเภทสินค้า</label>
          <select className="input" value={form.category} onChange={e=>F('category',e.target.value)}>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">ชื่อรุ่น *</label>
          <input className="input" placeholder="เช่น Fujifilm X100V" value={form.model} onChange={e=>F('model',e.target.value)}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Serial Number *</label>
          <input className="input" placeholder="SN..." value={form.serial_number} onChange={e=>F('serial_number',e.target.value)}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-2">เกรดสภาพ</label>
          <div className="flex gap-2">
            {[5,4,3,2,1].map(c=>(
              <button key={c} onClick={()=>F('condition',c)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${form.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-500 border-gray-200'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">ราคาซื้อ (บาท) *</label>
          <input className="input" type="number" placeholder="0" value={form.base_cost} onChange={e=>F('base_cost',e.target.value)}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">หมายเหตุ</label>
          <textarea className="input resize-none" rows={3} value={form.notes} onChange={e=>F('notes',e.target.value)}/>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary w-full py-3 text-base disabled:opacity-60">
          {saving?'กำลังบันทึก...':'✓ บันทึกสินค้า'}
        </button>
      </div>
    </div>
  )
}
