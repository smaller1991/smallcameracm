import { readFile } from 'node:fs/promises'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 60,
}

const MAX_HTML_BYTES = 4 * 1024 * 1024

const fontFiles = {
  '/fonts/Prompt-Regular.ttf': new URL('../public/fonts/Prompt-Regular.ttf', import.meta.url),
  '/fonts/Prompt-Medium.ttf': new URL('../public/fonts/Prompt-Medium.ttf', import.meta.url),
  '/fonts/Prompt-SemiBold.ttf': new URL('../public/fonts/Prompt-SemiBold.ttf', import.meta.url),
}

let inlinedFontUrls

async function loadFontUrls() {
  if (!inlinedFontUrls) {
    inlinedFontUrls = Object.fromEntries(await Promise.all(
      Object.entries(fontFiles).map(async ([path, url]) => {
        const bytes = await readFile(url)
        return [path, `data:font/ttf;base64,${bytes.toString('base64')}`]
      }),
    ))
  }
  return inlinedFontUrls
}

async function inlineReportFonts(html) {
  const requiredPaths = Object.keys(fontFiles).filter(path => html.includes(path))
  if (!requiredPaths.length) return html
  const fonts = await loadFontUrls()
  return Object.entries(fonts).filter(([path]) => requiredPaths.includes(path)).reduce(
    (result, [path, dataUrl]) => result.replaceAll(path, dataUrl),
    html,
  )
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const html = request.body?.html
  if (typeof html !== 'string' || !html.includes('class="account-page"')) {
    return response.status(400).json({ error: 'Invalid account report HTML' })
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return response.status(413).json({ error: 'Account report is too large' })
  }

  let browser
  let renderStage = 'font-loading'
  try {
    const printableHtml = await inlineReportFonts(html)
    renderStage = 'browser-launch'
    const localChromePath = process.env.ACCOUNT_PDF_CHROME_PATH
    const headlessMode = localChromePath ? true : 'shell'
    browser = await puppeteer.launch({
      args: localChromePath
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : puppeteer.defaultArgs({ args: chromium.args, headless: headlessMode }),
      defaultViewport: { width: 1123, height: 794, deviceScaleFactor: 1 },
      executablePath: localChromePath || await chromium.executablePath(),
      headless: headlessMode,
    })
    renderStage = 'page-render'
    const page = await browser.newPage()
    await page.setContent(printableHtml, { waitUntil: 'networkidle0' })
    await page.evaluate(async () => {
      await document.fonts.ready
      if (!document.fonts.check('400 10px PromptReport')) {
        throw new Error('PromptReport font did not load')
      }
    })
    renderStage = 'pdf-output'
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })

    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', 'inline; filename="account-report.pdf"')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).send(Buffer.from(pdf))
  } catch (error) {
    console.error('Account PDF render failed:', error)
    response.setHeader('X-Account-PDF-Stage', renderStage)
    return response.status(500).json({ error: 'Unable to render account PDF', stage: renderStage })
  } finally {
    if (browser) await browser.close()
  }
}
