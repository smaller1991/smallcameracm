/**
 * Format วันที่/เวลา ทั้งระบบ
 * รูปแบบ: DD/MM/YYYY HH:mm (24 ชั่วโมง)
 */

export function thDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const dd   = String(d.getDate()).padStart(2,'0')
  const mm   = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = d.getFullYear()
  const hh   = String(d.getHours()).padStart(2,'0')
  const min  = String(d.getMinutes()).padStart(2,'0')
  return `${dd}/${mm}/${yyyy} ${hh}.${min}`
}

export function thDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const dd   = String(d.getDate()).padStart(2,'0')
  const mm   = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export function toLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0,16)
}

export function nowLocal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0,16)
}

export function nowThaiDate() {
  return thDate(new Date().toISOString())
}

// Parses "DD/MM/YYYY HH.mm" or "DD/MM/YYYY" → Date (local time)
export function parseThaiDate(str, endOfDay = false) {
  if (!str) return null
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})\.(\d{2}))?$/)
  if (!m) return null
  const hasTime = m[4] != null
  const h   = hasTime ? Number(m[4]) : (endOfDay ? 23 : 0)
  const min = hasTime ? Number(m[5]) : (endOfDay ? 59 : 0)
  const sec = hasTime ? 0 : (endOfDay ? 59 : 0)
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, min, sec)
}
