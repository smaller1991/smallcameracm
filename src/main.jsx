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
      className: 'app-toast',
      duration: 3500,
      style: {
        fontFamily: 'Sarabun,sans-serif',
        borderRadius: '16px',
        background: '#55100C',
        color: '#FFFFFF',
        border: '1px solid #8B241B',
        padding: '12px 16px',
        fontWeight: 700,
      },
      success: { iconTheme: { primary: '#FFFFFF', secondary: '#167A45' } },
      error:   { iconTheme: { primary: '#FFFFFF', secondary: '#B42318' } },
    }}/>
  </React.StrictMode>
)
