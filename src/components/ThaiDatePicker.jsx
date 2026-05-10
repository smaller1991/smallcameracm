import { useState, useRef, useEffect } from 'react'

const ITEM_H   = 44
const VISIBLE  = 5   // rows shown; center row = selected
const PAD      = Math.floor(VISIBLE / 2)

const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const pad = n => String(n).padStart(2, '0')
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const YEAR_START = 2015

// ── single scroll drum ─────────────────────────────────────────
function DrumCol({ items, idx, onSelect, width = 'flex-1' }) {
  const ref      = useRef()
  const timer    = useRef()
  const settling = useRef(false)

  // initial position (no animation)
  useEffect(() => { ref.current?.scrollTo({ top: idx * ITEM_H }) }, [])

  // scroll when idx changes from parent (e.g. day clamp)
  useEffect(() => {
    if (!settling.current) {
      ref.current?.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' })
    }
  }, [idx])

  const snap = () => {
    settling.current = false
    if (!ref.current) return
    const i = Math.max(0, Math.min(items.length - 1, Math.round(ref.current.scrollTop / ITEM_H)))
    ref.current.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
    onSelect(i)
  }

  const onScroll = () => {
    settling.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(snap, 130)
  }

  return (
    <div className={`relative ${width}`} style={{ height: ITEM_H * VISIBLE, overflow: 'hidden' }}>
      {/* selection highlight */}
      <div className="absolute inset-x-0 pointer-events-none z-10 border-y border-amber-400/50 bg-amber-400/10"
        style={{ top: PAD * ITEM_H, height: ITEM_H }} />
      {/* fade top */}
      <div className="absolute inset-x-0 top-0 pointer-events-none z-10 bg-gradient-to-b from-white dark:from-[#1A1208] to-transparent"
        style={{ height: PAD * ITEM_H }} />
      {/* fade bottom */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none z-10 bg-gradient-to-t from-white dark:from-[#1A1208] to-transparent"
        style={{ height: PAD * ITEM_H }} />

      <div ref={ref} onScroll={onScroll}
        className="h-full overflow-y-scroll"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', scrollSnapType: 'y mandatory' }}>
        <div style={{ height: PAD * ITEM_H }} />
        {items.map((label, i) => (
          <div key={i}
            style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
            className={`flex items-center justify-center select-none transition-colors ${
              i === idx
                ? 'text-amber-500 dark:text-brand-yellow font-bold text-base'
                : 'text-gray-400 text-sm'
            }`}>
            {label}
          </div>
        ))}
        <div style={{ height: PAD * ITEM_H }} />
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────
export default function ThaiDatePicker({ value, onChange, showTime = false, className = 'input', placeholder }) {
  const now      = new Date()
  const YEAR_END = now.getFullYear() + 2

  const yearList  = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => String(YEAR_START + i))
  const monthList = MONTHS_TH
  const hourList  = Array.from({ length: 24 }, (_, i) => pad(i))
  const minList   = Array.from({ length: 60 }, (_, i) => pad(i))

  const parse = () => {
    const d = value ? new Date(value) : now
    return {
      day:  d.getDate() - 1,
      mon:  d.getMonth(),
      year: Math.max(0, Math.min(yearList.length - 1, d.getFullYear() - YEAR_START)),
      hour: d.getHours(),
      min:  d.getMinutes(),
    }
  }

  const [open, setOpen] = useState(false)
  const [sel,  setSel]  = useState(parse)

  const dayList = Array.from(
    { length: daysInMonth(YEAR_START + sel.year, sel.mon) },
    (_, i) => pad(i + 1)
  )

  // clamp day when month/year changes
  useEffect(() => {
    const max = daysInMonth(YEAR_START + sel.year, sel.mon) - 1
    if (sel.day > max) setSel(s => ({ ...s, day: max }))
  }, [sel.mon, sel.year])

  // sync drums when value prop changes externally
  useEffect(() => { if (!open) setSel(parse()) }, [value])

  const openPicker = () => { setSel(parse()); setOpen(true) }

  const commit = () => {
    const y = YEAR_START + sel.year
    const m = pad(sel.mon + 1)
    const d = pad(sel.day + 1)
    onChange(showTime
      ? `${y}-${m}-${d}T${pad(sel.hour)}:${pad(sel.min)}`
      : `${y}-${m}-${d}`)
    setOpen(false)
  }

  const clear = e => { e.stopPropagation(); onChange('') }

  const displayVal = value ? (() => {
    const d = new Date(value)
    const base = `${pad(d.getDate())} ${MONTHS_TH[d.getMonth()]} ${d.getFullYear()}`
    return showTime ? `${base}  ${pad(d.getHours())}:${pad(d.getMinutes())}` : base
  })() : ''

  return (
    <>
      <div className="relative flex items-center">
        <input
          readOnly
          value={displayVal}
          onClick={openPicker}
          className={`${className} cursor-pointer ${value ? 'pr-7' : ''}`}
          placeholder={placeholder || (showTime ? 'วว ดด ปปปป 00:00' : 'วว ดด ปปปป')}
        />
        {value && (
          <button onClick={clear}
            className="absolute right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onPointerDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>

          <div className="bg-white dark:bg-[#1A1208] rounded-t-2xl w-full max-w-[430px] mx-auto">
            {/* toolbar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-white/10">
              <button className="text-gray-400 text-sm py-1 px-2" onClick={() => setOpen(false)}>ยกเลิก</button>
              <span className="font-semibold text-sm dark:text-white">
                {showTime ? 'เลือกวันที่และเวลา' : 'เลือกวันที่'}
              </span>
              <button className="text-amber-500 font-bold text-sm py-1 px-2" onClick={commit}>ตกลง</button>
            </div>

            {/* drums */}
            <div className="flex items-stretch px-2 py-1">
              <DrumCol items={dayList}   idx={sel.day}  onSelect={v => setSel(s => ({ ...s, day: v }))}  width="w-14" />
              <DrumCol items={monthList} idx={sel.mon}  onSelect={v => setSel(s => ({ ...s, mon: v }))}  width="flex-1" />
              <DrumCol items={yearList}  idx={sel.year} onSelect={v => setSel(s => ({ ...s, year: v }))} width="w-20" />
              {showTime && (
                <>
                  <div className="flex items-center justify-center text-gray-300 font-bold px-0.5 text-lg">:</div>
                  <DrumCol items={hourList} idx={sel.hour} onSelect={v => setSel(s => ({ ...s, hour: v }))} width="w-14" />
                  <div className="flex items-center justify-center text-gray-300 font-bold px-0.5 text-lg">:</div>
                  <DrumCol items={minList}  idx={sel.min}  onSelect={v => setSel(s => ({ ...s, min: v }))}  width="w-14" />
                </>
              )}
            </div>

            <div style={{ height: 'env(safe-area-inset-bottom, 12px)' }} />
          </div>
        </div>
      )}
    </>
  )
}
