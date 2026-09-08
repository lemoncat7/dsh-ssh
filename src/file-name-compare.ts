// Reuse ICU collation state across comparisons: creating it inside an O(n log n)
// sort dominates large directory loads on both the server and the browser.
const fileNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const compareFileNames = fileNames.compare
