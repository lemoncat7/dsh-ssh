export function nextTransferTabName(names: ReadonlySet<string>): string {
  let number = 1
  while (names.has(`任务 ${number}`)) number++
  return `任务 ${number}`
}

/** Keep the first occurrence of a saved name and repair older duplicate task labels. */
export function normalizeTransferTabNames<T extends { name: string }>(tabs: T[]): T[] {
  const occupied = new Set(tabs.map(tab => tab.name))
  const seen = new Set<string>()
  return tabs.map(tab => {
    if (!seen.has(tab.name)) {
      seen.add(tab.name)
      return tab
    }
    const name = nextTransferTabName(occupied)
    occupied.add(name)
    return { ...tab, name }
  })
}
