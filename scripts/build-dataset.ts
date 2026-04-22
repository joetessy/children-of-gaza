import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

interface RawRecord {
  id?: string
  name?: string
  en_name?: string
  age?: number | null
  sex?: string
  dob?: string
}

interface PackResult {
  count: number
  offsetBytes: number
  textBytes: number
}

const SOURCE_URL =
  'https://raw.githubusercontent.com/TechForPalestine/palestine-datasets/main/killed-in-gaza.json'
const OUT_DIR = join(process.cwd(), 'public', 'data')

const encoder = new TextEncoder()

const fetchRecords = async (): Promise<RawRecord[]> => {
  console.log(`-> fetching ${SOURCE_URL}`)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) {
    throw new Error(`Upstream fetch failed: ${res.status} ${res.statusText}`)
  }
  const records = await res.json()
  if (!Array.isArray(records)) {
    throw new Error('Upstream JSON was not an array')
  }
  return records
}

const filterChildren = ({ records }: { records: RawRecord[] }): RawRecord[] => {
  return records.filter((r) => {
    if (typeof r.age !== 'number') return false
    if (r.age < 0 || r.age >= 18) return false
    const ar = (r.name ?? '').trim()
    const en = (r.en_name ?? '').trim()
    return ar.length > 0 || en.length > 0
  })
}

const packNames = ({ records }: { records: RawRecord[] }): { buf: Uint8Array; result: PackResult } => {
  const count = records.length
  const slots = count * 2 + 1
  const encoded: Uint8Array[] = []
  let cursor = 0
  const offsets = new Uint32Array(slots)

  for (let i = 0; i < count; i += 1) {
    const r = records[i]
    const ar = encoder.encode((r.name ?? '').trim())
    const en = encoder.encode((r.en_name ?? '').trim())
    offsets[i * 2] = cursor
    encoded.push(ar)
    cursor += ar.length
    offsets[i * 2 + 1] = cursor
    encoded.push(en)
    cursor += en.length
  }
  offsets[slots - 1] = cursor

  const offsetBytes = slots * 4
  const totalBytes = offsetBytes + cursor
  const buf = new Uint8Array(totalBytes)
  const dv = new DataView(buf.buffer)
  for (let i = 0; i < slots; i += 1) {
    dv.setUint32(i * 4, offsets[i], true)
  }
  let pos = offsetBytes
  for (const chunk of encoded) {
    buf.set(chunk, pos)
    pos += chunk.length
  }

  return {
    buf,
    result: {
      count,
      offsetBytes,
      textBytes: cursor
    }
  }
}

const packAges = ({ records }: { records: RawRecord[] }): Uint8Array => {
  const buf = new Uint8Array(records.length)
  for (let i = 0; i < records.length; i += 1) {
    const age = records[i].age
    buf[i] = typeof age === 'number' ? Math.max(0, Math.min(255, age)) : 255
  }
  return buf
}

const today = (): string => {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const main = async () => {
  const raw = await fetchRecords()
  console.log(`   fetched ${raw.length} records`)

  const children = filterChildren({ records: raw })
  console.log(`   filtered to ${children.length} children (age < 18)`)

  const { buf: namesBuf, result } = packNames({ records: children })
  const agesBuf = packAges({ records: children })

  const snapshot = {
    date: today(),
    count: children.length,
    sourceUrl: SOURCE_URL
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'names.bin'), namesBuf)
  await writeFile(join(OUT_DIR, 'meta.bin'), agesBuf)
  await writeFile(join(OUT_DIR, 'snapshot.json'), JSON.stringify(snapshot, null, 2))

  console.log(
    `-> wrote names.bin (${(result.offsetBytes + result.textBytes).toLocaleString()} bytes), meta.bin (${agesBuf.length} bytes), snapshot.json`
  )
  console.log(`   count: ${snapshot.count}  date: ${snapshot.date}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
