import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { uploadReceiptImages } from '../lib/imageUtils'
import { toLocal, thDateShort, nowLocal } from '../lib/dateUtils'
import ThaiDatePicker from '../components/ThaiDatePicker'
import { ChevronLeft, Plus, Trash2, Edit2, Check, X, ShoppingBag, Shield, ImagePlus } from 'lucide-react'
import DeferredImageButton from '../components/DeferredImageButton'
import CachedImage from '../components/CachedImage'
import toast from 'react-hot-toast'
import { scheduleDelete } from '../lib/undoDelete'

const fmt = n => Number(n||0).toLocaleString('th-TH')
const hasSplitAmounts = tx => Number(tx?.bank_amount || 0) > 0 || Number(tx?.cash_amount || 0) > 0
const isPurchaseInstallmentTx = tx => (
  tx.category === 'Buy Stock'
  && (tx.note || '').includes('ซื้อผ่อน')
)
const isPurchaseInstallmentPaymentTx = tx => (
  tx.category === 'Buy Stock'
  && ((tx.note || '').includes('ซื้อผ่อน') || (tx.note || '').includes('ชำระค่าซื้อ'))
)
const STATUS_LABEL = {Available:'พร้อมขาย',Reserved:'จอง',Sold:'ขายแล้ว',Pending:'รอชำระ'}
const STATUS_CLASS  = {Available:'badge-available',Reserved:'badge-reserved',Sold:'badge-sold',Pending:'badge-pending'}
const CATEGORIES    = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']

function WarrantyBadge({expiry}) {
  if (!expiry) return null
  const days = Math.ceil((new Date(expiry)-new Date())/86400000)
  return days>=0
    ? <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"><Shield size={11}/>ประกันเหลือ {days} วัน</span>
    : <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"><Shield size={11}/>หมดประกันแล้ว</span>
}


