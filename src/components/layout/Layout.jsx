import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, Package, DollarSign, BarChart2, Download, Camera, LogOut } from 'lucide-react'

const nav = [
  { to: '/',         icon: LayoutDashboard, label: 'หน้าหลัก' },
  { to: '/inventory',icon: Package,         label: 'สต็อก'    },
  { to: '/finance',  icon: DollarSign,      label: 'บัญชี'    },
  { to: '/insights', icon: BarChart2,       label: 'สถิติ'    },
  { to: '/export',   icon: Download,        label: 'ส่งออก'   },
]

export default function Layout() {
  const signOut  = useAuthStore(s => s.signOut)
  const navigate = useNavigate()
  return (
    <div className="flex flex-col min-h-screen max-w-[430px] mx-auto bg-brand-light">
      <header className="flex items-center justify-between px-4 py-3 bg-brand-dark sticky top-0 z-40">
        <div className="flex items-center gap-2 font-bold text-brand-yellow text-lg">
          <Camera size={22} className="text-brand-yellow"/>CamShop
        </div>
        <button onClick={async () => { await signOut(); navigate('/login') }}
          className="text-white/50 hover:text-white transition-colors p-1">
          <LogOut size={18}/>
        </button>
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
