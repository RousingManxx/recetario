export type RGB = [number, number, number]
export const C = {
  text: [0.243, 0.165, 0.133] as RGB, muted: [0.478, 0.384, 0.337] as RGB, line: [0.87, 0.82, 0.76] as RGB,
  sales: [0.725, 0.376, 0.42] as RGB, cost: [0.545, 0.42, 0.353] as RGB, profit: [0.247, 0.478, 0.278] as RGB, bad: [0.7, 0.27, 0.23] as RGB,
  warn: [0.66, 0.45, 0.12] as RGB, warnBg: [0.96, 0.9, 0.76] as RGB, head: [0.937, 0.894, 0.827] as RGB, white: [1, 1, 1] as RGB,
}

const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const BASE: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N' }
const SUBS: Record<string, string> = { '−': '-', '–': '–', '▲': '+', '▼': '-', '＝': '=', '⚠': '!', '’': '’', '“': '“', '”': '”' }
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

export function winAnsi(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = SUBS[ch] ?? ch, code = c.codePointAt(0)!
    if (c === '–') out.push(0x96); else if (c === '—') out.push(0x97); else if (c === '•') out.push(0x95)
    else if (c === '’') out.push(0x92); else if (c === '“') out.push(0x93); else if (c === '”') out.push(0x94)
    else if (code >= 32 && code < 256) out.push(code)
    else out.push(63)
  }
  return out
}
function widthOf(s: string, size: number, bold: boolean): number {
  let w = 0
  for (const ch of s) { const b = BASE[ch] ?? ch; const i = b.charCodeAt(0) - 32; w += i >= 0 && i < W.length ? W[i] : 556 }
  return ((w * (bold ? 1.06 : 1)) / 1000) * size
}
export const num = (n: number) => (Math.round(n * 100) / 100).toString()
export const col = (c: RGB) => c.map((x) => num(x * 1000) === '0' ? '0' : (Math.round(x * 1000) / 1000).toString()).join(' ')
export const PW = 595.28, PH = 841.89, M = 40

type PdfImage = { name: string; data: Uint8Array; width: number; height: number }

