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
  const activeNavIndex = Math.max(0, nav.findIndex(item =>
    item.to === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.to)
  ))

  return (
    <div className="flex flex-col min-h-screen max-w-[430px] mx-auto bg-brand-light">
      <header className="fixed top-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-[406px] h-14 flex items-center justify-between px-3 bg-brand-dark z-40 overflow-visible rounded-2xl border border-white/60">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Snapman CM" className="h-20 w-auto object-contain"/>
        </div>
        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button onClick={() => setDark(d => !d)}
            className="text-gray-500 hover:text-brand-dark transition-colors p-1.5 rounded-xl hover:bg-white">
            {dark ? <Sun size={17}/> : <Moon size={17}/>}
          </button>

          {/* Font size controls */}
          <div className="flex items-center gap-0.5 bg-white rounded-xl px-1 py-0.5 border border-white/50">
            <button onClick={decrease} disabled={fontIdx===0}
              className="text-gray-500 hover:text-brand-dark disabled:opacity-30 w-6 h-6 flex items-center justify-center text-sm font-bold">
              A-
            </button>
            <span className="text-brand-yellow text-xs font-semibold w-4 text-center">{FONT_LABELS[fontIdx]}</span>
            <button onClick={increase} disabled={fontIdx===FONT_SIZES.length-1}
              className="text-gray-500 hover:text-brand-dark disabled:opacity-30 w-6 h-6 flex items-center justify-center text-sm font-bold">
              A+
            </button>
          </div>

          <button onClick={async () => { await signOut(); navigate('/login') }}
            className="text-gray-500 hover:text-brand-dark transition-colors p-1.5 rounded-xl hover:bg-white">
            <LogOut size={18}/>
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto pb-28 pt-20"><Outlet/></main>
      <nav className="fixed bottom-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-[406px] bg-brand-dark border border-white/60 pb-safe z-40 rounded-2xl overflow-hidden">
        <div className="relative grid px-1 pt-2 pb-1" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          <div
            className="app-bottom-nav-indicator"
            style={{ width: `${100 / nav.length}%`, transform: `translateX(${activeNavIndex * 100}%)` }}
          />
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `relative z-10 flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-[11px] transition-all duration-300 ease-out
                 ${isActive ? 'text-brand-yellow font-bold scale-[1.08]' : 'text-gray-400 hover:text-brand-dark hover:scale-[1.03]'}`}>
              {({ isActive }) => (
                <>
                  <Icon size={isActive ? 24 : 22} strokeWidth={isActive ? 2.3 : 1.8} className="transition-all duration-300 ease-out"/>
                  <span className="transition-all duration-300 ease-out">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
