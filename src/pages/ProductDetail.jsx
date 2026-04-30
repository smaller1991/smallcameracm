import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { uploadReceiptImages } from '../lib/imageUtils'
import { toLocal } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, Plus, Trash2, Edit2, Check, X, ShoppingBag, Shield, ImagePlus } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = n => Number(n||0).toLocaleString('th-TH')
const STATUS_LABEL = {Available:'พร้อมขาย',Reserved:'จอง',Sold:'ขายแล้ว'}
const STATUS_CLASS  = {Available:'badge-available',Reserved:'badge-reserved',Sold:'badge-sold'}
const CATEGORIES    = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']

function WarrantyBadge({expiry}) {
  if (!expiry) return null
  const days = Math.ceil((new Date(expiry)-new Date())/86400000)
  return days>=0
    ? <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"><Shield size={11}/>ประกันเหลือ {days} วัน</span>
    : <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"><Shield size={11}/>หมดประกันแล้ว</span>
}


export default function ProductDetail() {
  const {id} = useParams()
  const navigate = useNavigate()
  const [product,  setProduct]  = useState(null)
  const [accs,     setAccs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [ef,       setEf]       = useState({})

  // accessories
  const [addAcc,       setAddAcc]       = useState(false)
  const [accName,      setAccName]      = useState('')
  const [accCost,      setAccCost]      = useState('')
  const [accPayMethod, setAccPayMethod] = useState('โอน')

  // edit images
  const [editNewFiles,    setEditNewFiles]    = useState([])
  const [editNewPreviews, setEditNewPreviews] = useState([])
  const [removedUrls,     setRemovedUrls]     = useState([])
  const [txImages,        setTxImages]        = useState([])
  const [lightboxImg,     setLightboxImg]     = useState(null)

  // sell
  const [sellMode,     setSellMode]     = useState(false)
  const [soldPrice,    setSoldPrice]    = useState('')
  const [payMethod,    setPayMethod]    = useState('โอน')
  const [sellDate,     setSellDate]     = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [sellImgFiles, setSellImgFiles] = useState([])
  const [sellImgPrev,  setSellImgPrev]  = useState([])

  const load = async () => {
    const [{data:p},{data:a},{data:txs}] = await Promise.all([
      supabase.from('products').select('*').eq('id',id).single(),
      supabase.from('accessories').select('*').eq('product_id',id).order('created_at'),
      supabase.from('transactions').select('id,category,images,date').eq('product_id',id).order('date'),
    ])
    setProduct(p); setAccs(a||[])
    setTxImages((txs||[]).flatMap(t => t.images || []))
    setEf({model:p.model, serial_number:p.serial_number, condition:p.condition,
           base_cost:p.base_cost, status:p.status, notes:p.notes||'',
           category:p.category||'กล้อง', created_at:toLocal(p.created_at),
           customer_note:p.customer_note||''})
    setEditNewFiles([]); setEditNewPreviews([]); setRemovedUrls([])
    setLoading(false)
  }
  useEffect(()=>{load()},[id])

  // ─── save edit ─────────────────────────────────────────────
  const saveEdit = async () => {
    setSaving(true)
    try {
      const updateData = {
        model: ef.model, serial_number: ef.serial_number,
        condition: Number(ef.condition), base_cost: parseFloat(ef.base_cost),
        status: ef.status, notes: ef.notes, category: ef.category,
        customer_note: ef.customer_note?.trim() || null,
      }
      if (ef.created_at) updateData.created_at = new Date(ef.created_at).toISOString()
      const {error} = await supabase.from('products').update(updateData).eq('id',id)
      if (error) throw error
      toast.success('บันทึกแล้ว'); setEditing(false); load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── accessories ───────────────────────────────────────────
  const saveAcc = async () => {
    if (!accName||!accCost) return toast.error('กรุณากรอกชื่อและราคา')
    setSaving(true)
    try {
      const cost = parseFloat(accCost)

      // บันทึก accessory
      const {error} = await supabase.from('accessories').insert({ product_id:id, name:accName, cost })
      if (error) throw error

      // สร้าง transaction Expense / Add-on
      await supabase.from('transactions').insert({
        type: 'Expense', category: 'Add-on', amount: cost,
        product_id: id, payment_method: accPayMethod,
        date: new Date().toISOString(),
        note: `Add-on: ${accName} — ${product.model} SN:${product.serial_number}`,
      })

      // หักยอด balance
      const { data: bal } = await supabase.from('balances').select('*').eq('id','main').single()
      if (bal) {
        const upd = accPayMethod === 'โอน'
          ? { bank: Math.max(0, Number(bal.bank) - cost) }
          : { cash: Math.max(0, Number(bal.cash) - cost) }
        await supabase.from('balances').update({ ...upd, updated_at: new Date().toISOString() }).eq('id','main')
      }

      toast.success(`เพิ่ม Add-on แล้ว — หัก ${accPayMethod} ฿${cost.toLocaleString('th-TH')}`)
      setAccName(''); setAccCost(''); setAccPayMethod('โอน')
      setAddAcc(false); load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  const deleteAcc = async (acc) => {
    if (!confirm('ลบ "'+acc.name+'"?')) return
    await supabase.from('accessories').delete().eq('id',acc.id)
    toast.success('ลบแล้ว'); load()
  }

  // ─── sell ──────────────────────────────────────────────────
  const sell = async () => {
    if (!soldPrice) return toast.error('กรุณาระบุราคาขาย')
    setSaving(true)
    try {
      const price  = parseFloat(soldPrice)
      const soldAt = sellDate ? new Date(sellDate).toISOString() : new Date().toISOString()
      const warrantyExp = new Date(new Date(soldAt).getTime()+15*86400000).toISOString()

      // 1. อัปเดตสินค้า
      const {error} = await supabase.from('products').update({
        status:'Sold', sold_price:price, payment_method:payMethod,
        sold_date:soldAt, warranty_expiry:warrantyExp,
        customer_note: customerNote.trim() || null,
      }).eq('id',id)
      if (error) throw error

      // 2. สร้าง transaction Income
      const {data:newTx, error:txErr} = await supabase.from('transactions').insert({
        date: soldAt, type:'Income', category:'Sale', amount:price,
        product_id: id, payment_method: payMethod,
        note: 'ขายสินค้า: '+product.model+' SN:'+product.serial_number,
      }).select().single()
      if (txErr) throw txErr

      // 3. upload รูปใบเสร็จ → receipt-images ตั้งชื่อตาม spec
      if (sellImgFiles.length && newTx) {
        const meta = {
          model:         product.model,
          serial_number: product.serial_number,
          created_at:    product.created_at,
          sold_date:     soldAt,
        }
        const imgUrls = await uploadReceiptImages(supabase, newTx.id, sellImgFiles, meta)
        await supabase.from('transactions').update({ images: imgUrls }).eq('id', newTx.id)
      }

      // 4. บวกยอด balance
      const {data:bal} = await supabase.from('balances').select('*').eq('id','main').single()
      if (bal) {
        if (payMethod==='โอน') {
          await supabase.from('balances').update({bank:Number(bal.bank)+price, updated_at:new Date().toISOString()}).eq('id','main')
        } else {
          await supabase.from('balances').update({cash:Number(bal.cash)+price, updated_at:new Date().toISOString()}).eq('id','main')
        }
      }

      toast.success('ขายสำเร็จ! ช่องทาง: '+payMethod)
      setSellMode(false)
      setSellImgFiles([]); setSellImgPrev([])
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── cancel sale ───────────────────────────────────────────
  const cancelSale = async () => {
    if (!confirm('ยกเลิกการขายสินค้านี้?\nยอดเงินและรายการบัญชีจะถูกลบคืนอัตโนมัติ')) return
    setSaving(true)
    try {
      const price  = Number(product.sold_price||0)
      const method = product.payment_method

      // 1. คืนสถานะสินค้า
      await supabase.from('products').update({
        status:'Available', sold_price:null,
        payment_method:null, sold_date:null, warranty_expiry:null,
      }).eq('id',id)

      // 2. หักยอด balance คืน
      if (price>0 && method) {
        const {data:bal} = await supabase.from('balances').select('*').eq('id','main').single()
        if (bal) {
          if (method==='โอน') {
            await supabase.from('balances').update({
              bank: Math.max(0, Number(bal.bank)-price),
              updated_at: new Date().toISOString()
            }).eq('id','main')
          } else {
            await supabase.from('balances').update({
              cash: Math.max(0, Number(bal.cash)-price),
              updated_at: new Date().toISOString()
            }).eq('id','main')
          }
        }
      }

      // 3. ลบ transaction Sale ทั้งหมดของสินค้านี้
      await supabase.from('transactions')
        .delete()
        .eq('product_id', id)
        .eq('category', 'Sale')

      toast.success('ยกเลิกการขายแล้ว ยอดเงินและรายการบัญชีถูกลบแล้ว')
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── cancel trade ──────────────────────────────────────────
  const cancelTrade = async () => {
    if (!confirm('ยกเลิกการแลกเปลี่ยนนี้?\n• สินค้า A จะกลับมาเป็นพร้อมขาย\n• สินค้า B จะถูกลบออกจากสต็อก')) return
    setSaving(true)
    try {
      const productAId = product.is_trade_in ? product.trade_ref_id : id
      const productBId = product.is_trade_in ? id : product.trade_ref_id

      const { data: tradeTx } = await supabase
        .from('transactions').select('*')
        .eq('product_id', productAId).eq('category', 'Trade').single()

      await supabase.from('products').update({
        status: 'Available', sold_price: null, sold_date: null,
        warranty_expiry: null, payment_method: null, trade_ref_id: null,
      }).eq('id', productAId)

      if (productBId) {
        await supabase.from('transactions').delete().eq('product_id', productBId)
        await supabase.from('products').delete().eq('id', productBId)
      }

      if (tradeTx) {
        await supabase.from('transactions').delete().eq('id', tradeTx.id)
        const { data: bal } = await supabase.from('balances').select('*').eq('id', 'main').single()
        if (bal) {
          let bank = Number(bal.bank), cash = Number(bal.cash)
          if (tradeTx.type === 'Income') {
            if (tradeTx.payment_method === 'โอน') bank -= Number(tradeTx.amount)
            else cash -= Number(tradeTx.amount)
          } else {
            if (tradeTx.payment_method === 'โอน') bank += Number(tradeTx.amount)
            else cash += Number(tradeTx.amount)
          }
          await supabase.from('balances').update({
            bank: Math.max(0, bank), cash: Math.max(0, cash),
            updated_at: new Date().toISOString()
          }).eq('id', 'main')
        }
      }

      toast.success('ยกเลิกการแลกเปลี่ยนแล้ว')
      if (product.is_trade_in) navigate('/inventory')
      else load()
    } catch(e) { toast.error(e.message) } finally { setSaving(false) }
  }

  // ─── delete product ────────────────────────────────────────
  const deleteProduct = async () => {
    if (!confirm('ลบสินค้านี้?\nรายการบัญชีทั้งหมดจะถูกลบด้วย')) return
    setSaving(true)
    try {
      await supabase.from('transactions').delete().eq('product_id', id)
      await supabase.from('products').delete().eq('id', id)
      toast.success('ลบสินค้าแล้ว'); navigate('/inventory')
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  if (loading) return <div className="flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
  if (!product) return <div className="p-8 text-center text-gray-400">ไม่พบสินค้า</div>
  const profit = product.sold_price ? Number(product.sold_price)-Number(product.total_cost) : null
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100 bg-white sticky top-0 z-10">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24}/></button>
        <span className="font-bold truncate max-w-xs">{product.model}</span>
        <button onClick={()=>setEditing(!editing)} className="p-1.5 text-gray-400">
          {editing ? <X size={18}/> : <Edit2 size={18}/>}
        </button>
      </div>

      <div className="px-4 py-4 space-y-3">

        {/* Info / Edit form */}
        <div className="card space-y-3">
          {editing ? (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ประเภทสินค้า</label>
                <select className="input" value={ef.category} onChange={e=>setEf({...ef,category:e.target.value})}>
                  {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ชื่อรุ่น</label>
                <input autoComplete="off" className="input" value={ef.model} onChange={e=>setEf({...ef,model:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Serial Number</label>
                <input autoComplete="off" className="input" value={ef.serial_number} onChange={e=>setEf({...ef,serial_number:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ราคาซื้อ (บาท)</label>
                <input autoComplete="off" className="input" type="number" value={ef.base_cost} onChange={e=>setEf({...ef,base_cost:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-2 block">เกรดสภาพ</label>
                <div className="flex gap-2">
                  {[5,4,3,2,1].map(c=>(
                    <button key={c} onClick={()=>setEf({...ef,condition:c})}
                      className={"flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all "+(ef.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200')}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">สถานะ</label>
                <select className="input" value={ef.status} onChange={e=>setEf({...ef,status:e.target.value})}>
                  <option value="Available">พร้อมขาย</option>
                  <option value="Reserved">จอง</option>
                  <option value="Sold">ขายแล้ว</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
                <textarea className="input resize-none" rows={2} value={ef.notes} onChange={e=>setEf({...ef,notes:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">รายละเอียดลูกค้า</label>
                <textarea className="input resize-none" rows={2} placeholder="ชื่อ / เบอร์โทร / หมายเหตุลูกค้า..." value={ef.customer_note||''} onChange={e=>setEf({...ef,customer_note:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลารับเข้า</label>
                <ThaiDatePicker value={ef.created_at} onChange={v=>setEf({...ef,created_at:v})} showTime className="input w-full"/>
              </div>
              <button onClick={saveEdit} disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
                <Check size={16}/>{saving?'กำลังบันทึก...':'บันทึก'}
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
                  <span className={STATUS_CLASS[product.status]+' text-xs font-semibold px-2.5 py-0.5 rounded-full'}>{STATUS_LABEL[product.status]}</span>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-medium">{product.category||'กล้อง'}</span>
                  <span className="text-xs text-gray-400">เกรด {product.condition}</span>
                </div>
              </div>
              <WarrantyBadge expiry={product.warranty_expiry}/>
              {product.payment_method && (
                <span className={"inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full "+(product.payment_method==='โอน'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700')}>
                  ชำระ: {product.payment_method}
                </span>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-xs text-gray-400">ต้นทุนเริ่มต้น</p><p className="font-semibold">฿{fmt(product.base_cost)}</p></div>
                <div><p className="text-xs text-gray-400">ต้นทุนรวม</p><p className="font-semibold text-amber-600">฿{fmt(product.total_cost)}</p></div>
                {product.sold_price && (
                  <>
                    <div><p className="text-xs text-gray-400">ราคาขาย</p><p className="font-semibold text-green-600">฿{fmt(product.sold_price)}</p></div>
                    <div><p className="text-xs text-gray-400">กำไร</p><p className={"font-semibold "+(profit>=0?'text-green-600':'text-red-500')}>{profit>=0?'+':''}฿{fmt(profit)}</p></div>
                  </>
                )}
              </div>
              {product.notes && <p className="text-sm text-gray-500 italic">{product.notes}</p>}
              {product.customer_note && (
                <div className="bg-blue-50 rounded-xl px-3 py-2">
                  <p className="text-xs text-blue-400 mb-0.5">👤 รายละเอียดลูกค้า</p>
                  <p className="text-sm text-blue-700 whitespace-pre-wrap">{product.customer_note}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Images */}
        {txImages.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-sm mb-2">รูปภาพ ({txImages.length})</h3>
            <div className="flex gap-2 overflow-x-auto pb-1 swipe-gallery">
              {txImages.map((url,i)=>(
                <img key={i} src={url} onClick={()=>setLightboxImg(url)}
                  className="w-20 h-20 rounded-xl object-cover flex-shrink-0 cursor-zoom-in active:scale-95 transition-transform"/>
              ))}
            </div>
          </div>
        )}

        {/* Accessories */}
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">อุปกรณ์เสริม</h3>
            {product.status!=='Sold' && (
              <button onClick={()=>setAddAcc(!addAcc)} className="text-brand-yellow text-sm font-medium flex items-center gap-1">
                <Plus size={15}/>เพิ่ม
              </button>
            )}
          </div>
          {addAcc && (
            <div className="bg-amber-50 rounded-xl p-3 mb-3 space-y-2">
              <input autoComplete="off" className="input text-sm" placeholder="ชื่ออุปกรณ์..." value={accName} onChange={e=>setAccName(e.target.value)}/>
              <input autoComplete="off" className="input text-sm" type="number" placeholder="ราคา (บาท)" value={accCost} onChange={e=>setAccCost(e.target.value)}/>
              <div>
                <p className="text-xs text-gray-500 mb-1">ช่องทางการชำระ</p>
                <div className="flex gap-2">
                  {['โอน','เงินสด'].map(m=>(
                    <button key={m} onClick={()=>setAccPayMethod(m)}
                      className={`flex-1 py-1.5 rounded-xl text-sm font-semibold border transition-all
                        ${accPayMethod===m?(m==='โอน'?'bg-blue-500 text-white border-blue-500':'bg-green-600 text-white border-green-600'):'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':'💵 เงินสด'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={saveAcc} disabled={saving} className="btn-primary flex-1 py-2 text-sm">
                  {saving?'...':'บันทึก'}
                </button>
                <button onClick={()=>{setAddAcc(false);setAccPayMethod('โอน')}} className="btn-ghost flex-1 py-2 text-sm">ยกเลิก</button>
              </div>
            </div>
          )}
          {accs.length===0
            ? <p className="text-xs text-gray-400 text-center py-2">ยังไม่มีอุปกรณ์เสริม</p>
            : accs.map(a=>(
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-amber-50 last:border-0">
                  <div><p className="text-sm">{a.name}</p><p className="text-xs text-gray-400">฿{fmt(a.cost)}</p></div>
                  {product.status!=='Sold' && (
                    <button onClick={()=>deleteAcc(a)} className="p-2 text-gray-300 hover:text-brand-red"><Trash2 size={15}/></button>
                  )}
                </div>
              ))
          }
        </div>

        {/* Sell */}
        {product.status==='Available' && (
          sellMode ? (
            <div className="card space-y-3">
              <h3 className="font-semibold text-sm">ยืนยันการขาย</h3>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ราคาขายจริง (บาท)</label>
                <input autoComplete="off" className="input" type="number" placeholder="0" value={soldPrice} onChange={e=>setSoldPrice(e.target.value)} autoFocus/>
                {soldPrice && (
                  <p className={"text-xs mt-1 font-medium "+(Number(soldPrice)-Number(product.total_cost)>=0?'text-green-600':'text-red-500')}>
                    กำไร: ฿{fmt(Number(soldPrice)-Number(product.total_cost))}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลาที่ขาย</label>
                <ThaiDatePicker value={sellDate} onChange={setSellDate} showTime className="input w-full"/>
                <p className="text-xs text-gray-400 mt-1">หากไม่ระบุจะใช้เวลาปัจจุบัน</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">รูปใบเสร็จ / หลักฐาน (ไปแสดงในหน้าบัญชี)</label>
                <div className="flex gap-2 flex-wrap">
                  {sellImgPrev.map((src,i)=>(
                    <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-green-300 flex-shrink-0">
                      <img src={src} className="w-full h-full object-cover"/>
                      <button onClick={()=>{
                        URL.revokeObjectURL(sellImgPrev[i])
                        setSellImgFiles(f=>f.filter((_,j)=>j!==i))
                        setSellImgPrev(p=>p.filter((_,j)=>j!==i))
                      }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                        <X size={10} className="text-white"/>
                      </button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
                    <ImagePlus size={16} className="text-amber-400"/>
                    <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
                    <input autoComplete="off" type="file" multiple accept="image/*" className="hidden" onChange={e=>{
                      const files = Array.from(e.target.files)
                      setSellImgFiles(p=>[...p,...files])
                      setSellImgPrev(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
                    }}/>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-2 block">ช่องทางการชำระเงิน</label>                <div className="flex gap-2">
                  {['โอน','เงินสด'].map(m=>(
                    <button key={m} onClick={()=>setPayMethod(m)}
                      className={"flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all "+(payMethod===m?(m==='โอน'?'bg-blue-600 text-white border-blue-600':'bg-green-600 text-white border-green-600'):'bg-white text-gray-400 border-gray-200')}>
                      {m==='โอน'?'💳 โอน':'💵 เงินสด'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {payMethod==='โอน'?'✅ ยอดจะบวกเพิ่มใน "ยอดโอน" อัตโนมัติ':'✅ ยอดจะบวกเพิ่มใน "เงินสด" อัตโนมัติ'}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">รายละเอียดลูกค้า (ไม่บังคับ)</label>
                <textarea className="input resize-none text-sm" rows={2}
                  placeholder="ชื่อ / เบอร์โทร / หมายเหตุลูกค้า..."
                  value={customerNote} onChange={e=>setCustomerNote(e.target.value)}/>
              </div>
              <div className="flex gap-2">
                <button onClick={sell} disabled={saving} className="btn-primary flex-1 py-3 flex items-center justify-center gap-2">
                  <ShoppingBag size={16}/>ยืนยันขาย
                </button>
                <button onClick={()=>setSellMode(false)} className="btn-ghost px-4">ยกเลิก</button>
              </div>
            </div>
          ) : (
            <button onClick={()=>{setSellMode(true);setSellDate('');setCustomerNote('');setSellImgFiles([]);setSellImgPrev([])}} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
              <ShoppingBag size={18}/>ขายสินค้า
            </button>
          )
        )}

        {product.status==='Reserved' && (
          <button onClick={async()=>{await supabase.from('products').update({status:'Available'}).eq('id',id);load()}}
            className="w-full btn-ghost py-3 text-sm">ยกเลิกการจอง → พร้อมขาย</button>
        )}

        {product.status==='Sold' && !product.trade_ref_id && (
          <button onClick={cancelSale} disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-sm text-orange-500 border border-orange-200 rounded-xl py-2.5 hover:bg-orange-50 transition-colors">
            ↩️ ยกเลิกการขาย (คืนสถานะ + หักยอดเงิน)
          </button>
        )}

        {((product.status==='Sold' && product.trade_ref_id) || product.is_trade_in) && (
          <button onClick={cancelTrade} disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-sm text-blue-500 border border-blue-200 rounded-xl py-2.5 hover:bg-blue-50 transition-colors">
            ↩️ ยกเลิกการแลกเปลี่ยน (คืนสถานะ + ลบสินค้า B)
          </button>
        )}

        <button onClick={deleteProduct} disabled={saving}
          className="w-full flex items-center justify-center gap-2 text-sm text-red-400 py-2 hover:text-brand-red transition-colors">
          <Trash2 size={15}/>ลบสินค้านี้
        </button>
      </div>

      {lightboxImg && (
        <div className="fixed inset-0 bg-black/92 z-50 flex items-center justify-center p-4"
          onClick={()=>setLightboxImg(null)}>
          <button className="absolute top-4 right-4 bg-black/50 rounded-full p-2 text-white z-10">
            <X size={20}/>
          </button>
          <img src={lightboxImg} className="max-w-full max-h-full rounded-xl object-contain"/>
        </div>
      )}
    </div>
  )
}
