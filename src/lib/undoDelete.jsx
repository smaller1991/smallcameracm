import toast from 'react-hot-toast'
import { RotateCcw, Trash2 } from 'lucide-react'

export function scheduleDelete({ label, onCommit, onUndo, ms = 8000 }) {
  let cancelled = false
  const tid = setTimeout(async () => {
    if (!cancelled) {
      try { await onCommit() }
      catch (e) { toast.error(e.message); onUndo?.() }
    }
  }, ms)

  toast(
    (t) => (
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'14px' }}><Trash2 size={15}/>ลบ <b>{label}</b> แล้ว</span>
        <button
          onClick={() => {
            cancelled = true
            clearTimeout(tid)
            toast.dismiss(t.id)
            onUndo?.()
            toast.success('ยกเลิกการลบแล้ว', { duration: 2000 })
          }}
          style={{
            background:'#FFB838', color:'#1A1208', border:'none',
            borderRadius:'8px', padding:'4px 14px', fontWeight:'bold',
            cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap',
          }}
        ><span style={{ display:'inline-flex', alignItems:'center', gap:'5px' }}><RotateCcw size={13}/>Undo</span></button>
      </div>
    ),
    {
      duration: ms,
      style: { background:'#1A1208', color:'white', borderRadius:'12px', padding:'10px 16px', maxWidth:'360px' },
    }
  )
}
