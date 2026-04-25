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
