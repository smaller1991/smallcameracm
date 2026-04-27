import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import 'react-datepicker/dist/react-datepicker.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster position="top-center" toastOptions={{
      style: { fontFamily: 'Sarabun,sans-serif', borderRadius: '12px', background: '#1A1208', color: '#FFF8EC' },
      success: { iconTheme: { primary: '#FFB838', secondary: '#1A1208' } },
      error:   { iconTheme: { primary: '#D32F23', secondary: '#fff' } },
    }}/>
  </React.StrictMode>
)