function jpegDimensions(data: Uint8Array): { width: number; height: number } {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('La foto no es un JPEG válido.')
  let i = 2
  while (i + 4 < data.length) {
    if (data[i] !== 0xff) { i++; continue }
    while (data[i] === 0xff) i++
    const marker = data[i++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (i + 1 >= data.length) break
    const length = data[i] * 256 + data[i + 1]
    if (length < 2 || i + length > data.length) break
    if (SOF.has(marker)) {
      const height = data[i + 3] * 256 + data[i + 4], width = data[i + 5] * 256 + data[i + 6]
      if (width > 0 && height > 0 && data[i + 7] === 3) return { width, height }
      break
    }
    i += length
  }
  throw new Error('No se pudieron leer las dimensiones de la foto JPEG.')
}

export class Pdf {
  pages: string[][] = []
  y = 0
  private cur!: string[]
  private images: PdfImage[] = []
  private imageBySource = new Map<string, PdfImage>()
  private pageImages = new Map<string[], Set<string>>()
  constructor() { this.newPage() }
  newPage() { this.cur = []; this.pages.push(this.cur); this.pageImages.set(this.cur, new Set()); this.y = M }
  ensure(h: number) { if (this.y + h > PH - M - 14) this.newPage() }
  /** y en coordenadas de arriba hacia abajo. */
  measureText(s: string, size: number, bold = false) { return widthOf(s, size, bold) }
  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: RGB; align?: 'l' | 'r' | 'c' } = {}) {
    const size = o.size ?? 10, bold = !!o.bold
    const w = widthOf(s, size, bold)
    const px = o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x
    const hex = winAnsi(s).map((b) => b.toString(16).padStart(2, '0')).join('')
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(o.color ?? C.text)} rg ${num(px)} ${num(PH - y - size * 0.8)} Td <${hex}> Tj ET`)
  }
  rect(x: number, y: number, w: number, h: number, fill: RGB) {
    if (w <= 0 || h <= 0) return
    this.cur.push(`${col(fill)} rg ${num(x)} ${num(PH - y - h)} ${num(w)} ${num(h)} re f`)
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, fill: RGB) {
    if (w <= 0 || h <= 0) return
    const radius = Math.min(r, w / 2, h / 2), k = radius * 0.55228475
    const top = PH - y - h, bottom = PH - y
    this.cur.push(`${col(fill)} rg ${num(x + radius)} ${num(bottom)} m ${num(x + w - radius)} ${num(bottom)} l ${num(x + w - radius + k)} ${num(bottom)} ${num(x + w)} ${num(bottom - radius + k)} ${num(x + w)} ${num(bottom - radius)} c ${num(x + w)} ${num(top + radius)} l ${num(x + w)} ${num(top + radius - k)} ${num(x + w - radius + k)} ${num(top)} ${num(x + w - radius)} ${num(top)} c ${num(x + radius)} ${num(top)} l ${num(x + radius - k)} ${num(top)} ${num(x)} ${num(top + radius - k)} ${num(x)} ${num(top + radius)} c ${num(x)} ${num(bottom - radius)} l ${num(x)} ${num(bottom - radius + k)} ${num(x + radius - k)} ${num(bottom)} ${num(x + radius)} ${num(bottom)} c h f`)
  }
  line(x1: number, y1: number, x2: number, y2: number, c: RGB = C.line, w = 0.6) {
    this.cur.push(`${col(c)} RG ${w} w ${num(x1)} ${num(PH - y1)} m ${num(x2)} ${num(PH - y2)} l S`)
  }
  poly(pts: [number, number][], c: RGB, w = 1.6) {
    if (pts.length < 2) return
    this.cur.push(`${col(c)} RG ${w} w ` + pts.map(([x, y], i) => `${num(x)} ${num(PH - y)} ${i ? 'l' : 'm'}`).join(' ') + ' S')
  }
  hatch(x: number, y: number, w: number, h: number, c: RGB) {
    if (w <= 0 || h <= 0) return
    this.cur.push(`q ${num(x)} ${num(PH - y - h)} ${num(w)} ${num(h)} re W n ${col(c)} RG 0.8 w`)
    for (let d = -h; d < w; d += 3.5) this.cur.push(`${num(x + d)} ${num(PH - y - h)} m ${num(x + d + h)} ${num(PH - y)} l S`)
    this.cur.push('Q')
  }
  private readImage(dataUrl: string) {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    if (!match) throw new Error('La foto debe estar en formato JPEG para incluirla en el PDF.')
    let image = this.imageBySource.get(dataUrl)
    if (!image) {
      const binary = atob(match[1])
      const data = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const dimensions = jpegDimensions(data)
      image = { name: `Im${this.images.length + 1}`, data, ...dimensions }
      this.images.push(image); this.imageBySource.set(dataUrl, image)
    }
    return image
  }
  imageDimensions(dataUrl: string) {
    const { width, height } = this.readImage(dataUrl)
    return { width, height }
  }
  image(dataUrl: string, x: number, y: number, boxWidth: number, boxHeight: number) {
    const image = this.readImage(dataUrl)
    this.pageImages.get(this.cur)!.add(image.name)
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height)
    const width = image.width * scale, height = image.height * scale
    const left = x + (boxWidth - width) / 2, bottom = PH - y - (boxHeight + height) / 2
    this.cur.push(`q ${num(width)} 0 0 ${num(height)} ${num(left)} ${num(bottom)} cm /${image.name} Do Q`)
  }
  wrap(s: string, width: number, size: number, bold = false): string[] {
    const out: string[] = []; let line = ''
    for (const word of s.split(/\s+/)) {
      const t = line ? line + ' ' + word : word
      if (widthOf(t, size, bold) <= width || !line) line = t; else { out.push(line); line = word }
    }
    if (line) out.push(line)
    return out
  }
  paragraph(s: string, o: { size?: number; color?: RGB; bold?: boolean; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 9, lh = size * 1.35, x = o.x ?? M, width = o.width ?? PW - 2 * M
    for (const l of this.wrap(s, width, size, o.bold)) { this.ensure(lh); this.text(x, this.y, l, { size, color: o.color, bold: o.bold }); this.y += lh }
    this.y += o.gap ?? 0
  }
  heading(s: string) { this.ensure(40); this.y += 8; this.text(M, this.y, s, { size: 13, bold: true }); this.y += 17; this.line(M, this.y, PW - M, this.y); this.y += 8 }

  build(footer: string): Uint8Array {
    const objs: string[] = []
    const add = (s: string) => { objs.push(s); return objs.length }
    add('<< /Type /Catalog /Pages 2 0 R >>')
    add('')
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const imageRefs = new Map<string, number>()
    for (const image of this.images) {
      let hex = ''
      for (const byte of image.data) hex += byte.toString(16).padStart(2, '0')
      const stream = hex + '>'
      imageRefs.set(image.name, add(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${stream.length} >>\nstream\n${stream}\nendstream`))
    }
    const kids: number[] = []
    this.pages.forEach((ops, i) => {
      const all = [...ops, `BT /F1 8 Tf ${col(C.muted)} rg ${num(M)} 24 Td <${winAnsi(footer).map((b) => b.toString(16).padStart(2, '0')).join('')}> Tj ET`,
        `BT /F1 8 Tf ${col(C.muted)} rg ${num(PW - M - 40)} 24 Td <${winAnsi(`Página ${i + 1} de ${this.pages.length}`).map((b) => b.toString(16).padStart(2, '0')).join('')}> Tj ET`]
      const content = all.join('\n')
      const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
      const xobjects = [...(this.pageImages.get(ops) ?? [])].map((name) => `/${name} ${imageRefs.get(name)} 0 R`).join(' ')
      const imageResources = xobjects ? ` /XObject << ${xobjects} >>` : ''
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imageResources} >> /Contents ${cid} 0 R >>`))
    })
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
    let out = '%PDF-1.4\n'
    const offs: number[] = []
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const bytes = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
    return bytes
  }
}
