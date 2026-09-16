import { compareFileNames } from './file-name-compare.js'
import { ftpListDateSortValue } from './ftp-list-date.js'

export type FileEntrySortKey = 'name' | 'size' | 'modifiedAt'
export type FileEntrySortDirection = 'asc' | 'desc'

export interface SortableFileEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  navigable?: boolean
  size: number
  modifiedAt: number
  modifiedAtText?: string
}

/** Returns a sorted copy. Navigable directories stay above files in every mode. */
export function sortFileEntries<T extends SortableFileEntry>(entries: readonly T[], key: FileEntrySortKey, direction: FileEntrySortDirection): T[] {
  const multiplier = direction === 'asc' ? 1 : -1
  const now = Date.now()
  return entries.map((entry, index) => ({ entry, index, value: key === 'modifiedAt' ? entry.modifiedAt || ftpListDateSortValue(entry.modifiedAtText, now) : entry.size })).sort((left, right) => {
    const leftDirectory = left.entry.kind === 'directory' || left.entry.navigable === true
    const rightDirectory = right.entry.kind === 'directory' || right.entry.navigable === true
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1

    const compared = key === 'name' ? compareFileNames(left.entry.name, right.entry.name) : left.value - right.value
    if (compared !== 0) return compared * multiplier
    const byName = key === 'name' ? 0 : compareFileNames(left.entry.name, right.entry.name)
    if (byName !== 0) return byName * multiplier
    return left.index - right.index
  }).map(item => item.entry)
}
