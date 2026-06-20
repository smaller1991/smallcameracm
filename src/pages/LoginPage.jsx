import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Camera } from 'lucide-react'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [pass,  setPass]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const signIn   = useAuthStore(s => s.signIn)
  const navigate = useNavigate()

  const submit = async e => {
    e.preventDefault(); setBusy(true)
    try { await signIn(email, pass); navigate('/') }
    catch { toast.error('อีเมลหรือรหัสผ่านไม่ถูกต้อง') }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 mb-10">
        <img src="/logo.png" alt="Snapman CM" className="h-28 w-auto object-contain drop-shadow-xl"/>
        <p className="text-white/50 text-sm">ระบบจัดการร้านกล้องมือสอง</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <label className="text-white/70 text-sm block mb-1.5">อีเมล</label>
          <input autoComplete="off" type="email" required value={email} onChange={e => setEmail(e.target.value)}
            className="w-full rounded-xl border-0 bg-white/10 text-white px-4 py-3 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-brand-yellow"
            placeholder="your@email.com"/>
        </div>
        <div>
          <label className="text-white/70 text-sm block mb-1.5">รหัสผ่าน</label>
          <input autoComplete="off" type="password" required value={pass} onChange={e => setPass(e.target.value)}
            className="w-full rounded-xl border-0 bg-white/10 text-white px-4 py-3 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-brand-yellow"
            placeholder="••••••••"/>
        </div>
        <button type="submit" disabled={busy}
          className="w-full btn-primary py-3 text-base disabled:opacity-60">
          {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  )
}
