import { forwardRef, useEffect, useState } from 'react'
import ReactDatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

const NoAutoInput = forwardRef(({ className, ...props }, ref) => (
  <input {...props} ref={ref} autoComplete="off" className={className} />
))

const pad = n => String(n).padStart(2, '0')

function toStr(date, showTime) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  if (!showTime) return `${y}-${m}-${d}`
  return `${y}-${m}-${d}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// รับ "1635" หรือ "16:35" → ส่งคืน "16:35"
function parseTime(str) {
  const digits = str.replace(/\D/g, '')
  if (!digits) return '00:00'
  let h, m
  if (digits.length <= 2) {
    h = digits.padStart(2, '0'); m = '00'
  } else if (digits.length === 3) {
    h = ('0' + digits[0]); m = digits.slice(1)
  } else {
    h = digits.slice(0, 2); m = digits.slice(2, 4)
  }
  if (Number(h) > 23) h = '23'
  if (Number(m) > 59) m = '59'
  return `${h}:${m}`
}

function SmartTimeInput({ value, onChange }) {
  const [display, setDisplay] = useState(value || '')
  useEffect(() => { setDisplay(value || '') }, [value])

  const commit = raw => {
    const formatted = parseTime(raw)
    setDisplay(formatted)
    onChange(formatted)
  }

  return (
    <input
      type="text"
      value={display}
      onChange={e => setDisplay(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value) } }}
      placeholder="เช่น 1635"
      style={{ width: 72, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
    />
  )
}

export default function ThaiDatePicker({ value, onChange, showTime = false, className = 'input', placeholder }) {
  const selected = value ? new Date(value) : null

  return (
    <ReactDatePicker
      selected={selected}
      onChange={date => onChange(toStr(date, showTime))}
      dateFormat={showTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy'}
      showTimeInput={showTime}
      timeInputLabel="เวลา:"
      customTimeInput={<SmartTimeInput />}
      customInput={<NoAutoInput className={className} />}
      placeholderText={placeholder || (showTime ? 'วว/ดด/ปปปป 00:00' : 'วว/ดด/ปปปป')}
      isClearable
      popperPlacement="bottom-start"
    />
  )
}