export default function ProductDetail() {
  const {id} = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [product,  setProduct]  = useState(null)
  const [accs,     setAccs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [ef,       setEf]       = useState({})

  // accessories
  const [addAcc,       setAddAcc]       = useState(false)
  const [accName,      setAccName]      = useState('')
  const [accCost,      setAccCost]      = useState('')
  const [accPayMethod, setAccPayMethod] = useState('โอน')
  const [accDate,      setAccDate]      = useState('')
  const [accImgFiles,  setAccImgFiles]  = useState([])
  const [accImgPrev,   setAccImgPrev]   = useState([])

  // edit images
  const [editNewFiles,    setEditNewFiles]    = useState([])
  const [editNewPreviews, setEditNewPreviews] = useState([])
  const [removedUrls,     setRemovedUrls]     = useState([])
  const [txList,               setTxList]               = useState([])
  const [lightboxImg,          setLightboxImg]          = useState(null)
  const [batchProducts,        setBatchProducts]        = useState([])
  const [batchSalePaid,        setBatchSalePaid]        = useState(0)
  const [purchaseBatch,        setPurchaseBatch]        = useState([])
  const [purchaseTxList,       setPurchaseTxList]       = useState([])

  // sell
  const [sellMode,     setSellMode]     = useState(false)
  const [sellType,     setSellType]     = useState('full')  // 'full' | 'installment'
  const [soldPrice,    setSoldPrice]    = useState('')
  const [installTotal, setInstallTotal] = useState('')
  const [installFirst, setInstallFirst] = useState('')
  const [payMethod,    setPayMethod]    = useState('โอน')
  const [sellBankAmount, setSellBankAmount] = useState('')
  const [sellCashAmount, setSellCashAmount] = useState('')
  const [sellDate,     setSellDate]     = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [sellImgFiles, setSellImgFiles] = useState([])
  const [sellImgPrev,  setSellImgPrev]  = useState([])

  // pay installment (for Pending products)
  const [payMode,     setPayMode]     = useState(false)
  const [payAmount,   setPayAmount]   = useState('')
  const [payMethod2,  setPayMethod2]  = useState('โอน')
  const [payBankAmount, setPayBankAmount] = useState('')
  const [payCashAmount, setPayCashAmount] = useState('')
  const [payDate2,    setPayDate2]    = useState('')
  const [payImgFiles, setPayImgFiles] = useState([])
  const [payImgPrev,  setPayImgPrev]  = useState([])

  // pay purchase installment
  const [purchasePayMode, setPurchasePayMode] = useState(false)
  const [purchasePayAmount, setPurchasePayAmount] = useState('')
  const [purchasePayMethod, setPurchasePayMethod] = useState('โอน')
  const [purchaseBankAmount, setPurchaseBankAmount] = useState('')
  const [purchaseCashAmount, setPurchaseCashAmount] = useState('')
  const [purchasePayDate, setPurchasePayDate] = useState('')
  const [purchaseImgFiles, setPurchaseImgFiles] = useState([])
  const [purchaseImgPrev, setPurchaseImgPrev] = useState([])

  const load = async () => {
    const [{data:p},{data:a},{data:txs}] = await Promise.all([
      supabase.from('products').select('*').eq('id',id).single(),
      supabase.from('accessories').select('*').eq('product_id',id).order('created_at'),
      supabase.from('transactions').select('id,category,type,amount,payment_method,bank_amount,cash_amount,images,date,note').eq('product_id',id).order('date'),
    ])
    let displayProduct = p
    setAccs(a||[])
    setTxList(txs||[])
    if (p?.sale_batch_id) {
      const { data: bd } = await supabase.from('products').select('*').eq('sale_batch_id', p.sale_batch_id)
      const batchIds = (bd || []).map(item => item.id)
      const { data: batchSaleTxs } = batchIds.length
        ? await supabase.from('transactions')
            .select('product_id,amount')
            .eq('category', 'Sale')
            .in('product_id', batchIds)
        : { data: [] }
      const totalPaidByBatch = (batchSaleTxs || []).reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
      const totalDueByBatch = (bd || []).reduce((sum, item) => sum + Number(item.installment_total || 0), 0)
      setBatchSalePaid(totalPaidByBatch)
      const reconciledBatch = (bd || []).map(item => {
        if (!item.installment_total) return item
        const total = Number(item.installment_total || 0)
        const isFullyPaid = totalDueByBatch > 0 && totalPaidByBatch >= totalDueByBatch
        return {
          ...item,
          installment_paid: isFullyPaid ? total : 0,
          status: isFullyPaid ? 'Sold' : 'Pending',
          sold_price: isFullyPaid ? total : null,
        }
      })
      const updates = reconciledBatch.filter((item, index) => {
        const original = (bd || [])[index]
        return original?.installment_total && (
          Number(original.installment_paid || 0) !== Number(item.installment_paid || 0) ||
          original.status !== item.status ||
          Number(original.sold_price || 0) !== Number(item.sold_price || 0)
        )
      })
      for (const item of updates) {
        await supabase.from('products').update({
          installment_paid: item.installment_paid,
          status: item.status,
          sold_price: item.sold_price,
          sold_date: item.status === 'Sold' ? item.sold_date : null,
          warranty_expiry: item.status === 'Sold' ? item.warranty_expiry : null,
        }).eq('id', item.id)
      }
      setBatchProducts(reconciledBatch)
      displayProduct = reconciledBatch.find(item => item.id === p.id) || p
    } else {
      setBatchProducts([])
      setBatchSalePaid(0)
    }
    if (p?.batch_id) {
      const { data: pb } = await supabase
        .from('products')
        .select('id,model,serial_number,category,status,base_cost,total_cost,batch_id')
        .eq('batch_id', p.batch_id)
        .neq('id', id)
      setPurchaseBatch(pb || [])
      const purchaseIds = [id, ...(pb || []).map(x => x.id)]
      const { data: purchaseTxs } = await supabase
        .from('transactions')
        .select('id,category,type,amount,payment_method,bank_amount,cash_amount,images,date,note,product_id')
        .eq('category', 'Buy Stock')
        .in('product_id', purchaseIds)
        .order('date')
      setPurchaseTxList(purchaseTxs || [])
    } else {
      setPurchaseBatch([])
      setPurchaseTxList((txs || []).filter(t => t.category === 'Buy Stock'))
    }
    setProduct(displayProduct)
    setEf({model:displayProduct.model, serial_number:displayProduct.serial_number, condition:displayProduct.condition,
           base_cost:displayProduct.base_cost, status:displayProduct.status, notes:displayProduct.notes||'',
           category:displayProduct.category||'กล้อง', created_at:toLocal(displayProduct.created_at),
           customer_note:displayProduct.customer_note||''})
    setEditNewFiles([]); setEditNewPreviews([]); setRemovedUrls([])
    setPurchasePayMode(false)
    setLoading(false)
  }
  useEffect(()=>{load()},[id])
  useEffect(() => {
    if (loading || !product) return
    const payAction = searchParams.get('pay')
    if (payAction === 'sale-installment') {
      setPayMode(true)
      setPayAmount('')
      setPayMethod2('โอน')
      setPayBankAmount('')
      setPayCashAmount('')
      setPayDate2('')
      setPayImgFiles([])
      setPayImgPrev([])
      setSearchParams({}, { replace: true })
    }
    if (payAction === 'purchase-installment') {
      setPurchasePayMode(true)
      setPurchasePayAmount('')
      setPurchasePayMethod('โอน')
      setPurchaseBankAmount('')
      setPurchaseCashAmount('')
      setPurchasePayDate('')
      setPurchaseImgFiles([])
      setPurchaseImgPrev([])
      setSearchParams({}, { replace: true })
    }
  }, [loading, product, searchParams, setSearchParams])

  // ─── save edit ─────────────────────────────────────────────
  const saveEdit = async () => {
    setSaving(true)
    try {
      const updateData = {
        model: ef.model, serial_number: ef.serial_number,
        condition: Number(ef.condition), base_cost: parseFloat(ef.base_cost),
        status: ef.status, notes: ef.notes, category: ef.category,
        customer_note: ef.customer_note?.trim() || null,
      }
      if (ef.created_at) updateData.created_at = new Date(ef.created_at).toISOString()
      const {error} = await supabase.from('products').update(updateData).eq('id',id)
      if (error) throw error
      toast.success('บันทึกแล้ว'); setEditing(false); load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── accessories ───────────────────────────────────────────
  const saveAcc = async () => {
    if (!accName||!accCost) return toast.error('กรุณากรอกชื่อและราคา')
    setSaving(true)
    try {
      const cost = parseFloat(accCost)

      // บันทึก accessory
      const {error} = await supabase.from('accessories').insert({ product_id:id, name:accName, cost })
      if (error) throw error

      // อัปเดต total_cost = base_cost + ทุก accessory (override trigger ที่อาจผิดพลาด)
      const newAccSum = accs.reduce((s,a) => s + Number(a.cost), 0) + cost
      await supabase.from('products').update({ total_cost: Number(product.base_cost) + newAccSum }).eq('id', id)

      // คำนวณยอดคงเหลือ + สร้าง transaction Expense / Add-on
      const { data: balAcc } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
      const bank_afterAcc = accPayMethod==='โอน' ? Math.max(0, Number(balAcc?.bank||0)-cost) : Number(balAcc?.bank||0)
      const cash_afterAcc = accPayMethod!=='โอน' ? Math.max(0, Number(balAcc?.cash||0)-cost) : Number(balAcc?.cash||0)

      const {data:newTx, error:txErr} = await supabase.from('transactions').insert({
        type: 'Expense', category: 'Add-on', amount: cost,
        product_id: id, payment_method: accPayMethod,
        date: accDate ? new Date(accDate).toISOString() : new Date().toISOString(),
        note: `Add-on: ${accName} — ${product.model} SN:${product.serial_number}`,
      }).select().single()
      if (txErr) throw txErr
      try { await supabase.from('transactions').update({ bank_after: bank_afterAcc, cash_after: cash_afterAcc }).eq('id', newTx.id) } catch(_) {}

      // upload รูปใบเสร็จ
      if (accImgFiles.length && newTx) {
        const urls = await uploadReceiptImages(supabase, newTx.id, accImgFiles)
        await supabase.from('transactions').update({ images: urls }).eq('id', newTx.id)
      }

      // อัปเดต balance
      await supabase.from('balances').update({ bank: bank_afterAcc, cash: cash_afterAcc, updated_at: new Date().toISOString() }).eq('id','main')

      toast.success(`เพิ่ม Add-on แล้ว — หัก ${accPayMethod} ฿${cost.toLocaleString('th-TH')}`)
      setAccName(''); setAccCost(''); setAccPayMethod('โอน')
      setAccImgFiles([]); setAccImgPrev([])
      setAccDate(''); setAddAcc(false); load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  const deleteAcc = async (acc) => {
    if (!confirm('ลบ "'+acc.name+'"?')) return
    const snap = accs
    setAccs(prev => prev.filter(a => a.id !== acc.id))
    scheduleDelete({
      label: acc.name,
      onUndo: () => setAccs(snap),
      onCommit: async () => {
        await supabase.from('accessories').delete().eq('id', acc.id)
        const remaining = snap.filter(a => a.id !== acc.id)
        const remainSum = remaining.reduce((s,a) => s + Number(a.cost), 0)
        await supabase.from('products').update({ total_cost: Number(product.base_cost) + remainSum }).eq('id', id)
        load()
      },
    })
  }

  // ─── receipt images per transaction ───────────────────────
  const deleteReceiptImg = async (txId, url) => {
    const path = url.split('/receipt-images/')[1]
    if (path) await supabase.storage.from('receipt-images').remove([decodeURIComponent(path)])
    const tx = txList.find(t => t.id === txId)
    const newImgs = (tx?.images||[]).filter(u => u !== url)
    await supabase.from('transactions').update({images: newImgs}).eq('id', txId)
    setTxList(prev => prev.map(t => t.id === txId ? {...t, images: newImgs} : t))
  }
  const addImgsToTx = async (txId, files) => {
    if (!files.length) return
    try {
      const urls = await uploadReceiptImages(supabase, txId, files)
      const tx = txList.find(t => t.id === txId)
      const newImgs = [...(tx?.images||[]), ...urls]
      await supabase.from('transactions').update({images: newImgs}).eq('id', txId)
      setTxList(prev => prev.map(t => t.id === txId ? {...t, images: newImgs} : t))
    } catch(e) { toast.error(e.message) }
  }

  const splitPayment = (method, total, bankValue, cashValue) => {
    const amount = Number(total || 0)
    if (method !== 'แบ่งจ่าย') {
      return {
        amount,
        bank: method === 'โอน' ? amount : 0,
        cash: method === 'เงินสด' ? amount : 0,
        bankField: null,
        cashField: null,
      }
    }
    const bank = Number(bankValue || 0)
    const cash = Number(cashValue || 0)
    return { amount: bank + cash, bank, cash, bankField: bank, cashField: cash }
  }

  const productPaymentMethod = (method, bankValue, cashValue) => (
    method === 'แบ่งจ่าย'
      ? (Number(bankValue || 0) >= Number(cashValue || 0) ? 'โอน' : 'เงินสด')
      : method
  )

  const validateSplitPayment = (method, pay, expected) => {
    if (method !== 'แบ่งจ่าย') return true
    if (pay.amount <= 0) {
      toast.error('กรุณาระบุยอดโอนหรือเงินสด')
      return false
    }
    if (pay.amount !== Number(expected || 0)) {
      toast.error(`ยอดแบ่งจ่ายต้องรวมเท่ากับ ฿${fmt(expected)}`)
      return false
    }
    return true
  }

  // ─── sell ──────────────────────────────────────────────────
  const sell = async () => {
    if (!soldPrice) return toast.error('กรุณาระบุราคาขาย')
    setSaving(true)
    try {
      const price  = parseFloat(soldPrice)
      const pay = splitPayment(payMethod, price, sellBankAmount, sellCashAmount)
      if (!validateSplitPayment(payMethod, pay, price)) return
      const soldAt = sellDate ? new Date(sellDate).toISOString() : new Date().toISOString()
      const warrantyExp = new Date(new Date(soldAt).getTime()+15*86400000).toISOString()

      // 1. อัปเดตสินค้า
      const {error} = await supabase.from('products').update({
        status:'Sold', sold_price:price, payment_method:productPaymentMethod(payMethod, sellBankAmount, sellCashAmount),
        sold_date:soldAt, warranty_expiry:warrantyExp,
        customer_note: customerNote.trim() || null,
      }).eq('id',id)
      if (error) throw error

      // 2. คำนวณยอดคงเหลือหลังรายการ + สร้าง transaction Income
      const {data:balSnap} = await supabase.from('balances').select('bank,cash').eq('id','main').single()
      const bank_after = Number(balSnap?.bank||0) + pay.bank
      const cash_after = Number(balSnap?.cash||0) + pay.cash

      const {data:newTx, error:txErr} = await supabase.from('transactions').insert({
        date: soldAt, type:'Income', category:'Sale', amount:price,
        product_id: id, payment_method: productPaymentMethod(payMethod, sellBankAmount, sellCashAmount),
        bank_amount: pay.bankField,
        cash_amount: pay.cashField,
        note: 'ขายสินค้า: '+product.model+' SN:'+product.serial_number,
      }).select().single()
      if (txErr) throw txErr
      try { await supabase.from('transactions').update({ bank_after, cash_after }).eq('id', newTx.id) } catch(_) {}

      // 3. upload รูปใบเสร็จ → receipt-images ตั้งชื่อตาม spec
      if (sellImgFiles.length && newTx) {
        const meta = {
          model:         product.model,
          serial_number: product.serial_number,
          created_at:    product.created_at,
          sold_date:     soldAt,
        }
        const imgUrls = await uploadReceiptImages(supabase, newTx.id, sellImgFiles, meta)
        await supabase.from('transactions').update({ images: imgUrls }).eq('id', newTx.id)
      }

      // 4. อัปเดต balance
      await supabase.from('balances').update({ bank: bank_after, cash: cash_after, updated_at: new Date().toISOString() }).eq('id','main')

      toast.success('ขายสำเร็จ! ช่องทาง: '+payMethod)
      setSellMode(false)
      setSellBankAmount(''); setSellCashAmount('')
      setSellImgFiles([]); setSellImgPrev([])
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── sell installment ──────────────────────────────────────
  const sellInstallment = async () => {
    const total = parseFloat(installTotal)
    const first = parseFloat(installFirst || 0)
    if (!installTotal || isNaN(total) || total <= 0) return toast.error('กรุณาระบุราคาตกลง')
    if (first > total) return toast.error('ยอดชำระงวดแรกเกินราคาตกลง')
    const pay = splitPayment(payMethod, first, sellBankAmount, sellCashAmount)
    if (first > 0 && !validateSplitPayment(payMethod, pay, first)) return
    setSaving(true)
    try {
      const soldAt = sellDate ? new Date(sellDate).toISOString() : new Date().toISOString()
      const isFullyPaid = first >= total

      const {error} = await supabase.from('products').update({
        status: isFullyPaid ? 'Sold' : 'Pending',
        sold_price: total,
        payment_method: productPaymentMethod(payMethod, sellBankAmount, sellCashAmount),
        sold_date: isFullyPaid ? soldAt : null,
        warranty_expiry: isFullyPaid ? new Date(new Date(soldAt).getTime()+15*86400000).toISOString() : null,
        installment_total: total,
        installment_paid: first,
        customer_note: customerNote.trim() || null,
      }).eq('id', id)
      if (error) throw error

      if (first > 0) {
        const {data:balSnap2} = await supabase.from('balances').select('bank,cash').eq('id','main').single()
        const bank_after2 = Number(balSnap2?.bank||0) + pay.bank
        const cash_after2 = Number(balSnap2?.cash||0) + pay.cash

        const {data:newTx, error:txErr} = await supabase.from('transactions').insert({
          date: soldAt, type:'Income', category:'Sale', amount: first,
          product_id: id, payment_method: productPaymentMethod(payMethod, sellBankAmount, sellCashAmount),
          bank_amount: pay.bankField,
          cash_amount: pay.cashField,
          note: isFullyPaid
            ? `${product.model} SN:${product.serial_number} | ราคา ฿${fmt(total)} | ชำระครบ`
            : `ผ่อนจ่าย | ${product.model} SN:${product.serial_number} | ราคาตกลง ฿${fmt(total)} | งวดแรก ฿${fmt(first)} | คงเหลือ ฿${fmt(total-first)}`,
        }).select().single()
        if (txErr) throw txErr
        try { await supabase.from('transactions').update({ bank_after: bank_after2, cash_after: cash_after2 }).eq('id', newTx.id) } catch(_) {}

        if (sellImgFiles.length && newTx) {
          const imgUrls = await uploadReceiptImages(supabase, newTx.id, sellImgFiles)
          await supabase.from('transactions').update({ images: imgUrls }).eq('id', newTx.id)
        }

        await supabase.from('balances').update({ bank: bank_after2, cash: cash_after2, updated_at: new Date().toISOString() }).eq('id','main')
      }

      toast.success(isFullyPaid ? 'ขายสำเร็จ!' : `บันทึกผ่อนจ่ายแล้ว — ชำระแรก ฿${fmt(first)}, คงเหลือ ฿${fmt(total-first)}`)
      setSellMode(false); setSellType('full')
      setInstallTotal(''); setInstallFirst(''); setSoldPrice('')
      setSellBankAmount(''); setSellCashAmount('')
      setSellImgFiles([]); setSellImgPrev([]); setSellDate(''); setCustomerNote('')
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── pay installment (Pending → record payment) ────────────
  const payInstallment = async () => {
    const amount = parseFloat(payAmount)
    if (!payAmount || isNaN(amount) || amount <= 0) return toast.error('กรุณาระบุจำนวนเงิน')
    const maxPay = product.sale_batch_id && batchProducts.length > 1
      ? batchTotalRemaining
      : Number(product.installment_total || 0) - Number(product.installment_paid || 0)
    if (amount > maxPay) return toast.error(`ยอดชำระเกินยอดคงเหลือ ฿${fmt(maxPay)}`)
    const pay = splitPayment(payMethod2, amount, payBankAmount, payCashAmount)
    if (!validateSplitPayment(payMethod2, pay, amount)) return
    setSaving(true)
    try {
      const soldAt  = payDate2 ? new Date(payDate2).toISOString() : new Date().toISOString()
      const warranty = new Date(new Date(soldAt).getTime()+15*86400000).toISOString()
      const isBatch = product.sale_batch_id && batchProducts.length > 1

      if (isBatch) {
        const totalRemaining = batchTotalRemaining
        const paidAfterBatch = batchTotalPaid + amount
        const isFullyPaidBatch = paidAfterBatch >= batchTotalInstallment

        const { data: balPayBatch } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
        let runBank = Number(balPayBatch?.bank || 0)
        let runCash = Number(balPayBatch?.cash || 0)
        let firstTxId = null
        for (let i = 0; i < batchProducts.length; i++) {
          const bp = batchProducts[i]
          const bpPayment = i === 0 ? amount : 0
          const bpBank = i === 0 ? pay.bank : 0
          const bpCash = i === 0 ? pay.cash : 0
          runBank += bpBank
          runCash += bpCash

          const bpTotal = Number(bp.installment_total||0)

          await supabase.from('products').update({
            installment_paid: isFullyPaidBatch ? bpTotal : 0,
            status:          isFullyPaidBatch ? 'Sold' : 'Pending',
            sold_price:      isFullyPaidBatch ? bpTotal : null,
            sold_date:       isFullyPaidBatch ? soldAt : null,
            warranty_expiry: isFullyPaidBatch ? warranty : null,
          }).eq('id', bp.id)

          const { data: newTx } = await supabase.from('transactions').insert({
            date: soldAt, type: 'Income', category: 'Sale', amount: bpPayment,
            product_id: bp.id, payment_method: productPaymentMethod(payMethod2, payBankAmount, payCashAmount),
            bank_amount: payMethod2 === 'แบ่งจ่าย' && bpBank > 0 ? bpBank : null,
            cash_amount: payMethod2 === 'แบ่งจ่าย' && bpCash > 0 ? bpCash : null,
            note: isFullyPaidBatch
              ? `ชำระครบขายรวม: ${bp.model} SN:${bp.serial_number} | ชำระงวดนี้ ฿${fmt(bpPayment)} | ยอดรวม ฿${fmt(batchTotalInstallment)}`
              : `ผ่อนจ่ายขายรวม: ${bp.model} SN:${bp.serial_number} | ชำระงวดนี้ ฿${fmt(bpPayment)} | คงเหลือรวม ฿${fmt(Math.max(0, batchTotalInstallment - paidAfterBatch))}`,
          }).select().single()
          if (newTx) { try { await supabase.from('transactions').update({ bank_after: runBank, cash_after: runCash }).eq('id', newTx.id) } catch(_) {} }

          if (i === 0 && newTx) firstTxId = newTx.id
        }

        if (payImgFiles.length && firstTxId) {
          const urls = await uploadReceiptImages(supabase, firstTxId, payImgFiles)
          await supabase.from('transactions').update({ images: urls }).eq('id', firstTxId)
        }

        await supabase.from('balances').update({ bank: runBank, cash: runCash, updated_at: soldAt }).eq('id','main')

        toast.success(amount >= totalRemaining
          ? `ชำระครบทั้งกลุ่ม! สินค้าทั้งหมดเปลี่ยนเป็น "ขายแล้ว"`
          : `รับชำระ ฿${fmt(amount)} — คงเหลือทั้งกลุ่ม ฿${fmt(Math.max(0, totalRemaining-amount))}`)

      } else {
        // ── Single product payment ──
        const newPaid = Number(product.installment_paid || 0) + amount
        const total   = Number(product.installment_total)
        const isFullyPaid = newPaid >= total

        const { data: balPay } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
        const bank_afterPay = Number(balPay?.bank||0) + pay.bank
        const cash_afterPay = Number(balPay?.cash||0) + pay.cash

        await supabase.from('products').update({
          installment_paid: newPaid,
          status:           isFullyPaid ? 'Sold' : 'Pending',
          sold_price:       isFullyPaid ? total : null,
          sold_date:        isFullyPaid ? soldAt : null,
          warranty_expiry:  isFullyPaid ? warranty : null,
        }).eq('id', id)

        const {data:newTx} = await supabase.from('transactions').insert({
          date: soldAt, type:'Income', category:'Sale', amount,
          product_id: id, payment_method: productPaymentMethod(payMethod2, payBankAmount, payCashAmount),
          bank_amount: pay.bankField,
          cash_amount: pay.cashField,
          note: isFullyPaid
            ? `ชำระครบแล้ว: ${product.model} SN:${product.serial_number}`
            : `ผ่อนจ่าย: ${product.model} SN:${product.serial_number} (${fmt(newPaid)}/${fmt(total)})`,
        }).select().single()
        if (newTx) { try { await supabase.from('transactions').update({ bank_after: bank_afterPay, cash_after: cash_afterPay }).eq('id', newTx.id) } catch(_) {} }

        if (payImgFiles.length && newTx) {
          const urls = await uploadReceiptImages(supabase, newTx.id, payImgFiles)
          await supabase.from('transactions').update({ images: urls }).eq('id', newTx.id)
        }

        await supabase.from('balances').update({ bank: bank_afterPay, cash: cash_afterPay, updated_at: soldAt }).eq('id','main')

        toast.success(isFullyPaid ? 'ชำระครบแล้ว! สินค้าเปลี่ยนเป็น "ขายแล้ว"' : `รับชำระ ฿${fmt(amount)} — คงเหลือ ฿${fmt(total-newPaid)}`)
      }

      setPayMode(false); setPayAmount(''); setPayMethod2('โอน'); setPayBankAmount(''); setPayCashAmount(''); setPayDate2('')
      setPayImgFiles([]); setPayImgPrev([])
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── pay purchase installment (stock buy payable) ──────────
  const payPurchaseInstallment = async () => {
    const amount = parseFloat(purchasePayAmount)
    if (!purchasePayAmount || isNaN(amount) || amount <= 0) return toast.error('กรุณาระบุจำนวนเงิน')
    if (amount > purchaseRemaining) return toast.error(`ยอดชำระเกินยอดค้างค่าซื้อ ฿${fmt(purchaseRemaining)}`)
    const pay = splitPayment(purchasePayMethod, amount, purchaseBankAmount, purchaseCashAmount)
    if (!validateSplitPayment(purchasePayMethod, pay, amount)) return

    setSaving(true)
    try {
      const paidAt = purchasePayDate ? new Date(purchasePayDate).toISOString() : new Date().toISOString()
      const { data: balPay } = await supabase.from('balances').select('bank,cash').eq('id','main').single()
      const bank_afterPay = Math.max(0, Number(balPay?.bank || 0) - pay.bank)
      const cash_afterPay = Math.max(0, Number(balPay?.cash || 0) - pay.cash)
      const remainingAfter = Math.max(0, purchaseRemaining - amount)
      const note = product.batch_id
        ? `ชำระค่าซื้อสินค้าในชุด ${purchaseGroupItems.length} รายการ | งวดนี้ ฿${fmt(amount)} | คงเหลือ ฿${fmt(remainingAfter)}`
        : `ชำระค่าซื้อ: ${product.model} SN:${product.serial_number} | งวดนี้ ฿${fmt(amount)} | คงเหลือ ฿${fmt(remainingAfter)}`

      const { data: newTx, error: txErr } = await supabase.from('transactions').insert({
        date: paidAt,
        type: 'Expense',
        category: 'Buy Stock',
        amount,
        product_id: id,
        payment_method: productPaymentMethod(purchasePayMethod, purchaseBankAmount, purchaseCashAmount),
        bank_amount: pay.bankField,
        cash_amount: pay.cashField,
        note,
      }).select().single()
      if (txErr) throw txErr
      if (newTx) {
        try { await supabase.from('transactions').update({ bank_after: bank_afterPay, cash_after: cash_afterPay }).eq('id', newTx.id) } catch(_) {}
      }

      if (purchaseImgFiles.length && newTx) {
        const urls = await uploadReceiptImages(supabase, newTx.id, purchaseImgFiles)
        await supabase.from('transactions').update({ images: urls }).eq('id', newTx.id)
      }

      await supabase.from('balances').update({ bank: bank_afterPay, cash: cash_afterPay, updated_at: paidAt }).eq('id','main')
      const targetIds = purchaseGroupItems.map(item => item.id)
      await supabase.from('products')
        .update({ status: remainingAfter <= 0 ? 'Available' : 'Pending' })
        .in('id', targetIds)

      toast.success(remainingAfter <= 0
        ? `จ่ายค่าซื้อครบแล้ว ฿${fmt(purchaseTotal)}`
        : `บันทึกจ่ายค่าซื้อ ฿${fmt(amount)} — คงเหลือ ฿${fmt(remainingAfter)}`)
      setPurchasePayMode(false)
      setPurchasePayAmount('')
      setPurchasePayMethod('โอน')
      setPurchaseBankAmount('')
      setPurchaseCashAmount('')
      setPurchasePayDate('')
      setPurchaseImgFiles([])
      setPurchaseImgPrev([])
      load()
    } catch(e) { toast.error(e.message) } finally { setSaving(false) }
  }

  // ─── cancel installment ────────────────────────────────────
  const cancelInstallment = async () => {
    const isBatchCancel = product.sale_batch_id && batchProducts.length > 1
    const confirmMsg = isBatchCancel
      ? `ยกเลิกผ่อนจ่ายทั้งกลุ่ม (${batchProducts.length} ชิ้น)?\nยอดเงินที่รับไปแล้วจะถูกหักคืนทั้งหมด และสินค้าทั้งหมดจะกลับมาเป็นพร้อมขาย`
      : 'ยกเลิกผ่อนจ่าย?\nยอดเงินที่รับไปแล้วจะถูกหักคืนทั้งหมด และสินค้าจะกลับมาเป็นพร้อมขาย'
    if (!confirm(confirmMsg)) return
    setSaving(true)
    try {
      const targetIds = isBatchCancel ? batchProducts.map(bp => bp.id) : [id]

      for (const pid of targetIds) {
        const {data: saleTxs} = await supabase.from('transactions')
          .select('*').eq('product_id', pid).eq('category', 'Sale')

        for (const tx of saleTxs || []) {
          const {data:bal} = await supabase.from('balances').select('*').eq('id','main').single()
          if (bal) {
            if (hasSplitAmounts(tx)) await supabase.from('balances').update({
              bank: Math.max(0, Number(bal.bank) - Number(tx.bank_amount || 0)),
              cash: Math.max(0, Number(bal.cash) - Number(tx.cash_amount || 0)),
              updated_at:new Date().toISOString()
            }).eq('id','main')
            else if (tx.payment_method==='โอน') await supabase.from('balances').update({bank:Math.max(0,Number(bal.bank)-Number(tx.amount)),updated_at:new Date().toISOString()}).eq('id','main')
            else                                await supabase.from('balances').update({cash:Math.max(0,Number(bal.cash)-Number(tx.amount)),updated_at:new Date().toISOString()}).eq('id','main')
          }
        }

        await supabase.from('transactions').delete().eq('product_id', pid).eq('category', 'Sale')
        await supabase.from('products').update({
          status:'Available', sold_price:null, payment_method:null,
          sold_date:null, warranty_expiry:null,
          installment_total:null, installment_paid:null, sale_batch_id:null,
        }).eq('id', pid)
      }

      toast.success(isBatchCancel ? `ยกเลิกผ่อนจ่ายทั้งกลุ่มแล้ว (${targetIds.length} ชิ้น)` : 'ยกเลิกผ่อนจ่ายแล้ว')
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── cancel sale ───────────────────────────────────────────
  const cancelSale = async () => {
    if (!confirm('ยกเลิกการขายสินค้านี้?\nยอดเงินและรายการบัญชีจะถูกลบคืนอัตโนมัติ')) return
    setSaving(true)
    try {
      // 1. คืนสถานะสินค้า
      await supabase.from('products').update({
        status:'Available', sold_price:null,
        payment_method:null, sold_date:null, warranty_expiry:null,
      }).eq('id',id)

      // 2. หักยอด balance คืนตาม transaction จริง เพื่อรองรับแบ่งจ่าย
      const {data: saleTxs} = await supabase.from('transactions')
        .select('*')
        .eq('product_id', id)
        .eq('category', 'Sale')
      for (const tx of saleTxs || []) {
        const {data:bal} = await supabase.from('balances').select('*').eq('id','main').single()
        if (!bal) continue
        if (hasSplitAmounts(tx)) {
          await supabase.from('balances').update({
            bank: Math.max(0, Number(bal.bank)-Number(tx.bank_amount || 0)),
            cash: Math.max(0, Number(bal.cash)-Number(tx.cash_amount || 0)),
            updated_at: new Date().toISOString()
          }).eq('id','main')
        } else if (tx.payment_method === 'โอน') {
          await supabase.from('balances').update({
            bank: Math.max(0, Number(bal.bank)-Number(tx.amount)),
            updated_at: new Date().toISOString()
          }).eq('id','main')
        } else {
          await supabase.from('balances').update({
            cash: Math.max(0, Number(bal.cash)-Number(tx.amount)),
            updated_at: new Date().toISOString()
          }).eq('id','main')
        }
      }

      // 3. ลบ transaction Sale ทั้งหมดของสินค้านี้
      await supabase.from('transactions')
        .delete()
        .eq('product_id', id)
        .eq('category', 'Sale')

      toast.success('ยกเลิกการขายแล้ว ยอดเงินและรายการบัญชีถูกลบแล้ว')
      load()
    } catch(e){toast.error(e.message)} finally{setSaving(false)}
  }

  // ─── cancel trade ──────────────────────────────────────────
  const cancelTrade = async () => {
    if (!confirm('ยกเลิกการแลกเปลี่ยนนี้?\n• สินค้า A จะกลับมาเป็นพร้อมขาย\n• สินค้า B จะถูกลบออกจากสต็อก')) return
    setSaving(true)
    try {
      const productAId = product.is_trade_in ? product.trade_ref_id : id
      const productBId = product.is_trade_in ? id : product.trade_ref_id

      const { data: tradeTx } = await supabase
        .from('transactions').select('*')
        .eq('product_id', productAId).eq('category', 'Trade').single()

      await supabase.from('products').update({
        status: 'Available', sold_price: null, sold_date: null,
        warranty_expiry: null, payment_method: null, trade_ref_id: null,
      }).eq('id', productAId)

      if (productBId) {
        await supabase.from('transactions').delete().eq('product_id', productBId)
        await supabase.from('products').delete().eq('id', productBId)
      }

      if (tradeTx) {
        await supabase.from('transactions').delete().eq('id', tradeTx.id)
        const { data: bal } = await supabase.from('balances').select('*').eq('id', 'main').single()
        if (bal) {
          let bank = Number(bal.bank), cash = Number(bal.cash)
          if (tradeTx.type === 'Income') {
            if (hasSplitAmounts(tradeTx)) {
              bank -= Number(tradeTx.bank_amount || 0)
              cash -= Number(tradeTx.cash_amount || 0)
            } else if (tradeTx.payment_method === 'โอน') bank -= Number(tradeTx.amount)
            else cash -= Number(tradeTx.amount)
          } else {
            if (hasSplitAmounts(tradeTx)) {
              bank += Number(tradeTx.bank_amount || 0)
              cash += Number(tradeTx.cash_amount || 0)
            } else if (tradeTx.payment_method === 'โอน') bank += Number(tradeTx.amount)
            else cash += Number(tradeTx.amount)
          }
          await supabase.from('balances').update({
            bank: Math.max(0, bank), cash: Math.max(0, cash),
            updated_at: new Date().toISOString()
          }).eq('id', 'main')
        }
      }

      toast.success('ยกเลิกการแลกเปลี่ยนแล้ว')
      if (product.is_trade_in) navigate('/inventory')
      else load()
    } catch(e) { toast.error(e.message) } finally { setSaving(false) }
  }

  // ─── delete product ────────────────────────────────────────
  const deleteProduct = async () => {
    if (!confirm('ลบสินค้านี้?\nรายการบัญชีทั้งหมดจะถูกลบด้วย')) return
    navigate('/inventory')
    scheduleDelete({
      label: product.model,
      onUndo: () => navigate(`/inventory/${id}`),
      onCommit: async () => {
        await supabase.from('accessories').delete().eq('product_id', id)
        await supabase.from('transactions').delete().eq('product_id', id)
        await supabase.from('products').delete().eq('id', id)
      },
    })
  }

  if (loading) return <div className="flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-brand-yellow border-t-transparent rounded-full animate-spin"/></div>
  if (!product) return <div className="p-8 text-center text-gray-400">ไม่พบสินค้า</div>
  const profit = product.sold_price ? Number(product.sold_price)-Number(product.total_cost) : null
  const isBatch = product.sale_batch_id && batchProducts.length > 1
  const batchTotalInstallment = isBatch ? batchProducts.reduce((a,bp) => a + Number(bp.installment_total||0), 0) : 0
  const batchTotalPaid        = isBatch ? batchSalePaid : 0
  const batchTotalRemaining   = Math.max(0, batchTotalInstallment - batchTotalPaid)
  const purchaseGroupItems = product.batch_id ? [product, ...purchaseBatch] : [product]
  const hasPurchaseInstallment = purchaseTxList.some(isPurchaseInstallmentTx)
  const purchaseTotal = purchaseGroupItems.reduce((sum, item) => sum + Number(item.base_cost || item.total_cost || 0), 0)
  const purchasePaid = purchaseTxList.filter(isPurchaseInstallmentPaymentTx).reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  const purchaseRemaining = hasPurchaseInstallment ? Math.max(0, purchaseTotal - purchasePaid) : 0
  const hasPurchasePayable = hasPurchaseInstallment && purchaseTotal > 0 && purchaseRemaining > 0
  return (
    <div>
      {/* Header */}
      <div className="liquid-sub-header flex items-center justify-between px-4 py-3">
        <button onClick={()=>navigate(-1)}><ChevronLeft size={24}/></button>
        <span className="font-bold truncate max-w-xs">{product.model}</span>
        <button onClick={()=>setEditing(!editing)} className="p-1.5 text-gray-400">
          {editing ? <X size={18}/> : <Edit2 size={18}/>}
        </button>
      </div>

      <div className="px-4 py-4 space-y-3">

        {/* Info / Edit form */}
        <div className="card space-y-3">
          {editing ? (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ประเภทสินค้า</label>
                <select className="input" value={ef.category} onChange={e=>setEf({...ef,category:e.target.value})}>
                  {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ชื่อรุ่น</label>
                <input autoComplete="off" className="input" value={ef.model} onChange={e=>setEf({...ef,model:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Serial Number</label>
                <input autoComplete="off" className="input" value={ef.serial_number} onChange={e=>setEf({...ef,serial_number:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ราคาซื้อ (บาท)</label>
                <input autoComplete="off" className="input" type="number" value={ef.base_cost} onChange={e=>setEf({...ef,base_cost:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-2 block">เกรดสภาพ</label>
                <div className="flex gap-2">
                  {[5,4,3,2,1].map(c=>(
                    <button key={c} onClick={()=>setEf({...ef,condition:c})}
                      className={"flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all "+(ef.condition===c?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200')}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">สถานะ</label>
                <select className="input" value={ef.status} onChange={e=>setEf({...ef,status:e.target.value})}>
                  <option value="Available">พร้อมขาย</option>
                  <option value="Reserved">จอง</option>
                  <option value="Sold">ขายแล้ว</option>
                  <option value="Pending">รอชำระ</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
                <textarea className="input resize-none" rows={2} value={ef.notes} onChange={e=>setEf({...ef,notes:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">รายละเอียดลูกค้า</label>
                <textarea className="input resize-none" rows={2} placeholder="ชื่อ / เบอร์โทร / หมายเหตุลูกค้า..." value={ef.customer_note||''} onChange={e=>setEf({...ef,customer_note:e.target.value})}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลารับเข้า</label>
                <ThaiDatePicker value={ef.created_at} onChange={v=>setEf({...ef,created_at:v})} showTime className="input w-full"/>
              </div>
              <button onClick={saveEdit} disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
                <Check size={16}/>{saving?'กำลังบันทึก...':'บันทึก'}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-xl">{product.model}</h2>
                  <p className="text-sm text-gray-400">SN: {product.serial_number}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={STATUS_CLASS[product.status]+' text-xs font-semibold px-2.5 py-0.5 rounded-full'}>{STATUS_LABEL[product.status]}</span>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-medium">{product.category||'กล้อง'}</span>
                  <span className="text-xs text-gray-400">เกรด {product.condition}</span>
                </div>
              </div>
              <WarrantyBadge expiry={product.warranty_expiry}/>
              {product.payment_method && (
                <span className={"inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full "+(product.payment_method==='โอน'?'bg-blue-100 text-blue-700':product.payment_method==='เงินสด'?'bg-green-100 text-green-700':'bg-red-100 text-red-700')}>
                  ชำระ: {product.payment_method}
                </span>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-xs text-gray-400">ต้นทุนเริ่มต้น</p><p className="font-semibold">฿{fmt(product.base_cost)}</p></div>
                <div><p className="text-xs text-gray-400">ต้นทุนรวม</p><p className="font-semibold text-amber-600">฿{fmt(product.total_cost)}</p></div>
                {product.sold_price && (
                  <>
                    <div><p className="text-xs text-gray-400">ราคาขาย</p><p className="font-semibold text-green-600">฿{fmt(product.sold_price)}</p></div>
                    <div><p className="text-xs text-gray-400">กำไร</p><p className={"font-semibold "+(profit>=0?'text-green-600':'text-red-500')}>{profit>=0?'+':''}฿{fmt(profit)}</p></div>
                  </>
                )}
              </div>
              {product.notes && <p className="text-sm text-gray-500 italic">{product.notes}</p>}
              {purchaseBatch.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <p className="text-xs text-amber-500 font-medium mb-1">ซื้อมาพร้อมกับ</p>
                  <div className="space-y-0.5">
                    {purchaseBatch.map(pb => (
                      <button key={pb.id} onClick={()=>navigate(`/inventory/${pb.id}`)}
                        className="flex items-center justify-between w-full text-left hover:opacity-70 transition-opacity">
                        <span className="text-sm text-amber-800 font-medium">{pb.model}</span>
                        <span className="text-xs text-amber-500">SN: {pb.serial_number}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {product.customer_note && (
                <div className="bg-blue-50 rounded-xl px-3 py-2">
                  <p className="text-xs text-blue-400 mb-0.5">👤 รายละเอียดลูกค้า</p>
                  <p className="text-sm text-blue-700 whitespace-pre-wrap">{product.customer_note}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Images — per transaction */}
        {txList.length > 0 && (
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm">รูปใบเสร็จ</h3>
            {txList.map(t => (
              <div key={t.id}>
                <p className="text-xs text-gray-400 font-medium mb-1.5">{t.category} — {thDateShort(t.date)}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(t.images||[]).map((url, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <DeferredImageButton
                        imageUrl={url}
                        className="w-20 h-20 active:scale-95 transition-transform"
                        onClick={(e,src)=>setLightboxImg(src || url)}
                      />
                      <button onClick={()=>deleteReceiptImg(t.id, url)}
                        className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                        <X size={10} className="text-white"/>
                      </button>
                    </div>
                  ))}
                  <label className="w-20 h-20 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
                    <ImagePlus size={14} className="text-amber-400"/>
                    <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
                    <input type="file" multiple accept="image/*" className="hidden" onChange={e=>addImgsToTx(t.id, Array.from(e.target.files))}/>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Accessories */}
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">อุปกรณ์เสริม</h3>
            {product.status!=='Sold' && (
              <button onClick={()=>setAddAcc(!addAcc)} className="text-brand-yellow text-sm font-medium flex items-center gap-1">
                <Plus size={15}/>เพิ่ม
              </button>
            )}
          </div>
          {addAcc && (
            <div className="bg-amber-50 rounded-xl p-3 mb-3 space-y-2">
              <input autoComplete="off" className="input text-sm" placeholder="ชื่ออุปกรณ์..." value={accName} onChange={e=>setAccName(e.target.value)}/>
              <input autoComplete="off" className="input text-sm" type="number" placeholder="ราคา (บาท)" value={accCost} onChange={e=>setAccCost(e.target.value)}/>
              <div>
                <p className="text-xs text-gray-500 mb-1">ช่องทางการชำระ</p>
                <div className="flex gap-2">
                  {['โอน','เงินสด'].map(m=>(
                    <button key={m} onClick={()=>setAccPayMethod(m)}
                      className={`flex-1 py-1.5 rounded-xl text-sm font-semibold border transition-all
                        ${accPayMethod===m?(m==='โอน'?'bg-blue-500 text-white border-blue-500':'bg-green-600 text-white border-green-600'):'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':'💵 เงินสด'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">วันที่และเวลา (ไม่บังคับ)</p>
                <ThaiDatePicker value={accDate} onChange={setAccDate} showTime className="input text-sm w-full"/>
                {!accDate && <p className="text-xs text-gray-400 mt-0.5">หากไม่ระบุจะใช้เวลาปัจจุบัน</p>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">รูปใบเสร็จ (ไม่บังคับ)</p>
                <div className="flex gap-2 flex-wrap">
                  {accImgPrev.map((src,i)=>(
                    <div key={i} className="relative w-14 h-14 rounded-xl overflow-hidden border border-amber-200 flex-shrink-0">
                      <img src={src} className="w-full h-full object-cover"/>
                      <button onClick={()=>{
                        URL.revokeObjectURL(accImgPrev[i])
                        setAccImgFiles(f=>f.filter((_,j)=>j!==i))
                        setAccImgPrev(p=>p.filter((_,j)=>j!==i))
                      }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                        <X size={9} className="text-white"/>
                      </button>
                    </div>
                  ))}
                  <label className="w-14 h-14 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
                    <ImagePlus size={14} className="text-amber-400"/>
                    <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
                    <input type="file" multiple accept="image/*" className="hidden" onChange={e=>{
                      const files = Array.from(e.target.files)
                      setAccImgFiles(p=>[...p,...files])
                      setAccImgPrev(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
                    }}/>
                  </label>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={saveAcc} disabled={saving} className="btn-primary flex-1 py-2 text-sm">
                  {saving?'...':'บันทึก'}
                </button>
                <button onClick={()=>{setAddAcc(false);setAccPayMethod('โอน');setAccDate('');setAccImgFiles([]);setAccImgPrev([])}} className="btn-ghost flex-1 py-2 text-sm">ยกเลิก</button>
              </div>
            </div>
          )}
          {accs.length===0
            ? <p className="text-xs text-gray-400 text-center py-2">ยังไม่มีอุปกรณ์เสริม</p>
            : accs.map(a=>(
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-amber-50 last:border-0">
                  <div><p className="text-sm">{a.name}</p><p className="text-xs text-gray-400">฿{fmt(a.cost)}</p></div>
                  {product.status!=='Sold' && (
                    <button onClick={()=>deleteAcc(a)} className="p-2 text-gray-300 hover:text-brand-red"><Trash2 size={15}/></button>
                  )}
                </div>
              ))
          }
        </div>

        {/* Purchase payable */}
        {hasPurchasePayable && (
          <div className="card space-y-3 border-red-200 bg-red-50/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-red-700">ค้างจ่ายค่าซื้อ</h3>
                {product.batch_id && (
                  <span className="text-xs text-red-500 font-medium">ซื้อรวม {purchaseGroupItems.length} รายการ</span>
                )}
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">ซื้อผ่อน</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ราคาซื้อรวม</span>
                <span className="font-semibold">฿{fmt(purchaseTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">จ่ายแล้ว</span>
                <span className="font-semibold text-green-600">฿{fmt(purchasePaid)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">คงเหลือค่าซื้อ</span>
                <span className="font-bold text-red-600">฿{fmt(purchaseRemaining)}</span>
              </div>
              <div className="w-full bg-red-100 rounded-full h-2.5 mt-1">
                <div className="bg-red-500 h-2.5 rounded-full transition-all"
                  style={{width:`${Math.min(100,(purchasePaid/Math.max(1,purchaseTotal))*100)}%`}}/>
              </div>
              <p className="text-xs text-gray-500 text-right">
                {Math.round((purchasePaid/Math.max(1,purchaseTotal))*100)}% จ่ายค่าซื้อแล้ว
              </p>
            </div>

            {!purchasePayMode ? (
              <button onClick={()=>{
                setPurchasePayMode(true)
                setPurchasePayAmount('')
                setPurchasePayMethod('โอน')
                setPurchaseBankAmount('')
                setPurchaseCashAmount('')
                setPurchasePayDate('')
                setPurchaseImgFiles([])
                setPurchaseImgPrev([])
              }} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
                💰 จ่ายงวดค่าซื้อ
              </button>
            ) : (
              <div className="bg-white/70 rounded-xl p-3 space-y-2 border border-red-100">
                <h4 className="text-sm font-semibold text-red-700">บันทึกจ่ายค่าซื้อ</h4>
                <input autoComplete="off" className="input text-sm" type="number" placeholder="จำนวนเงิน (บาท)"
                  value={purchasePayAmount} onChange={e=>setPurchasePayAmount(e.target.value)} autoFocus/>
                <div className="flex gap-2">
                  {['โอน','เงินสด','แบ่งจ่าย'].map(m=>(
                    <button key={m} onClick={()=>{setPurchasePayMethod(m);setPurchaseBankAmount('');setPurchaseCashAmount('')}}
                      className={`flex-1 py-1.5 rounded-xl text-sm font-semibold border transition-all ${purchasePayMethod===m?(m==='โอน'?'bg-blue-500 text-white border-blue-500':m==='เงินสด'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red'):'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':m==='เงินสด'?'💵 เงินสด':'แบ่ง'}
                    </button>
                  ))}
                </div>
                {purchasePayMethod === 'แบ่งจ่าย' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="ยอดโอน"
                      value={purchaseBankAmount} onChange={e=>setPurchaseBankAmount(e.target.value)}/>
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="เงินสด"
                      value={purchaseCashAmount} onChange={e=>setPurchaseCashAmount(e.target.value)}/>
                    <p className={`col-span-2 text-xs font-medium ${(Number(purchaseBankAmount||0)+Number(purchaseCashAmount||0)) === Number(purchasePayAmount || 0) ? 'text-green-600' : 'text-orange-600'}`}>
                      รวมแบ่งจ่าย ฿{fmt(Number(purchaseBankAmount||0)+Number(purchaseCashAmount||0))} / ต้องเท่ากับ ฿{fmt(purchasePayAmount)}
                    </p>
                  </div>
                )}
                <ThaiDatePicker value={purchasePayDate} onChange={setPurchasePayDate} showTime className="input text-sm w-full"/>
                <div>
                  <p className="text-xs text-gray-500 mb-1">รูปใบเสร็จ / หลักฐาน (ไม่บังคับ)</p>
                  <div className="flex gap-2 flex-wrap">
                    {purchaseImgPrev.map((src,i)=>(
                      <div key={i} className="relative w-14 h-14 rounded-xl overflow-hidden border flex-shrink-0">
                        <img src={src} className="w-full h-full object-cover"/>
                        <button onClick={()=>{
                          URL.revokeObjectURL(purchaseImgPrev[i])
                          setPurchaseImgFiles(f=>f.filter((_,j)=>j!==i))
                          setPurchaseImgPrev(p=>p.filter((_,j)=>j!==i))
                        }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                          <X size={9} className="text-white"/>
                        </button>
                      </div>
                    ))}
                    <label className="w-14 h-14 rounded-xl border-2 border-dashed border-red-300 flex flex-col items-center justify-center cursor-pointer flex-shrink-0">
                      <ImagePlus size={14} className="text-red-400"/>
                      <span className="text-xs text-red-400 mt-0.5">เพิ่ม</span>
                      <input type="file" multiple accept="image/*" className="hidden" onChange={e=>{
                        const files = Array.from(e.target.files)
                        setPurchaseImgFiles(p=>[...p,...files])
                        setPurchaseImgPrev(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
                      }}/>
                    </label>
                  </div>
                </div>
                {purchasePayAmount && (
                  <p className={`text-xs font-medium ${Number(purchasePayAmount)>=purchaseRemaining?'text-green-600':'text-red-600'}`}>
                    {Number(purchasePayAmount)>=purchaseRemaining
                      ? `จ่ายครบแล้ว (ยอดรวมทั้งหมด ฿${fmt(purchaseTotal)})`
                      : `คงเหลือหลังจ่ายงวดนี้ ฿${fmt(purchaseRemaining-Number(purchasePayAmount))}`}
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={payPurchaseInstallment} disabled={saving} className="btn-primary flex-1 py-2 text-sm">
                    {saving?'...':'บันทึก'}
                  </button>
                  <button onClick={()=>{
                    setPurchasePayMode(false)
                    setPurchasePayAmount('')
                    setPurchaseBankAmount('')
                    setPurchaseCashAmount('')
                    setPurchaseImgFiles([])
                    setPurchaseImgPrev([])
                  }} className="btn-ghost flex-1 py-2 text-sm">ยกเลิก</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sell */}
        {product.status==='Available' && (
          sellMode ? (
            <div className="card space-y-3">
              <h3 className="font-semibold text-sm">ยืนยันการขาย</h3>

              {/* ── รูปแบบการชำระ ── */}
              <div className="flex gap-2">
                <button onClick={()=>setSellType('full')}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${sellType==='full'?'bg-brand-dark text-brand-yellow border-brand-dark':'bg-white text-gray-400 border-gray-200'}`}>
                  ชำระเต็มจำนวน
                </button>
                <button onClick={()=>setSellType('installment')}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${sellType==='installment'?'bg-orange-500 text-white border-orange-500':'bg-white text-gray-400 border-gray-200'}`}>
                  💳 ผ่อนจ่าย
                </button>
              </div>

              {/* ── ราคา ── */}
              {sellType==='full' ? (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">ราคาขายจริง (บาท)</label>
                  <input autoComplete="off" className="input" type="number" placeholder="0" value={soldPrice} onChange={e=>setSoldPrice(e.target.value)}/>
                  {soldPrice && (
                    <p className={"text-xs mt-1 font-medium "+(Number(soldPrice)-Number(product.total_cost)>=0?'text-green-600':'text-red-500')}>
                      กำไร: ฿{fmt(Number(soldPrice)-Number(product.total_cost))}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">ราคาตกลง (บาท)</label>
                    <input autoComplete="off" className="input" type="number" placeholder="0"
                      value={installTotal} onChange={e=>setInstallTotal(e.target.value)}/>
                    {installTotal && (
                      <p className={"text-xs mt-1 font-medium "+(Number(installTotal)-Number(product.total_cost)>=0?'text-green-600':'text-red-500')}>
                        กำไรประมาณ: ฿{fmt(Number(installTotal)-Number(product.total_cost))}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">ชำระงวดแรก (บาท)</label>
                    <input autoComplete="off" className="input" type="number" placeholder="0 = ยังไม่รับเงิน"
                      value={installFirst} onChange={e=>setInstallFirst(e.target.value)}/>
                    {installTotal && installFirst !== '' && (
                      <p className={`text-xs mt-1 font-medium ${Number(installFirst)>Number(installTotal)?'text-red-500':Number(installFirst)>=Number(installTotal)?'text-green-600':'text-orange-500'}`}>
                        {Number(installFirst)>Number(installTotal)
                          ? '⚠️ เกินราคาตกลง'
                          : Number(installFirst)>=Number(installTotal)
                            ? '✅ ชำระเต็มจำนวน → สินค้าจะเปลี่ยนเป็น "ขายแล้ว"'
                            : `คงเหลือ: ฿${fmt(Number(installTotal)-Number(installFirst))} → สินค้าจะเปลี่ยนเป็น "รอชำระ"`}
                      </p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="text-xs text-gray-500 mb-1 block">วันที่และเวลาที่ขาย</label>
                <ThaiDatePicker value={sellDate} onChange={setSellDate} showTime className="input w-full"/>
                <p className="text-xs text-gray-400 mt-1">หากไม่ระบุจะใช้เวลาปัจจุบัน</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">รูปใบเสร็จ / หลักฐาน (ไปแสดงในหน้าบัญชี)</label>
                <div className="flex gap-2 flex-wrap">
                  {sellImgPrev.map((src,i)=>(
                    <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-green-300 flex-shrink-0">
                      <img src={src} className="w-full h-full object-cover"/>
                      <button onClick={()=>{
                        URL.revokeObjectURL(sellImgPrev[i])
                        setSellImgFiles(f=>f.filter((_,j)=>j!==i))
                        setSellImgPrev(p=>p.filter((_,j)=>j!==i))
                      }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                        <X size={10} className="text-white"/>
                      </button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-xl border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-brand-yellow flex-shrink-0">
                    <ImagePlus size={16} className="text-amber-400"/>
                    <span className="text-xs text-amber-400 mt-0.5">เพิ่ม</span>
                    <input autoComplete="off" type="file" multiple accept="image/*" className="hidden" onChange={e=>{
                      const files = Array.from(e.target.files)
                      setSellImgFiles(p=>[...p,...files])
                      setSellImgPrev(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
                    }}/>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-2 block">ช่องทางการชำระเงิน</label>
                <div className="flex gap-2">
                  {['โอน','เงินสด','แบ่งจ่าย'].map(m=>(
                    <button key={m} onClick={()=>{setPayMethod(m);setSellBankAmount('');setSellCashAmount('')}}
                      className={"flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all "+(payMethod===m?(m==='โอน'?'bg-blue-600 text-white border-blue-600':m==='เงินสด'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red'):'bg-white text-gray-400 border-gray-200')}>
                      {m==='โอน'?'💳 โอน':m==='เงินสด'?'💵 เงินสด':'แบ่ง'}
                    </button>
                  ))}
                </div>
                {payMethod === 'แบ่งจ่าย' ? (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="ยอดโอน"
                      value={sellBankAmount} onChange={e=>setSellBankAmount(e.target.value)}/>
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="เงินสด"
                      value={sellCashAmount} onChange={e=>setSellCashAmount(e.target.value)}/>
                    <p className={`col-span-2 text-xs font-medium ${(Number(sellBankAmount||0)+Number(sellCashAmount||0)) === Number(sellType==='full' ? soldPrice || 0 : installFirst || 0) ? 'text-green-600' : 'text-orange-600'}`}>
                      รวมแบ่งจ่าย ฿{fmt(Number(sellBankAmount||0)+Number(sellCashAmount||0))} / ต้องเท่ากับ ฿{fmt(sellType==='full' ? soldPrice : installFirst)}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1.5">
                    {payMethod==='โอน'?'ยอดจะบวกเพิ่มใน "ยอดโอน" อัตโนมัติ':'ยอดจะบวกเพิ่มใน "เงินสด" อัตโนมัติ'}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">รายละเอียดลูกค้า (ไม่บังคับ)</label>
                <textarea className="input resize-none text-sm" rows={2}
                  placeholder="ชื่อ / เบอร์โทร / หมายเหตุลูกค้า..."
                  value={customerNote} onChange={e=>setCustomerNote(e.target.value)}/>
              </div>
              <div className="flex gap-2">
                <button onClick={sellType==='full'?sell:sellInstallment} disabled={saving}
                  className="btn-primary flex-1 py-3 flex items-center justify-center gap-2">
                  <ShoppingBag size={16}/>{saving?'...':(sellType==='full'?'ยืนยันขาย':'บันทึกผ่อนจ่าย')}
                </button>
                <button onClick={()=>{setSellMode(false);setSellType('full');setInstallTotal('');setInstallFirst('');setSellBankAmount('');setSellCashAmount('')}} className="btn-ghost px-4">ยกเลิก</button>
              </div>
            </div>
          ) : (
            <button onClick={()=>{setSellMode(true);setSellDate('');setCustomerNote('');setSellImgFiles([]);setSellImgPrev([]);setSellType('full');setInstallTotal('');setInstallFirst('');setSellBankAmount('');setSellCashAmount('')}} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
              <ShoppingBag size={18}/>ขายสินค้า
            </button>
          )
        )}

        {/* Pending — ผ่อนจ่าย */}
        {product.status==='Pending' && product.installment_total && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">ผ่อนจ่าย</h3>
                {isBatch && <span className="text-xs text-blue-600 font-medium">📦 ขายรวม {batchProducts.length} ชิ้น</span>}
              </div>
              <span className="badge-pending">รอชำระ</span>
            </div>
            <div className="space-y-1.5">
              {isBatch ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">ราคาตกลง (รวมทั้งกลุ่ม)</span>
                    <span className="font-semibold">฿{fmt(batchTotalInstallment)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">ชำระแล้ว (รวมทั้งกลุ่ม)</span>
                    <span className="font-semibold text-green-600">฿{fmt(batchTotalPaid)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">คงเหลือ (รวมทั้งกลุ่ม)</span>
                    <span className="font-bold text-orange-500">฿{fmt(batchTotalRemaining)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5 mt-1">
                    <div className="bg-orange-400 h-2.5 rounded-full transition-all"
                      style={{width:`${Math.min(100,(batchTotalPaid/Math.max(1,batchTotalInstallment))*100)}%`}}/>
                  </div>
                  <p className="text-xs text-gray-400 text-right">
                    {Math.round((batchTotalPaid/Math.max(1,batchTotalInstallment))*100)}% ชำระแล้ว
                  </p>
                  <div className="mt-1 space-y-1 border-t border-amber-100 pt-2">
                    {batchProducts.map(bp => (
                      <div key={bp.id} className="flex items-center justify-between text-xs py-0.5">
                        <span className="text-gray-600 truncate flex-1 mr-2">{bp.model}</span>
                        {bp.status==='Sold'
                          ? <span className="text-green-500 font-medium">✅ ครบ</span>
                          : <span className="text-orange-500 font-medium">รอปิดยอด</span>}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">ราคาตกลง</span>
                    <span className="font-semibold">฿{fmt(product.installment_total)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">ชำระแล้ว</span>
                    <span className="font-semibold text-green-600">฿{fmt(product.installment_paid)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">คงเหลือ</span>
                    <span className="font-bold text-orange-500">฿{fmt(Number(product.installment_total||0)-Number(product.installment_paid||0))}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5 mt-1">
                    <div className="bg-orange-400 h-2.5 rounded-full transition-all"
                      style={{width:`${Math.min(100,(Number(product.installment_paid||0)/Number(product.installment_total||1))*100)}%`}}/>
                  </div>
                  <p className="text-xs text-gray-400 text-right">
                    {Math.round((Number(product.installment_paid||0)/Number(product.installment_total||1))*100)}% ชำระแล้ว
                  </p>
                </>
              )}
            </div>
            {!payMode ? (
              <button onClick={()=>{setPayMode(true);setPayAmount('');setPayMethod2('โอน');setPayBankAmount('');setPayCashAmount('');setPayDate2('');setPayImgFiles([]);setPayImgPrev([])}}
                className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
                💰 รับชำระงวด
              </button>
            ) : (
              <div className="bg-orange-50 rounded-xl p-3 space-y-2">
                <h4 className="text-sm font-semibold">บันทึกการรับชำระ</h4>
                <input autoComplete="off" className="input text-sm" type="number" placeholder="จำนวนเงิน (บาท)"
                  value={payAmount} onChange={e=>setPayAmount(e.target.value)} autoFocus/>
                <div className="flex gap-2">
                  {['โอน','เงินสด','แบ่งจ่าย'].map(m=>(
                    <button key={m} onClick={()=>{setPayMethod2(m);setPayBankAmount('');setPayCashAmount('')}}
                      className={`flex-1 py-1.5 rounded-xl text-sm font-semibold border transition-all ${payMethod2===m?(m==='โอน'?'bg-blue-500 text-white border-blue-500':m==='เงินสด'?'bg-green-600 text-white border-green-600':'bg-brand-red text-white border-brand-red'):'bg-white text-gray-400 border-gray-200'}`}>
                      {m==='โอน'?'💳 โอน':m==='เงินสด'?'💵 เงินสด':'แบ่ง'}
                    </button>
                  ))}
                </div>
                {payMethod2 === 'แบ่งจ่าย' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="ยอดโอน"
                      value={payBankAmount} onChange={e=>setPayBankAmount(e.target.value)}/>
                    <input autoComplete="off" className="input text-sm" type="number" placeholder="เงินสด"
                      value={payCashAmount} onChange={e=>setPayCashAmount(e.target.value)}/>
                    <p className={`col-span-2 text-xs font-medium ${(Number(payBankAmount||0)+Number(payCashAmount||0)) === Number(payAmount || 0) ? 'text-green-600' : 'text-orange-600'}`}>
                      รวมแบ่งจ่าย ฿{fmt(Number(payBankAmount||0)+Number(payCashAmount||0))} / ต้องเท่ากับ ฿{fmt(payAmount)}
                    </p>
                  </div>
                )}
                <ThaiDatePicker value={payDate2} onChange={setPayDate2} showTime className="input text-sm w-full"/>
                <div>
                  <p className="text-xs text-gray-500 mb-1">รูปใบเสร็จ (ไม่บังคับ)</p>
                  <div className="flex gap-2 flex-wrap">
                    {payImgPrev.map((src,i)=>(
                      <div key={i} className="relative w-14 h-14 rounded-xl overflow-hidden border flex-shrink-0">
                        <img src={src} className="w-full h-full object-cover"/>
                        <button onClick={()=>{
                          URL.revokeObjectURL(payImgPrev[i])
                          setPayImgFiles(f=>f.filter((_,j)=>j!==i))
                          setPayImgPrev(p=>p.filter((_,j)=>j!==i))
                        }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                          <X size={9} className="text-white"/>
                        </button>
                      </div>
                    ))}
                    <label className="w-14 h-14 rounded-xl border-2 border-dashed border-orange-300 flex flex-col items-center justify-center cursor-pointer flex-shrink-0">
                      <ImagePlus size={14} className="text-orange-400"/>
                      <span className="text-xs text-orange-400 mt-0.5">เพิ่ม</span>
                      <input type="file" multiple accept="image/*" className="hidden" onChange={e=>{
                        const files = Array.from(e.target.files)
                        setPayImgFiles(p=>[...p,...files])
                        setPayImgPrev(p=>[...p,...files.map(f=>URL.createObjectURL(f))])
                      }}/>
                    </label>
                  </div>
                </div>
                {payAmount && (
                  <p className={`text-xs font-medium ${isBatch
                    ? (Number(payAmount)>=batchTotalRemaining?'text-green-600':'text-orange-500')
                    : (Number(product.installment_paid||0)+Number(payAmount)>=Number(product.installment_total||0)?'text-green-600':'text-orange-500')}`}>
                    {isBatch
                      ? (Number(payAmount)>=batchTotalRemaining
                          ? '✅ ชำระครบทั้งกลุ่ม — สินค้าทั้งหมดจะเปลี่ยนเป็น "ขายแล้ว"'
                          : `คงเหลือทั้งกลุ่มหลังชำระ: ฿${fmt(Math.max(0,batchTotalRemaining-Number(payAmount)))}`)
                      : (Number(product.installment_paid||0)+Number(payAmount)>=Number(product.installment_total||0)
                          ? '✅ ชำระครบ — สินค้าจะเปลี่ยนเป็น "ขายแล้ว" อัตโนมัติ'
                          : `คงเหลือหลังชำระ: ฿${fmt(Number(product.installment_total||0)-Number(product.installment_paid||0)-Number(payAmount))}`)}
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={payInstallment} disabled={saving} className="btn-primary flex-1 py-2 text-sm">
                    {saving?'...':'บันทึก'}
                  </button>
                  <button onClick={()=>{setPayMode(false);setPayAmount('');setPayBankAmount('');setPayCashAmount('');setPayImgFiles([]);setPayImgPrev([])}} className="btn-ghost flex-1 py-2 text-sm">ยกเลิก</button>
                </div>
              </div>
            )}
            {!payMode && (
              <button onClick={cancelInstallment} disabled={saving}
                className="w-full flex items-center justify-center gap-2 text-sm text-orange-500 border border-orange-200 rounded-xl py-2.5 hover:bg-orange-50 transition-colors">
                ↩️ ยกเลิกผ่อนจ่าย (คืนสถานะ + หักยอดเงิน)
              </button>
            )}
          </div>
        )}

        {product.status==='Reserved' && (
          <button onClick={async()=>{await supabase.from('products').update({status:'Available'}).eq('id',id);load()}}
            className="w-full btn-ghost py-3 text-sm">ยกเลิกการจอง → พร้อมขาย</button>
        )}

        {product.status==='Sold' && !product.trade_ref_id && !product.installment_total && (
          <button onClick={cancelSale} disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-sm text-orange-500 border border-orange-200 rounded-xl py-2.5 hover:bg-orange-50 transition-colors">
            ↩️ ยกเลิกการขาย (คืนสถานะ + หักยอดเงิน)
          </button>
        )}

        {product.status==='Sold' && !product.trade_ref_id && product.installment_total && (
          <button onClick={cancelInstallment} disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-sm text-orange-500 border border-orange-200 rounded-xl py-2.5 hover:bg-orange-50 transition-colors">
            ↩️ ยกเลิกผ่อนจ่าย (คืนสถานะ + หักยอดเงิน)
          </button>
        )}

        {((product.status==='Sold' && product.trade_ref_id) || product.is_trade_in) && (
          <button onClick={cancelTrade} disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-sm text-blue-500 border border-blue-200 rounded-xl py-2.5 hover:bg-blue-50 transition-colors">
            ↩️ ยกเลิกการแลกเปลี่ยน (คืนสถานะ + ลบสินค้า B)
          </button>
        )}

        <button onClick={deleteProduct} disabled={saving}
          className="w-full flex items-center justify-center gap-2 text-sm text-red-400 py-2 hover:text-brand-red transition-colors">
          <Trash2 size={15}/>ลบสินค้านี้
        </button>
      </div>

      {lightboxImg && (
        <div className="fixed inset-0 bg-black/92 z-50 flex items-center justify-center p-4"
          onClick={()=>setLightboxImg(null)}>
          <button className="absolute top-4 right-4 bg-black/50 rounded-full p-2 text-white z-10">
            <X size={20}/>
          </button>
          <CachedImage src={lightboxImg} className="max-w-full max-h-full rounded-xl object-contain"/>
        </div>
      )}
    </div>
  )
}
