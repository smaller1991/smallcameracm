import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, Package, DollarSign, BarChart2, Download, Upload, Camera, LogOut } from 'lucide-react'

const nav = [
  { to: '/',         icon: LayoutDashboard, label: 'หน้าหลัก' },
  { to: '/inventory',icon: Package,         label: 'สต็อก'    },
  { to: '/finance',  icon: DollarSign,      label: 'บัญชี'    },
  { to: '/insights', icon: BarChart2,       label: 'สถิติ'    },
  { to: '/export',   icon: Download,        label: 'ส่งออก'   },
  { to: '/import',   icon: Upload,          label: 'นำเข้า'   },
]

const FONT_SIZES = [14, 16, 18, 20]
const FONT_LABELS = ['S', 'M', 'L', 'XL']

export default function Layout() {
  const signOut  = useAuthStore(s => s.signOut)
  const navigate = useNavigate()
  const [fontIdx, setFontIdx] = useState(() => {
    const saved = localStorage.getItem('cs_fontsize')
    return saved ? Number(saved) : 1 // default M
  })

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZES[fontIdx] + 'px'
    localStorage.setItem('cs_fontsize', fontIdx)
  }, [fontIdx])

  const decrease = () => setFontIdx(i => Math.max(0, i - 1))
  const increase = () => setFontIdx(i => Math.min(FONT_SIZES.length - 1, i + 1))

  return (
    <div className="flex flex-col min-h-screen max-w-[430px] mx-auto bg-brand-light">
      <header className="flex items-center justify-between px-4 py-3 bg-brand-dark sticky top-0 z-40">
        <div className="flex items-center gap-2 font-bold text-brand-yellow text-lg">
          <Camera size={22} className="text-brand-yellow"/>CamShop
        </div>
        <div className="flex items-center gap-2">
          {/* Font size controls */}
          <div className="flex items-center gap-1 bg-white/10 rounded-lg px-1 py-0.5">
            <button onClick={decrease} disabled={fontIdx===0}
              className="text-white/60 hover:text-white disabled:opacity-30 w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors">
              A-
            </button>
            <span className="text-brand-yellow text-xs font-semibold w-4 text-center">
              {FONT_LABELS[fontIdx]}
            </span>
            <button onClick={increase} disabled={fontIdx===FONT_SIZES.length-1}
              className="text-white/60 hover:text-white disabled:opacity-30 w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors">
              A+
            </button>
          </div>
          <button onClick={async () => { await signOut(); navigate('/login') }}
            className="text-white/50 hover:text-white transition-colors p-1">
            <LogOut size={18}/>
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto pb-24"><Outlet/></main>
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-brand-dark border-t border-white/10 pb-safe z-40">
        <div className="flex items-center justify-around px-1 pt-2 pb-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-[11px] transition-all
                 ${isActive ? 'text-brand-yellow font-semibold' : 'text-white/40 hover:text-white/70'}`}>
              <Icon size={22} strokeWidth={1.8}/>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
