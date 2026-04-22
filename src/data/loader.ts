import type { Dataset, Snapshot } from '../types.ts'

interface DataBundle {
  snapshot: Snapshot
  dataset: Dataset
}

const decoder = new TextDecoder('utf-8')

export const loadDataBundle = async (): Promise<DataBundle> => {
  const [snapshotRes, namesRes, metaRes] = await Promise.all([
    fetch('/data/snapshot.json'),
    fetch('/data/names.bin'),
    fetch('/data/meta.bin')
  ])

  if (!snapshotRes.ok || !namesRes.ok || !metaRes.ok) {
    throw new Error('Memorial data could not be loaded.')
  }

  const snapshot: Snapshot = await snapshotRes.json()
  const namesBuf = new Uint8Array(await namesRes.arrayBuffer())
  const metaBuf = new Uint8Array(await metaRes.arrayBuffer())

  const count = snapshot.count
  const offsetBytes = (count * 2 + 1) * 4
  const offsetView = new DataView(namesBuf.buffer, namesBuf.byteOffset, offsetBytes)
  const offsets = new Uint32Array(count * 2 + 1)
  for (let i = 0; i < offsets.length; i += 1) {
    offsets[i] = offsetView.getUint32(i * 4, true)
  }

  const textStart = offsetBytes
  const sliceAt = ({ slot }: { slot: number }): string => {
    const start = textStart + offsets[slot]
    const end = textStart + offsets[slot + 1]
    return decoder.decode(namesBuf.subarray(start, end))
  }

  const arabicAt = (index: number) => sliceAt({ slot: index * 2 })
  const englishAt = (index: number) => sliceAt({ slot: index * 2 + 1 })

  const ages = metaBuf.subarray(0, count)

  return {
    snapshot,
    dataset: {
      count,
      ages: new Uint8Array(ages),
      arabicAt,
      englishAt
    }
  }
}
