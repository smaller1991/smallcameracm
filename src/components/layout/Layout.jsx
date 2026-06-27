import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, Package, DollarSign, Download, LogOut, Sun, Moon } from 'lucide-react'

const nav = [
  { to: '/',         icon: LayoutDashboard, label: 'หน้าหลัก' },
  { to: '/inventory',icon: Package,         label: 'สต็อก'    },
  { to: '/finance',  icon: DollarSign,      label: 'บัญชี'    },
  { to: '/export',   icon: Download,        label: 'ข้อมูล'   },
]

const FONT_SIZES = [14, 16, 18, 20]
const FONT_LABELS = ['S', 'M', 'L', 'XL']

export default function Layout() {
  const signOut  = useAuthStore(s => s.signOut)
  const navigate = useNavigate()
  const location = useLocation()

  const [fontIdx, setFontIdx] = useState(() => Number(localStorage.getItem('cs_fontsize') || 1))
  const [dark,    setDark]    = useState(() => localStorage.getItem('cs_dark') === '1')
  const activeIndex = Math.max(0, nav.findIndex(item => item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)))

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZES[fontIdx] + 'px'
    localStorage.setItem('cs_fontsize', fontIdx)
  }, [fontIdx])

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('cs_dark', dark ? '1' : '0')
  }, [dark])

  const decrease = () => setFontIdx(i => Math.max(0, i - 1))
  const increase = () => setFontIdx(i => Math.min(FONT_SIZES.length - 1, i + 1))

  return (
    <div className="app-shell flex flex-col min-h-screen max-w-[430px] mx-auto bg-brand-light">
      <header className="app-header w-full h-16 flex items-center justify-between px-4 z-40 overflow-visible">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Snapman CM" className="h-24 w-auto object-contain drop-shadow-lg"/>
        </div>
        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button onClick={() => setDark(d => !d)}
            className="header-icon-btn text-brand-dark/70 hover:text-brand-dark transition-colors p-1.5 rounded-2xl">
            {dark ? <Sun size={17}/> : <Moon size={17}/>}
          </button>

          {/* Font size controls */}
          <div className="header-pill flex items-center gap-0.5 rounded-2xl px-1 py-0.5">
            <button onClick={decrease} disabled={fontIdx===0}
              className="text-brand-dark/60 hover:text-brand-dark disabled:opacity-30 w-6 h-6 flex items-center justify-center text-sm font-bold">
              A-
            </button>
            <span className="text-brand-dark text-xs font-bold w-4 text-center">{FONT_LABELS[fontIdx]}</span>
            <button onClick={increase} disabled={fontIdx===FONT_SIZES.length-1}
              className="text-brand-dark/60 hover:text-brand-dark disabled:opacity-30 w-6 h-6 flex items-center justify-center text-sm font-bold">
              A+
            </button>
          </div>

          <button onClick={async () => { await signOut(); navigate('/login') }}
            className="header-icon-btn text-brand-dark/55 hover:text-brand-dark transition-colors p-1.5 rounded-2xl">
            <LogOut size={18}/>
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto pb-24"><Outlet/></main>
      <nav className="app-bottom-nav fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] pb-safe z-40">
        <div className="liquid-nav-track relative grid grid-cols-4 items-center mx-3 mt-2 mb-1 px-1 py-1.5">
          <span
            className="liquid-nav-indicator"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `liquid-nav-item relative z-10 flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-[20px] text-[11px] transition-all duration-300 ease-out
                 ${isActive ? 'is-active text-brand-dark font-bold' : 'text-brand-dark/45 hover:text-brand-dark/75'}`}>
              <Icon size={22} strokeWidth={2}/>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
