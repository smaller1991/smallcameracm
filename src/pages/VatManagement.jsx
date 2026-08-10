import { useEffect, useMemo, useState } from 'react'
import {
  Building2, CalendarDays, CheckCircle2, FileClock, FileText, Printer,
  ReceiptText, Save, Search, Settings2, ShieldCheck, Trash2, XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { createVatDraft, openVatDocumentPrint, openVatReportPrint, vatSourceKey } from '../lib/vat'

const fmt = value => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nowMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const thDate = value => new Date(value).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
const statusMeta = {
  draft: { label: 'ฉบับร่าง', icon: FileClock },
  issued: { label: 'ออกแล้ว', icon: CheckCircle2 },
  void: { label: 'ยกเลิก', icon: XCircle },
}
const documentTypeLabel = type => type === 'abbreviated' ? 'อย่างย่อ' : 'เต็มรูป'

const emptySettings = {
  id: 'main', enabled: true, vat_rate: 7, prices_include_vat: true,
  business_name: 'SMALL CAMERA', seller_name: '', business_tax_id: '', business_address: '',
  business_branch: 'สำนักงานใหญ่', business_phone: '', invoice_prefix: 'TAX',
  sequence_reset: 'yearly', footer_note: '', abbreviated_enabled: true,
  abbreviated_invoice_prefix: 'ABB', abbreviated_sequence_reset: 'yearly',
  abbreviated_last_sequence_key: null, abbreviated_last_invoice_number: 0,
  default_document_type: 'abbreviated', abbreviated_footer_note: '',
}

export default function VatManagement() {
  const [tab, setTab] = useState('documents')
  const [documents, setDocuments] = useState([])
  const [settings, setSettings] = useState(emptySettings)
  const [month, setMonth] = useState(nowMonth())
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [customerForm, setCustomerForm] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [missingSales, setMissingSales] = useState([])

  const load = async () => {
    setLoading(true)
    const [settingsRes, docsRes, missingRes] = await Promise.all([
      supabase.from('vat_settings').select('*').eq('id', 'main').single(),
      supabase.from('vat_documents').select('*').order('document_date', { ascending: false }),
      supabase.from('transactions').select('id,date,category,amount,payment_method,product_id,trade_sell_a,products(id,model,serial_number,installment_total,sold_price,sale_batch_id,customer_note)').is('vat_document_id', null).in('category', ['Sale','Trade']).order('date', { ascending: true }),
    ])
    if (settingsRes.error || docsRes.error || missingRes.error) {
      const message = settingsRes.error?.message || docsRes.error?.message || missingRes.error?.message
      toast.error(message?.includes('does not exist') ? 'กรุณารันไฟล์ supabase_vat_migration.sql ก่อน' : message)
    } else {
      setSettings({ ...emptySettings, ...settingsRes.data })
      setDocuments(docsRes.data || [])
      setMissingSales(missingRes.data || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const selected = documents.find(doc => doc.id === selectedId) || null
  useEffect(() => {
    if (!selected) return setCustomerForm({})
    setCustomerForm({
      customer_name: selected.customer_name || '',
      customer_tax_id: selected.customer_tax_id || '',
      customer_address: selected.customer_address || '',
      customer_branch: selected.customer_branch || '',
      customer_phone: selected.customer_phone || '',
      note: selected.note || '',
      document_type: selected.document_type || settings.default_document_type || 'abbreviated',
    })
  }, [selectedId, selected?.updated_at])

  const monthDocuments = useMemo(() => documents.filter(doc => {
    const d = new Date(doc.document_date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return !month || key === month
  }), [documents, month])

  const filtered = useMemo(() => monthDocuments.filter(doc => {
    if (status !== 'all' && doc.status !== status) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [doc.document_number, doc.customer_name, doc.customer_tax_id, doc.source_key, ...(doc.items || []).map(item => `${item.description} ${item.serial_number}`)]
      .filter(Boolean).join(' ').toLowerCase().includes(q)
  }), [monthDocuments, status, search])

  const activeMonthDocs = monthDocuments.filter(doc => doc.status !== 'void')
  const totalGross = activeMonthDocs.reduce((sum, doc) => sum + Number(doc.total_amount || 0), 0)
  const totalVat = activeMonthDocs.reduce((sum, doc) => sum + Number(doc.vat_amount || 0), 0)
  const totalBase = activeMonthDocs.reduce((sum, doc) => sum + Number(doc.subtotal || 0), 0)
  const draftCount = monthDocuments.filter(doc => doc.status === 'draft').length

  const saveCustomer = async () => {
    if (!selected || selected.status !== 'draft') return
    setSaving(true)
    const before = {
      customer_name: selected.customer_name, customer_tax_id: selected.customer_tax_id,
      customer_address: selected.customer_address, customer_branch: selected.customer_branch,
      customer_phone: selected.customer_phone, note: selected.note,
    }
    const cleaned = Object.fromEntries(Object.entries(customerForm).map(([key, value]) => [key, typeof value === 'string' ? (value.trim() || null) : value]))
    const { data, error } = await supabase.from('vat_documents').update(cleaned).eq('id', selected.id).select().single()
    if (error) toast.error(error.message)
    else {
      await supabase.from('vat_document_events').insert({ document_id: selected.id, action: 'draft_customer_updated', detail: { before, after: cleaned } })
      setDocuments(prev => prev.map(doc => doc.id === data.id ? data : doc))
      toast.success('บันทึกข้อมูลลูกค้าแล้ว')
    }
    setSaving(false)
  }

  const recoverMissingSales = async () => {
    if (!missingSales.length) return
    setSaving(true)
    try {
      const saleGroups = new Map()
      const trades = []
      for (const tx of missingSales) {
        if (tx.category === 'Trade') { trades.push(tx); continue }
        const key = tx.products?.sale_batch_id ? `batch:${tx.products.sale_batch_id}` : `product:${tx.product_id || tx.id}`
        if (!saleGroups.has(key)) saleGroups.set(key, [])
        saleGroups.get(key).push(tx)
      }

      for (const [key, txs] of saleGroups) {
        const products = new Map()
        txs.forEach(tx => {
          if (tx.products?.id) products.set(tx.products.id, tx.products)
        })
        const productRows = [...products.values()]
        const items = productRows.length
          ? productRows.map(product => {
              const price = Number(product.installment_total || product.sold_price || 0)
              return { description: product.model, serial_number: product.serial_number, quantity: 1, unit_price: price, total_amount: price }
            })
          : [{ description: 'รายการขายเดิม', quantity: 1, unit_price: txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) }]
        const grossTotal = items.reduce((sum, item) => sum + Number(item.total_amount ?? item.unit_price), 0)
        await createVatDraft({
          sourceKey: vatSourceKey('recovered', key),
          sourceType: key.startsWith('batch:') ? 'bulk_sale' : (productRows.some(p => p.installment_total) ? 'installment' : 'sale'),
          transactionIds: txs.map(tx => tx.id),
          saleBatchId: productRows[0]?.sale_batch_id || null,
          documentDate: txs[0].date,
          items,
          grossTotal,
          paymentMethod: txs[0].payment_method,
          customerName: productRows[0]?.customer_note || '',
          note: 'สร้างย้อนหลังโดยระบบจากรายการขายที่ยังไม่มีร่าง VAT',
        })
      }

      for (const tx of trades) {
        const grossTotal = Number(tx.trade_sell_a || tx.amount || 0)
        await createVatDraft({
          sourceKey: vatSourceKey('recovered_trade', tx.id),
          sourceType: 'trade',
          transactionIds: [tx.id],
          documentDate: tx.date,
          items: [{ description: tx.products?.model || 'สินค้าแลกเปลี่ยน', serial_number: tx.products?.serial_number || '', quantity: 1, unit_price: grossTotal, total_amount: grossTotal }],
          grossTotal,
          paymentMethod: tx.payment_method,
          note: 'สร้างย้อนหลังโดยระบบจากรายการแลกเปลี่ยนที่ยังไม่มีร่าง VAT',
        })
      }
      toast.success('สร้างร่าง VAT ให้รายการขายตกหล่นแล้ว')
      await load()
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const issueDocument = async documentType => {
    if (!selected || selected.status !== 'draft') return
    if (!settings.business_tax_id || !settings.business_address) {
      setTab('settings')
      return toast.error('กรุณากรอกเลขผู้เสียภาษีและที่อยู่ร้านก่อนออกเอกสาร')
    }
    if (documentType === 'abbreviated' && !settings.abbreviated_enabled) return toast.error('ใบกำกับภาษีอย่างย่อถูกปิดอยู่ในการตั้งค่า')
    if (documentType === 'full' && (!customerForm.customer_name?.trim() || !customerForm.customer_address?.trim())) {
      return toast.error('ใบกำกับภาษีเต็มรูปต้องมีชื่อและที่อยู่ผู้ซื้อ')
    }
    const typeLabel = documentType === 'full' ? 'ใบกำกับภาษีเต็มรูป' : 'ใบกำกับภาษีอย่างย่อ'
    if (!window.confirm(`ออก${typeLabel}และรันเลขจริงตอนนี้หรือไม่?\nหลังออกแล้วข้อมูลภาษีจะถูกล็อก`)) return
    setSaving(true)
    const customerPayload = Object.fromEntries(Object.entries(customerForm)
      .filter(([key]) => key !== 'document_type')
      .map(([key, value]) => [key, typeof value === 'string' ? (value.trim() || null) : value]))
    const { error: saveError } = await supabase.from('vat_documents')
      .update({ ...customerPayload, document_type: documentType })
      .eq('id', selected.id).eq('status', 'draft')
    if (saveError) {
      toast.error(saveError.message)
      setSaving(false)
      return
    }
    const { data, error } = await supabase.rpc('issue_vat_document', { p_document_id: selected.id, p_document_type: documentType })
    if (error) toast.error(error.message)
    else {
      setDocuments(prev => prev.map(doc => doc.id === data.id ? data : doc))
      toast.success(`ออกเอกสาร ${data.document_number} แล้ว`)
    }
    setSaving(false)
  }

  const voidDraft = async () => {
    if (!selected || selected.status !== 'draft') return
    if (!window.confirm('ยกเลิกร่าง VAT นี้หรือไม่?\nร่างที่ยกเลิกแล้วจะไม่ถูกนำไปรวมในยอดรายงาน VAT')) return
    setSaving(true)
    const reason = 'ยกเลิกร่างจากเมนู VAT'
    const { data, error } = await supabase.from('vat_documents').update({ status: 'void', voided_at: new Date().toISOString(), void_reason: reason }).eq('id', selected.id).eq('status', 'draft').select().single()
    if (error) toast.error(error.message)
    else {
      await supabase.from('vat_document_events').insert({ document_id: selected.id, action: 'draft_voided', detail: { reason } })
      setDocuments(prev => prev.map(doc => doc.id === data.id ? data : doc))
      toast.success('ยกเลิกร่าง VAT แล้ว · ไม่รวมในยอดรายงาน')
    }
    setSaving(false)
  }

  const deleteIssuedTestDocument = async () => {
    if (!selected || selected.status !== 'issued') return
    const label = selected.document_number || 'เอกสารที่เลือก'
    const confirmed = window.confirm(
      `ลบ ${label} ซึ่งเป็นเอกสารทดสอบหรือไม่?\n\nรายการขายและยอดบัญชีจะไม่ถูกลบ แต่เลขเอกสารนี้จะไม่ถูกนำกลับมาใช้ซ้ำ`,
    )
    if (!confirmed) return
    setSaving(true)
    const { error } = await supabase.from('vat_documents').delete().eq('id', selected.id)
    if (error) toast.error(error.message)
    else {
      setDocuments(prev => prev.filter(doc => doc.id !== selected.id))
      setSelectedId(null)
      toast.success(`ลบเอกสารทดสอบ ${label} แล้ว`)
      await load()
    }
    setSaving(false)
  }

  const deleteVoidedDocument = async () => {
    if (!selected || selected.status !== 'void') return
    const confirmed = window.confirm(
      'ลบรายการ VAT ที่ยกเลิกแล้วนี้หรือไม่?\n\nจะลบเฉพาะเอกสาร VAT และประวัติของเอกสาร ไม่ลบรายการสินค้าหรือบัญชี',
    )
    if (!confirmed) return
    setSaving(true)
    const { error } = await supabase.from('vat_documents').delete().eq('id', selected.id).eq('status', 'void')
    if (error) toast.error(error.message)
    else {
      setDocuments(prev => prev.filter(doc => doc.id !== selected.id))
      setSelectedId(null)
      toast.success('ลบรายการ VAT ที่ยกเลิกแล้ว')
      await load()
    }
    setSaving(false)
  }

  const printDocument = async doc => {
    try {
      await openVatDocumentPrint(doc, settings, async () => {
        const printedAt = new Date().toISOString()
        await supabase.from('vat_documents').update({ printed_count: Number(doc.printed_count || 0) + 1, last_printed_at: printedAt }).eq('id', doc.id)
        await supabase.from('vat_document_events').insert({ document_id: doc.id, action: 'printed', detail: { status: doc.status } })
        setDocuments(prev => prev.map(item => item.id === doc.id ? { ...item, printed_count: Number(item.printed_count || 0) + 1, last_printed_at: printedAt } : item))
      })
    } catch (error) { toast.error(error.message) }
  }

  const printReport = async () => {
    try {
      await openVatReportPrint(activeMonthDocs, settings, periodLabel)
    } catch (error) { toast.error(error.message) }
  }

  const saveSettings = async () => {
    if (!settings.business_name.trim()) return toast.error('กรุณากรอกชื่อกิจการ')
    if (Number(settings.vat_rate) < 0) return toast.error('อัตรา VAT ไม่ถูกต้อง')
    if (settings.abbreviated_enabled && (settings.invoice_prefix || 'TAX').trim().toUpperCase() === (settings.abbreviated_invoice_prefix || 'ABB').trim().toUpperCase()) return toast.error('คำนำหน้าเลขแบบเต็มรูปและแบบอย่างย่อต้องไม่ซ้ำกัน')
    setSaving(true)
    const payload = {
      id: 'main', enabled: Boolean(settings.enabled), vat_rate: Number(settings.vat_rate),
      prices_include_vat: Boolean(settings.prices_include_vat), business_name: settings.business_name.trim(),
      seller_name: settings.seller_name?.trim() || null,
      business_tax_id: settings.business_tax_id?.trim() || null, business_address: settings.business_address?.trim() || null,
      business_branch: settings.business_branch?.trim() || 'สำนักงานใหญ่', business_phone: settings.business_phone?.trim() || null,
      invoice_prefix: settings.invoice_prefix?.trim().toUpperCase() || 'TAX', sequence_reset: settings.sequence_reset,
      abbreviated_enabled: Boolean(settings.abbreviated_enabled),
      abbreviated_invoice_prefix: settings.abbreviated_invoice_prefix?.trim().toUpperCase() || 'ABB',
      abbreviated_sequence_reset: settings.abbreviated_sequence_reset,
      default_document_type: !settings.abbreviated_enabled || settings.default_document_type === 'full' ? 'full' : 'abbreviated',
      abbreviated_footer_note: settings.abbreviated_footer_note?.trim() || null,
      footer_note: settings.footer_note?.trim() || null,
    }
    const { data, error } = await supabase.from('vat_settings').upsert(payload).select().single()
    if (error) toast.error(error.message)
    else { setSettings({ ...emptySettings, ...data }); toast.success('บันทึกการตั้งค่า VAT แล้ว') }
    setSaving(false)
  }

  const periodLabel = month ? new Date(`${month}-01T12:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }) : 'ทุกช่วงเวลา'

  return (
    <div className="vat-page px-4 py-4 space-y-4">
      <section className="vat-heading">
        <div>
          <p className="vat-kicker">ภาษีมูลค่าเพิ่ม</p>
          <h1 className="text-2xl font-extrabold">จัดการ VAT</h1>
          <p className="text-sm text-gray-500 mt-1">เอกสารร่าง รายงานภาษีขาย และเลขใบกำกับในที่เดียว</p>
        </div>
        <div className={`vat-system-state ${settings.enabled ? 'is-on' : ''}`}>
          <ShieldCheck size={17}/>{settings.enabled ? `VAT ${fmt(settings.vat_rate)}%` : 'ปิด VAT'}
        </div>
      </section>

      <section className="vat-summary-strip">
        <div><span>ยอดรวมเดือนนี้</span><strong>฿{fmt(totalGross)}</strong></div>
        <div><span>ก่อน VAT</span><strong>฿{fmt(totalBase)}</strong></div>
        <div className="vat-summary-accent"><span>ภาษีขาย</span><strong>฿{fmt(totalVat)}</strong></div>
      </section>

      <nav className="vat-tabs" aria-label="ส่วนจัดการ VAT">
        {[
          ['documents', ReceiptText, 'เอกสาร'],
          ['reports', FileText, 'รายงาน'],
          ['settings', Settings2, 'ตั้งค่า'],
        ].map(([value, Icon, label]) => (
          <button key={value} onClick={() => setTab(value)} className={tab === value ? 'is-active' : ''}>
            <Icon size={17}/>{label}
          </button>
        ))}
      </nav>

      {tab === 'documents' && (
        <>
          <section className="vat-toolbar">
            <div className="vat-month-field"><CalendarDays size={16}/><input type="month" value={month} onChange={e => setMonth(e.target.value)}/></div>
            <div className="vat-search-field"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาเลขเอกสาร ลูกค้า รุ่น..."/></div>
            <div className="vat-status-row">
              {[['all','ทั้งหมด'],['draft',`ร่าง ${draftCount}`],['issued','ออกแล้ว'],['void','ยกเลิก']].map(([value,label]) => <button key={value} onClick={() => setStatus(value)} className={status === value ? 'is-active' : ''}>{label}</button>)}
            </div>
            {missingSales.length > 0 && (
              <button className="vat-recovery-action" disabled={saving} onClick={recoverMissingSales}>
                <FileClock size={16}/>ตรวจพบยอดขายที่ยังไม่มี VAT {missingSales.length} รายการ — สร้างร่างให้ครบ
              </button>
            )}
          </section>

          <section className="vat-document-list">
            {loading ? <p className="vat-empty">กำลังโหลด...</p> : filtered.length === 0 ? <p className="vat-empty">ยังไม่มีเอกสาร VAT ในช่วงนี้</p> : filtered.map(doc => {
              const meta = statusMeta[doc.status] || statusMeta.draft
              const StatusIcon = meta.icon
              const isSelected = selectedId === doc.id
              return (
                <button key={doc.id} onClick={() => setSelectedId(isSelected ? null : doc.id)} className={`vat-document-row ${isSelected ? 'is-selected' : ''}`}>
                  <div className={`vat-document-mark is-${doc.status}`}><StatusIcon size={18}/></div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2"><strong className="truncate">{doc.document_number || 'ฉบับร่าง'}</strong><span className={`vat-status is-${doc.status}`}>{meta.label}</span><span className={`vat-doc-type is-${doc.document_type || 'full'}`}>{documentTypeLabel(doc.document_type)}</span></div>
                    <p className="truncate">{doc.customer_name || 'ลูกค้าทั่วไป'} · {(doc.items || []).map(item => item.description).join(', ')}</p>
                    <small>{thDate(doc.document_date)} · VAT ฿{fmt(doc.vat_amount)}</small>
                  </div>
                  <strong className="vat-row-total">฿{fmt(doc.total_amount)}</strong>
                </button>
              )
            })}
          </section>

          {selected && (
            <section className="vat-inspector">
              <div className="vat-inspector-head">
                <div><p className="vat-kicker">รายละเอียดเอกสาร</p><h2>{selected.document_number || 'ฉบับร่างรอข้อมูลลูกค้า'}</h2></div>
                <span className={`vat-status is-${selected.status}`}>{statusMeta[selected.status]?.label}</span>
              </div>

              <div className="vat-locked-sale">
                {(selected.items || []).map((item, index) => <div key={index}><span>{item.description}{item.serial_number ? ` · SN ${item.serial_number}` : ''}</span><strong>฿{fmt(item.total_amount)}</strong></div>)}
                <div><span>มูลค่าก่อน VAT</span><strong>฿{fmt(selected.subtotal)}</strong></div>
                <div><span>VAT {fmt(selected.vat_rate)}%</span><strong>฿{fmt(selected.vat_amount)}</strong></div>
                <div className="vat-grand-total"><span>ยอดรวม</span><strong>฿{fmt(selected.total_amount)}</strong></div>
              </div>

              <div className="vat-document-type-picker">
                <div><strong>ชนิดใบกำกับภาษี</strong><p>{selected.status === 'draft' ? 'เลือกได้จนกว่าจะออกเลขจริง' : 'ชนิดเอกสารถูกล็อกแล้ว'}</p></div>
                <div className="vat-type-options">
                  <button disabled={selected.status !== 'draft' || !settings.abbreviated_enabled} className={(customerForm.document_type || selected.document_type) === 'abbreviated' ? 'is-active' : ''} onClick={() => setCustomerForm({...customerForm, document_type:'abbreviated'})}>อย่างย่อ</button>
                  <button disabled={selected.status !== 'draft'} className={(customerForm.document_type || selected.document_type) === 'full' ? 'is-active' : ''} onClick={() => setCustomerForm({...customerForm, document_type:'full'})}>เต็มรูป</button>
                </div>
              </div>

              <div className="vat-customer-form">
                <label><span>ชื่อลูกค้า</span><input disabled={selected.status !== 'draft'} value={customerForm.customer_name || ''} onChange={e => setCustomerForm({...customerForm, customer_name:e.target.value})} placeholder="ลูกค้าทั่วไป"/></label>
                <label><span>เลขประจำตัวผู้เสียภาษี</span><input disabled={selected.status !== 'draft'} value={customerForm.customer_tax_id || ''} onChange={e => setCustomerForm({...customerForm, customer_tax_id:e.target.value})}/></label>
                <label className="vat-full-field"><span>ที่อยู่</span><textarea disabled={selected.status !== 'draft'} rows="2" value={customerForm.customer_address || ''} onChange={e => setCustomerForm({...customerForm, customer_address:e.target.value})}/></label>
                <label><span>สาขา</span><input disabled={selected.status !== 'draft'} value={customerForm.customer_branch || ''} onChange={e => setCustomerForm({...customerForm, customer_branch:e.target.value})} placeholder="สำนักงานใหญ่"/></label>
                <label><span>โทรศัพท์</span><input disabled={selected.status !== 'draft'} value={customerForm.customer_phone || ''} onChange={e => setCustomerForm({...customerForm, customer_phone:e.target.value})}/></label>
                <label className="vat-full-field"><span>หมายเหตุ</span><textarea disabled={selected.status !== 'draft'} rows="2" value={customerForm.note || ''} onChange={e => setCustomerForm({...customerForm, note:e.target.value})}/></label>
              </div>

              <div className="vat-actions">
                {selected.status === 'draft' && <button className="vat-secondary-action" disabled={saving} onClick={saveCustomer}><Save size={16}/>บันทึกร่าง</button>}
                <button className="vat-secondary-action" onClick={() => printDocument({...selected, ...customerForm, document_type:customerForm.document_type || selected.document_type})}><Printer size={16}/>{selected.status === 'draft' ? 'พิมพ์ตัวอย่าง' : 'พิมพ์ซ้ำ'}</button>
                {selected.status === 'draft' && settings.abbreviated_enabled && <button className="vat-issue-type-action is-abbreviated" disabled={saving} onClick={() => issueDocument('abbreviated')}><ReceiptText size={16}/>ออกแบบอย่างย่อ</button>}
                {selected.status === 'draft' && <button className="vat-issue-type-action is-full" disabled={saving} onClick={() => issueDocument('full')}><CheckCircle2 size={16}/>ออกแบบเต็มรูป</button>}
                {selected.status === 'draft' && <button className="vat-void-action" disabled={saving} onClick={voidDraft}><XCircle size={16}/>ยกเลิกร่าง</button>}
                {selected.status === 'issued' && <button className="vat-delete-test-action" disabled={saving} onClick={deleteIssuedTestDocument}><XCircle size={16}/>ลบเอกสารทดสอบ</button>}
                {selected.status === 'void' && <button className="vat-delete-void-action" disabled={saving} onClick={deleteVoidedDocument}><Trash2 size={16}/>ลบรายการยกเลิก</button>}
              </div>
              {selected.status === 'issued' && <p className="vat-audit-note">พิมพ์แล้ว {selected.printed_count || 0} ครั้ง · เอกสารที่ออกแล้วถูกล็อกเพื่อรักษาประวัติภาษี</p>}
            </section>
          )}
        </>
      )}

      {tab === 'reports' && (
        <section className="vat-report-workspace">
          <div className="vat-report-head">
            <div><p className="vat-kicker">รายงานภาษีขาย</p><h2>{periodLabel}</h2></div>
            <button onClick={printReport}><Printer size={16}/>พิมพ์รายงาน</button>
          </div>
          <div className="vat-report-totals">
            <div><span>มูลค่าก่อน VAT</span><strong>฿{fmt(totalBase)}</strong></div>
            <div><span>ภาษีขาย</span><strong>฿{fmt(totalVat)}</strong></div>
            <div><span>ภาษีซื้อใช้หัก</span><strong>฿0.00</strong><small>รับซื้อจากบุคคลทั่วไป</small></div>
            <div className="is-payable"><span>ประมาณการ VAT นำส่ง</span><strong>฿{fmt(totalVat)}</strong></div>
          </div>
          <div className="vat-report-table-wrap">
            <table className="vat-report-table"><thead><tr><th>วันที่/เอกสาร</th><th>ลูกค้า</th><th>ก่อน VAT</th><th>VAT</th><th>รวม</th></tr></thead><tbody>
              {activeMonthDocs.map(doc => <tr key={doc.id}><td><strong>{thDate(doc.document_date)}</strong><small>{doc.document_number || 'ฉบับร่าง'} · {documentTypeLabel(doc.document_type)}</small></td><td>{doc.customer_name || 'ลูกค้าทั่วไป'}</td><td>฿{fmt(doc.subtotal)}</td><td>฿{fmt(doc.vat_amount)}</td><td>฿{fmt(doc.total_amount)}</td></tr>)}
              {!activeMonthDocs.length && <tr><td colSpan="5" className="vat-empty">ไม่มีรายการในเดือนนี้</td></tr>}
            </tbody></table>
          </div>
          <p className="vat-audit-note">ยอดฉบับร่างรวมอยู่ในรายงานเพื่อให้ภาษีขายตรงกับวันที่ขายจริง ส่วนเอกสารยกเลิกจะไม่รวมยอด</p>
        </section>
      )}

      {tab === 'settings' && (
        <section className="vat-settings-workspace">
          <div className="vat-setting-toggle">
            <div><strong>เปิดระบบ VAT</strong><p>การขายใหม่จะสร้างเอกสารร่างและคำนวณภาษีอัตโนมัติ</p></div>
            <button onClick={() => setSettings({...settings, enabled:!settings.enabled})} className={settings.enabled ? 'is-on' : ''}><span/></button>
          </div>

          <div className="vat-settings-section is-business">
            <div className="vat-settings-section-head"><h3>รายละเอียดผู้ขายบน PDF</h3><p>เรียงตามลำดับที่แสดงบนใบกำกับภาษี</p></div>
            <div className="vat-settings-grid">
              <label className="vat-full-field"><span>ชื่อกิจการ</span><input value={settings.business_name || ''} onChange={e => setSettings({...settings,business_name:e.target.value})} placeholder="SMALL CAMERA"/></label>
              <label className="vat-full-field"><span>ชื่อผู้ขาย</span><input value={settings.seller_name || ''} onChange={e => setSettings({...settings,seller_name:e.target.value})} placeholder="ชื่อบุคคลหรือชื่อนิติบุคคล"/></label>
              <label className="vat-full-field"><span>เลขประจำตัวผู้เสียภาษี</span><input value={settings.business_tax_id || ''} onChange={e => setSettings({...settings,business_tax_id:e.target.value})} placeholder="13 หลัก"/></label>
              <label className="vat-full-field"><span>ที่อยู่</span><textarea rows="3" value={settings.business_address || ''} onChange={e => setSettings({...settings,business_address:e.target.value})}/></label>
              <label className="vat-full-field"><span>เบอร์โทร</span><input value={settings.business_phone || ''} onChange={e => setSettings({...settings,business_phone:e.target.value})}/></label>
              <label className="vat-full-field"><span>สาขา</span><input value={settings.business_branch || ''} onChange={e => setSettings({...settings,business_branch:e.target.value})}/></label>
            </div>
          </div>

          <div className="vat-settings-section">
            <div className="vat-settings-section-head"><h3>การคำนวณ VAT</h3><p>ใช้อัตราเดียวกันทั้งเต็มรูปและอย่างย่อ</p></div>
            <div className="vat-settings-grid">
              <label><span>อัตรา VAT (%)</span><input type="number" step="0.01" value={settings.vat_rate} onChange={e => setSettings({...settings,vat_rate:e.target.value})}/></label>
              <label><span>รูปแบบราคา</span><select value={settings.prices_include_vat ? 'inclusive':'exclusive'} onChange={e => setSettings({...settings,prices_include_vat:e.target.value==='inclusive'})}><option value="inclusive">ราคารวม VAT แล้ว</option><option value="exclusive">ราคายังไม่รวม VAT</option></select></label>
              <label className="vat-full-field"><span>ประเภทร่างเริ่มต้น</span><select value={settings.default_document_type || 'abbreviated'} onChange={e => setSettings({...settings,default_document_type:e.target.value})}><option value="abbreviated">ใบกำกับภาษีอย่างย่อ</option><option value="full">ใบกำกับภาษีเต็มรูป</option></select></label>
            </div>
          </div>

          <div className="vat-settings-section">
            <div className="vat-settings-section-head"><h3>ใบกำกับภาษีเต็มรูป</h3><p>สำหรับผู้ซื้อที่ให้ชื่อและที่อยู่ครบ</p></div>
            <div className="vat-settings-grid">
              <label><span>คำนำหน้าเลข</span><input value={settings.invoice_prefix || ''} onChange={e => setSettings({...settings,invoice_prefix:e.target.value})} placeholder="TAX"/></label>
              <label><span>เริ่มเลขใหม่</span><select value={settings.sequence_reset} onChange={e => setSettings({...settings,sequence_reset:e.target.value})}><option value="yearly">ทุกปี</option><option value="monthly">ทุกเดือน</option><option value="never">ไม่เริ่มใหม่</option></select></label>
              <label className="vat-full-field"><span>ข้อความท้ายเอกสาร</span><textarea rows="2" value={settings.footer_note || ''} onChange={e => setSettings({...settings,footer_note:e.target.value})}/></label>
            </div>
          </div>

          <div className="vat-settings-section is-abbreviated">
            <div className="vat-settings-section-head vat-setting-inline"><div><h3>ใบกำกับภาษีอย่างย่อ</h3><p>สำหรับลูกค้าทั่วไปที่ไม่ให้ข้อมูลครบ</p></div><button aria-label="เปิดใบกำกับภาษีอย่างย่อ" onClick={() => setSettings({...settings,abbreviated_enabled:!settings.abbreviated_enabled,default_document_type:settings.abbreviated_enabled ? 'full' : settings.default_document_type})} className={`vat-mini-toggle ${settings.abbreviated_enabled ? 'is-on' : ''}`}><span/></button></div>
            <div className="vat-settings-grid">
              <label><span>คำนำหน้าเลข</span><input disabled={!settings.abbreviated_enabled} value={settings.abbreviated_invoice_prefix || ''} onChange={e => setSettings({...settings,abbreviated_invoice_prefix:e.target.value})} placeholder="ABB"/></label>
              <label><span>เริ่มเลขใหม่</span><select disabled={!settings.abbreviated_enabled} value={settings.abbreviated_sequence_reset || 'yearly'} onChange={e => setSettings({...settings,abbreviated_sequence_reset:e.target.value})}><option value="yearly">ทุกปี</option><option value="monthly">ทุกเดือน</option><option value="never">ไม่เริ่มใหม่</option></select></label>
              <label className="vat-full-field"><span>ข้อความท้ายใบกำกับภาษีอย่างย่อ</span><textarea disabled={!settings.abbreviated_enabled} rows="2" value={settings.abbreviated_footer_note || ''} onChange={e => setSettings({...settings,abbreviated_footer_note:e.target.value})}/></label>
            </div>
          </div>
          <div className="vat-settings-note"><Building2 size={18}/><p>การตั้งค่าใหม่มีผลกับรายการขายครั้งถัดไป เอกสารเดิมเก็บอัตราและข้อมูลร้าน ณ วันที่ขายไว้แล้ว</p></div>
          <button className="vat-primary-action w-full justify-center" disabled={saving} onClick={saveSettings}><Save size={17}/>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า VAT'}</button>
        </section>
      )}
    </div>
  )
}
