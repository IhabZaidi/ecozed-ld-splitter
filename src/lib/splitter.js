/**
 * تقسيم الصورة: عمودان (نصف العرض) × N صفوف = 2N شريحة WebP.
 * يعمل بالكامل داخل المتصفح عبر canvas.
 */

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const width = img.naturalWidth
      const height = img.naturalHeight
      if (!width || !height) {
        URL.revokeObjectURL(url)
        reject(new Error('تعذّر قراءة أبعاد الصورة. جرّب ملف JPG أو PNG أو WebP.'))
        return
      }
      resolve({ img, url, width, height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('تعذّر تحميل الصورة. جرّب ملف JPG أو PNG أو WebP.'))
    }
    img.src = url
  })
}

let webpSupportCache = null

/** هل يدعم المتصفح الترميز إلى WebP عبر canvas؟ */
export function canEncodeWebP() {
  if (webpSupportCache !== null) return webpSupportCache
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    webpSupportCache = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpSupportCache = false
  }
  return webpSupportCache
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('فشل ترميز الصورة في هذا المتصفح.'))),
      type,
      quality
    )
  })
}

/** يزيل من الاسم فقط المحارف الممنوعة في أنظمة الملفات، مع الحفاظ على العربية. */
export function sanitizeFileName(name, fallback = 'slice') {
  const cleaned = String(name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return cleaned || fallback
}

export function clampRows(v) {
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return 4
  return Math.min(10, Math.max(1, n))
}

export function clampQuality(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 80
  return Math.min(100, Math.max(10, Math.round(n)))
}

/**
 * @param {HTMLImageElement} img صورة محمّلة بالكامل
 * @param {{rows:number, cols:number, quality:number, outputWidth:number|null, prefix:string}} opts
 * quality من 0 إلى 1. outputWidth عرض الشريحة المصدَّرة بالبكسل، أو null لعرض الصورة الأصلية الكامل.
 */
export async function splitImage(img, opts) {
  const rows = clampRows(opts.rows)
  const cols = Number.isFinite(opts.cols) ? Math.min(4, Math.max(1, Math.round(opts.cols))) : 2
  const quality = Math.min(1, Math.max(0.05, Number(opts.quality) || 0.8))
  const prefix = sanitizeFileName(opts.prefix, 'slice')

  const W = img.naturalWidth
  const H = img.naturalHeight
  if (!W || !H) throw new Error('الصورة فارغة أو غير صالحة.')

  // عرض الشريحة = عرض الصورة الأصلية الكامل افتراضيًا
  const targetW =
    opts.outputWidth && Number.isFinite(opts.outputWidth) && opts.outputWidth > 0
      ? Math.floor(opts.outputWidth)
      : W

  // الصور الصغيرة جدًا قد تعطي خلايا بارتفاع/عرض صفر بعد التقريب
  if (Math.floor(W / cols) < 1 || Math.floor(H / rows) < 1) {
    throw new Error('الصورة صغيرة جدًا على عدد الأجزاء المطلوب. قلّل عدد الأجزاء.')
  }

  const useWebP = canEncodeWebP()
  const mime = useWebP ? 'image/webp' : 'image/png'
  const ext = useWebP ? 'webp' : 'png'
  const total = rows * cols
  const pad = total >= 100 ? 3 : 2
  const out = []
  let seq = 0

  // خلية واحدة قابلة لإعادة الاستخدام لتقليل استهلاك الذاكرة
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('المتصفح لا يدعم Canvas.')

  for (let row = 0; row < rows; row++) {
    const sy = Math.round((row * H) / rows)
    const sh = Math.round(((row + 1) * H) / rows) - sy
    if (sh < 1) throw new Error('الصورة صغيرة جدًا على عدد الأجزاء المطلوب.')
    for (let col = 0; col < cols; col++) {
      const sx = Math.round((col * W) / cols)
      const sw = Math.round(((col + 1) * W) / cols) - sx
      if (sw < 1) throw new Error('الصورة صغيرة جدًا على عدد الأجزاء المطلوب.')

      // كل شريحة تُصدَّر بعرض الصورة الأصلية الكامل (تكبير/تصغير متناسب)
      const k = targetW / sw
      const dw = targetW
      const dh = Math.max(1, Math.round(sh * k))

      canvas.width = dw
      canvas.height = dh
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, dw, dh)
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)

      const blob = await canvasToBlob(canvas, mime, useWebP ? quality : undefined)
      const url = URL.createObjectURL(blob)
      seq += 1
      // بادئة مرقّبة بصفار حتى يرتّبها مدير الملفات بالترتيب الصحيح تلقائيًا
      const name = `${prefix}_${String(seq).padStart(pad, '0')}_r${row + 1}-c${col + 1}.${ext}`
      out.push({ blob, url, name, width: dw, height: dh, size: blob.size, seq, row: row + 1, col: col + 1 })
    }
  }
  return { items: out, format: ext }
}

export function revokeItems(items) {
  for (const it of items) {
    try {
      URL.revokeObjectURL(it.url)
    } catch {
      /* تجاهل */
    }
  }
}

export function formatKB(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
