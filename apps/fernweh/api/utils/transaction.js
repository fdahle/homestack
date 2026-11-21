// Runs `action` (synchronous) in a transaction. Inside another transaction it becomes a
// savepoint, so helpers that use transactions (saveMarker) can be part of a bigger one.
const depths = new WeakMap()

export function transaction(db, action) {
  const depth = depths.get(db) ?? 0
  const savepoint = `sp${depth}`
  db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE')
  depths.set(db, depth + 1)
  try {
    const result = action()
    db.exec(depth ? `RELEASE ${savepoint}` : 'COMMIT')
    return result
  } catch (err) {
    if (depth) db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
    else db.exec('ROLLBACK')
    throw err
  } finally {
    depths.set(db, depth)
  }
}
