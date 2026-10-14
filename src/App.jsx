import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  canEncodeWebP,
  clampQuality,
  clampRows,
  formatKB,
  loadImageFromFile,
  revokeItems,
  sanitizeFileName,
  splitImage,
} from './lib/splitter.js'

const COLS = 2 // ثابت: التقسيم من نصف العرض

const ACCEPTED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']

function isImageFile(file) {
  if (!file) return false
  if (file.type && file.type.startsWith('image/')) return true
  const ext = file.name?.split('.').pop()?.toLowerCase()
  return ACCEPTED_EXT.includes(ext)
}

export default function App() {
  const [sourceFile, setSourceFile] = useState(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [imgEl, setImgEl] = useState(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [rows, setRows] = useState(4)
  const [quality, setQuality] = useState(80)
  const [prefix, setPrefix] = useState('slice')
  const [sliceWidth, setSliceWidth] = useState('')
  const [items, setItems] = useState([])
  const [format, setFormat] = useState('webp')
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [dragOn, setDragOn] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const loadRun = useRef(0)
  const splitRun = useRef(0)
  const itemsRef = useRef([])
  itemsRef.current = items

  const rowsNum = clampRows(rows)
  const totalSlices = COLS * rowsNum

  // تنظيف عناوين الكائنات عند إزالة المكوّن
  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      revokeItems(itemsRef.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const setNewItems = useCallback((next, nextFormat) => {
    revokeItems(itemsRef.current)
    setItems(next)
    setFormat(nextFormat)
  }, [])

  const clearSource = useCallback(() => {
    loadRun.current += 1
    splitRun.current += 1
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    revokeItems(itemsRef.current)
    setSourceFile(null)
    setSourceUrl('')
    setImgEl(null)
    setImgSize({ w: 0, h: 0 })
    setItems([])
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }, [sourceUrl])

  const handleFile = useCallback(
    async (file) => {
      if (!file) return
      if (!isImageFile(file)) {
        setError('اختر ملف صورة (JPG أو PNG أو WebP).')
        return
      }
      const run = ++loadRun.current
      splitRun.current += 1 // إلغاء أي تقسيم قديم
      setError('')
      revokeItems(itemsRef.current)
      setItems([])
      try {
        const { img, url, width, height } = await loadImageFromFile(file)
        if (run !== loadRun.current) {
          URL.revokeObjectURL(url) // ملف أحدث تجاوز هذا التحميل
          return
        }
        setSourceUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        setSourceFile(file)
        setImgEl(img)
        setImgSize({ w: width, h: height })
        setPrefix((prev) => {
          if (prev && prev !== 'slice') return prev
          const base =
            sanitizeFileName(file.name.replace(/\.[^.]+$/, ''), 'slice').slice(0, 30) || 'slice'
          return base
        })
      } catch (e) {
        if (run === loadRun.current) setError(e.message)
      }
    },
    []
  )

  const onSplit = useCallback(async () => {
    if (!imgEl || busy) return
    const run = ++splitRun.current
    const r = clampRows(rows)
    setRows(r)
    const q = clampQuality(quality)
    setQuality(q)
    setBusy(true)
    setError('')
    try {
      const rawW = Number.parseInt(sliceWidth, 10)
      const outW = Number.isFinite(rawW) && rawW > 0 ? rawW : null // null = عرض الصورة الأصلية
      const { items: parts, format: fmt } = await splitImage(imgEl, {
        rows: r,
        cols: COLS,
        quality: q / 100,
        outputWidth: outW,
        prefix: sanitizeFileName(prefix, 'slice'),
      })
      if (run !== splitRun.current) {
        revokeItems(parts) // نتيجة قديمة بعد تقسيم أحدث
        return
      }
      setNewItems(parts, fmt)
    } catch (e) {
      if (run === splitRun.current) setError(e.message)
    } finally {
      if (run === splitRun.current) setBusy(false)
    }
  }, [imgEl, busy, rows, quality, sliceWidth, prefix, setNewItems])

  // إعادة تقسيم تلقائية عند تغيير الصفوف أو الجودة (بعد أول تقسيم فقط)
  useEffect(() => {
    if (!imgEl || items.length === 0 || busy) return
    const t = setTimeout(() => onSplit(), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsNum, quality, sliceWidth])

  const downloadOne = (item) => {
    const a = document.createElement('a')
    a.href = item.url
    a.download = item.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const downloadZip = async () => {
    if (items.length === 0 || zipping) return
    setZipping(true)
    try {
      const zip = new JSZip()
      for (const item of items) zip.file(item.name, item.blob)
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${sanitizeFileName(prefix, 'slices')}_2x${rowsNum}_${items.length}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch {
      setError('فشل إنشاء ملف ZIP.')
    } finally {
      setZipping(false)
    }
  }

  const totalOut = items.reduce((s, it) => s + it.size, 0)
  const webpOK = canEncodeWebP()

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* رأس */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">مقسّم الصور</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-neutral-500">
              ارفع صورة واحدة ← تنقسم إلى نصفين بالعرض ← كل نصف ينقسم عموديًا إلى أجزاء ←
              تحصل على {totalSlices} صور {format === 'webp' ? 'WebP' : 'PNG'} مضغوطة.
            </p>
          </div>
          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm font-semibold">
            {COLS} × {rowsNum} = {totalSlices}
          </span>
        </header>

        {!webpOK && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            متصفحك لا يدعم الترميز إلى WebP، سيتم إخراج الشرائح بصيغة PNG بدلًا من ذلك.
          </p>
        )}

        <main className="grid gap-4 lg:grid-cols-[360px_1fr]">
          {/* الإعدادات */}
          <section className="h-fit rounded-2xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-bold text-neutral-400">١ · الصورة الأصلية</h2>

            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOn(true)
              }}
              onDragLeave={() => setDragOn(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOn(false)
                handleFile(e.dataTransfer.files?.[0])
              }}
              onClick={() => fileRef.current?.click()}
              className={`mt-3 flex min-h-44 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
                dragOn ? 'border-neutral-900 bg-neutral-100' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              {sourceUrl ? (
                <div className="relative w-full">
                  <img src={sourceUrl} alt="الصورة الأصلية" className="block max-h-80 w-full bg-black object-contain" />
                  <div
                    className="pointer-events-none absolute inset-0 grid"
                    style={{
                      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                      gridTemplateRows: `repeat(${rowsNum}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: totalSlices }).map((_, i) => (
                      <div key={i} className="border border-white/80 bg-black/5" />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-6 py-10 text-center">
                  <p className="font-semibold">اضغط أو اسحب صورة هنا</p>
                  <p className="mt-1 text-xs text-neutral-400">JPG · PNG · WebP</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>

            {sourceFile && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                <span className="max-w-44 truncate font-medium text-neutral-700">{sourceFile.name}</span>
                <span>
                  {imgSize.w} × {imgSize.h} · {formatKB(sourceFile.size)}
                </span>
                <button type="button" onClick={clearSource} className="font-semibold text-neutral-900 underline underline-offset-2">
                  إزالة
                </button>
              </div>
            )}

            <h2 className="mt-6 text-sm font-bold text-neutral-400">٢ · الإعدادات</h2>

            <div className="mt-3">
              <span className="mb-1.5 block text-[13px] font-semibold">الأجزاء العمودية لكل نصف</span>
              <div className="flex gap-1.5">
                {[3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRows(n)}
                    className={`flex-1 rounded-lg border px-0 py-2 text-sm font-bold transition ${
                      rowsNum === n
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-white hover:border-neutral-400'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={rows}
                  onChange={(e) => setRows(e.target.value === '' ? '' : Number(e.target.value))}
                  onBlur={() => setRows((v) => clampRows(v))}
                  title="عدد مخصص من 1 إلى 10"
                  className="w-16 rounded-lg border border-neutral-200 px-2 py-2 text-center text-sm outline-none focus:border-neutral-900"
                />
              </div>
              <p className="mt-1 text-xs text-neutral-400">٤ ← ٨ صور · ٥ ← ١٠ صور (عمودان × N صفوف)</p>
            </div>

            <div className="mt-4">
              <span className="mb-1.5 block text-[13px] font-semibold">جودة الضغط — {quality}%</span>
              <input
                type="range"
                min="10"
                max="100"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-xs text-neutral-400">٧٥–٨٥ توازن جيد بين الجودة والحجم.</p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold">بادئة الأسماء</span>
                <input
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="slice"
                  maxLength={60}
                  className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm outline-none focus:border-neutral-900"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold">عرض الشريحة (بكسل)</span>
                <input
                  type="number"
                  min="100"
                  placeholder={imgSize.w ? `الأصلي: ${imgSize.w}` : 'عرض الصورة الأصلية'}
                  value={sliceWidth}
                  onChange={(e) => setSliceWidth(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm outline-none focus:border-neutral-900"
                />
              </label>
            </div>
            <p className="-mt-1 text-xs text-neutral-400">كل شريحة تُصدَّر بعرض الصورة الأصلية الكامل.</p>

            <button
              type="button"
              disabled={!imgEl || busy}
              onClick={onSplit}
              className="mt-4 w-full rounded-xl bg-neutral-900 py-3 text-sm font-bold text-white transition disabled:cursor-default disabled:opacity-40 enabled:hover:bg-neutral-700"
            >
              {busy ? 'جارٍ التقسيم…' : items.length ? 'إعادة التقسيم' : `قسّم إلى ${totalSlices} صور`}
            </button>
            {error && <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p>}
          </section>

          {/* النتيجة */}
          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-neutral-400">٣ · النتيجة ({items.length})</h2>
              {items.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">الإجمالي {formatKB(totalOut)}</span>
                  <button
                    type="button"
                    onClick={downloadZip}
                    disabled={zipping || busy}
                    className="rounded-lg bg-neutral-900 px-3.5 py-2 text-[13px] font-bold text-white transition disabled:opacity-40 enabled:hover:bg-neutral-700"
                  >
                    {zipping ? 'جارٍ الضغط…' : 'تحميل الكل ZIP'}
                  </button>
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <p className="mt-3 rounded-xl bg-neutral-50 px-4 py-8 text-center text-sm leading-6 text-neutral-400">
                قسّم صورة لعرض الشرائح الـ{totalSlices} هنا.
                <br />
                كل شريحة تحمل رقم ترتيبها (1، 2، 3…) واسم ملفها يبدأ بنفس الرقم،
                <br />
                فيرتّبها مدير الملفات تلقائيًا من الأعلى إلى الأسفل، صفًا بصف.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3" dir="ltr">
                {items.map((it) => (
                  <figure key={it.name} className="relative overflow-hidden rounded-xl border border-neutral-200">
                    <span className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white shadow">
                      {it.seq}
                    </span>
                    <img src={it.url} alt={it.name} loading="lazy" className="block w-full bg-neutral-100" />
                    <figcaption dir="rtl" className="flex flex-col gap-0.5 px-2.5 py-2 text-xs text-neutral-500">
                      <span className="truncate font-semibold text-neutral-800" title={it.name}>
                        {it.seq} · {it.name}
                      </span>
                      <span>
                        صف {it.row} · عمود {it.col} · {it.width}×{it.height} · {formatKB(it.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => downloadOne(it)}
                        className="mt-1 rounded-lg border border-neutral-200 py-1.5 font-bold text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
                      >
                        تحميل
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </main>

        <footer className="mt-6 text-center text-xs text-neutral-400">
          عمودان ثابتان (نصف العرض) · الصفوف من ١ إلى ١٠ · كل المعالجة داخل متصفحك ولا يُرفع أي شيء.
        </footer>

        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5 text-center">
          <p className="text-sm font-bold">صُنع بواسطة إيهاب (Ihab)</p>
          <p className="mt-1 text-[13px] text-neutral-500">دعوة في ظهر الغيب تكفي 🤲</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <a
              href="https://wa.me/962796332534"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-neutral-900 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-neutral-700"
            >
              واتساب: 0796332534
            </a>
            <a
              href="https://www.tiktok.com/@ihabzzz"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-neutral-200 px-4 py-2 text-[13px] font-bold text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
            >
              تيك توك: ihabzzz@
            </a>
          </div>
          <p className="mt-3 text-[13px] text-neutral-500">الي محتاج خدمات تطوير يتواصل معي</p>
        </div>
      </div>
    </div>
  )
}
