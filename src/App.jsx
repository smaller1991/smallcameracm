import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout        from './components/layout/Layout'
import LoginPage     from './pages/LoginPage'
import Dashboard     from './pages/Dashboard'
import Inventory     from './pages/Inventory'
import ProductDetail from './pages/ProductDetail'
import AddProduct    from './pages/AddProduct'
import Finance       from './pages/Finance'
import Export        from './pages/Export'
import Insights      from './pages/Insights'
import Import        from './pages/Import'
import TradeIn       from './pages/TradeIn'

function Guard({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-brand-light">
      <div className="w-10 h-10 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/>
    </div>
  )
  return user ? children : <Navigate to="/login" replace/>
}

export default function App() {
  const init = useAuthStore(s => s.init)
  useEffect(() => { init() }, [init])
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage/>}/>
        <Route path="/" element={<Guard><Layout/></Guard>}>
          <Route index element={<Dashboard/>}/>
          <Route path="inventory" element={<Inventory/>}/>
          <Route path="inventory/add" element={<AddProduct/>}/>
          <Route path="inventory/:id" element={<ProductDetail/>}/>
          <Route path="finance" element={<Finance/>}/>
          <Route path="export" element={<Export/>}/>
          <Route path="insights" element={<Insights/>}/>
          <Route path="import" element={<Import/>}/>
          <Route path="tradein" element={<TradeIn/>}/>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
