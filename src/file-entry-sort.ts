import { compareFileNames } from './file-name-compare.js'

export type FileEntrySortKey = 'name' | 'size' | 'modifiedAt'
export type FileEntrySortDirection = 'asc' | 'desc'

export interface SortableFileEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  navigable?: boolean
  size: number
  modifiedAt: number
}

/** Returns a sorted copy. Navigable directories stay above files in every mode. */
export function sortFileEntries<T extends SortableFileEntry>(entries: readonly T[], key: FileEntrySortKey, direction: FileEntrySortDirection): T[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
    const leftDirectory = left.entry.kind === 'directory' || left.entry.navigable === true
    const rightDirectory = right.entry.kind === 'directory' || right.entry.navigable === true
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1

    const compared = compareValue(left.entry, right.entry, key)
    if (compared !== 0) return compared * multiplier
    const byName = key === 'name' ? 0 : compareFileNames(left.entry.name, right.entry.name)
    if (byName !== 0) return byName
    return left.index - right.index
  }).map(item => item.entry)
}

function compareValue(left: SortableFileEntry, right: SortableFileEntry, key: FileEntrySortKey): number {
  if (key === 'name') return compareFileNames(left.name, right.name)
  return left[key] - right[key]
}
