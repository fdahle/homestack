#!/usr/bin/env node
// Wipes all users and their note databases from CouchDB.
// Usage: node api/scripts/reset.js
//        npm run reset   (from project root)

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })

const { couch } = require('../lib/couchdb')

async function reset() {
  // 1. Find and delete all notes_* databases
  const dbListRes = await couch('GET', '/_all_dbs')
  const allDbs    = await dbListRes.json()
  const noteDbs   = allDbs.filter(db => db.startsWith('notes_'))

  for (const db of noteDbs) {
    await couch('DELETE', `/${db}`)
    console.log(`  deleted db: ${db}`)
  }

  // 2. Delete all user documents
  const usersRes  = await couch('GET', '/_users/_all_docs?startkey=%22org.couchdb.user%3A%22&endkey=%22org.couchdb.user%3A%EF%BF%BD%22&include_docs=true')
  const usersBody = await usersRes.json()
  const userDocs  = (usersBody.rows || []).map(r => r.doc).filter(Boolean)

  for (const doc of userDocs) {
    await couch('DELETE', `/_users/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(doc._rev)}`)
    console.log(`  deleted user: ${doc.name}`)
  }

  console.log(`\nDone. Deleted ${noteDbs.length} database(s) and ${userDocs.length} user(s).`)
  console.log('Now clear localStorage/sessionStorage and IndexedDB in the browser, then register again.')
}

reset().catch(err => { console.error(err.message); process.exit(1) })
