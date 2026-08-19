import toast from 'react-hot-toast'
import { Trash2, Undo2 } from 'lucide-react'

const pendingDeletes = new Set()

export function scheduleDelete({ label, onCommit, onUndo, ms = 8000, key = label }) {
  const deletionKey = String(key)
  if (pendingDeletes.has(deletionKey)) {
    toast('กำลังย้อนกลับรายการนี้อยู่ กรุณารอสักครู่')
    return
  }
  pendingDeletes.add(deletionKey)
  let cancelled = false
  const tid = setTimeout(async () => {
    if (!cancelled) {
      try { await onCommit() }
      catch (e) { toast.error(e.message); onUndo?.() }
      finally { pendingDeletes.delete(deletionKey) }
    }
  }, ms)

  toast(
    (t) => (
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        <span style={{ fontSize:'14px', display:'inline-flex', alignItems:'center', gap:'6px' }}><Trash2 size={15}/>ลบ <b>{label}</b> แล้ว</span>
        <button
          onClick={() => {
            cancelled = true
            clearTimeout(tid)
            pendingDeletes.delete(deletionKey)
            toast.dismiss(t.id)
            onUndo?.()
            toast.success('ยกเลิกการลบแล้ว', { duration: 2000 })
          }}
          style={{
            background:'#D32F23', color:'#fff', border:'none',
            borderRadius:'8px', padding:'4px 14px', fontWeight:'bold',
            cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap',
          }}
        ><span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Undo2 size={13}/>Undo</span></button>
      </div>
    ),
    {
      duration: ms,
      style: { background:'#1A1208', color:'white', borderRadius:'12px', padding:'10px 16px', maxWidth:'360px' },
    }
  )
}
