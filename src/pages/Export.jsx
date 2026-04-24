import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { exportInventory, exportTransactions } from '../lib/exportUtils'
import { Download, Package, FileText } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Export() {
  const [invFilter, setInvFilter] = useState('all')
  const [from,      setFrom]      = useState('')
  const [to,        setTo]        = useState('')
  const [busy,      setBusy]      = useState(false)

  const doExportInv = async () => {
    setBusy(true)
    try {
      const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false })
      exportInventory(data || [], invFilter)
      toast.success('ดาวน์โหลดสำเร็จ!')
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  const doExportTx = async () => {
    setBusy(true)
    try {
      const { data } = await supabase.from('transactions').select('*, products(model)').order('date', { ascending: false })
      exportTransactions(data || [], from || undefined, to || undefined)
      toast.success('ดาวน์โหลดสำเร็จ!')
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="font-bold text-xl text-brand-dark">ส่งออกข้อมูล</h1>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"><Package size={20} className="text-green-600"/></div>
          <div><p className="font-semibold">ส่งออกสต็อกสินค้า</p><p className="text-xs text-gray-400">รายชิ้น พร้อมต้นทุนสะสม</p></div>
        </div>
        <select className="input" value={invFilter} onChange={e => setInvFilter(e.target.value)}>
          <option value="all">ทั้งหมด</option>
          <option value="Available">พร้อมขาย</option>
          <option value="Reserved">จอง</option>
          <option value="Sold">ขายแล้ว</option>
        </select>
        <button onClick={doExportInv} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>ดาวน์โหลด สต็อกสินค้า.xlsx
        </button>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center"><FileText size={20} className="text-amber-600"/></div>
          <div><p className="font-semibold">ส่งออกรายการบัญชี</p><p className="text-xs text-gray-400">รายรับ-รายจ่าย เลือกช่วงวันได้</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 mb-1 block">ตั้งแต่วันที่</label><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)}/></div>
          <div><label className="text-xs text-gray-500 mb-1 block">ถึงวันที่</label><input className="input" type="date" value={to} onChange={e => setTo(e.target.value)}/></div>
        </div>
        <p className="text-xs text-gray-400">หากไม่ระบุวันที่ จะส่งออกทั้งหมด</p>
        <button onClick={doExportTx} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
          <Download size={16}/>ดาวน์โหลด รายการบัญชี.xlsx
        </button>
      </div>
    </div>
  )
}
