'use strict';

var access = require('safe-access')
var pull = require('pull-stream')
var pl = require('pull-level')
var r = require('ramda')
var peek = require('level-peek')
var stringify = require('stable-stringify')
var tc = require('type-check').typeCheck;
require('colors')

module.exports = {
  read: read,
  readOne: makeReadOne(read),
  makeReadOne: makeReadOne,
  write: write,
  writeOne: makeWriteOne(write),
  makeWriteOne: makeWriteOne,
  resolveIndexDocs: resolveIndexDocs,
  addIndexDocs: addIndexDocs,
  makeIndexDocs: makeIndexDocs,
  makeIndexDoc: makeIndexDoc,
  makeRange: makeRange
}

// settings = {
//   db: JS,
//   indexes: JSON,
//   level_opts: JSON
// }

function colorize (string) {
  var arr = string.split('')
  var colors = [ 'blue', 'cyan', 'green', 'yellow', 'red', 'magenta' ]
  var color
  var output = []
  arr.forEach(function (char) {
    if (char === 'ÿ') {
      color = colors.pop()
      colors.unshift(color)
      output.push('::'.grey)
    } else {
      output.push(char[color])
    }
  })
  output.pop()
  output = output.join('')
  return output
}

function esc (value) {
  if (value) {
    return stringify(value).replace('ÿ', '&&xff')
  }
}


function read (settings, query) {
  if(!tc('{ createIfMissing: Boolean, ... }', settings.db.options)) {
    throw new Error('settings.db is not supposed to be ' + settings.db)
  }

  var range = makeRange(query, settings.level_opts)
  var deferred = pull.defer()

  if (query.peek) {
    peek[query.peek](settings.db, range, function (err, key, value) {
      deferred.resolve(
        pull(
          pull.values([{ key: key, value: value }]),
          resolveIndexDocs(settings.db)
        )
      )
    })
  }
  else {
    deferred.resolve(
      pull(
        pl.read(settings.db, range),
        resolveIndexDocs(settings.db)
      )
    )
  }

  return deferred
}

function makeReadOne (read) {
  return function readOne (settings, query, callback) {
    pull(
      read(settings, query),
      pull.collect(function (err, arr) {
        callback(err, arr[0])
      })
    )
  }
}

function write (settings, callback) {
  if(!tc('{ createIfMissing: Boolean, ... }', settings.db.options)) {
    throw new Error('settings.db is not supposed to be ' + settings.db)
  }

  return pull(
    addIndexDocs(settings.indexes),
    pl.write(settings.db, settings.level_opts, callback)
  )
}

function makeWriteOne (write) {
  return function writeOne (settings, doc, callback) {
    pull(
      pull.values([doc]),
      write(settings, callback)
    )
  }
}


function resolveIndexDocs (db) {
  return pull.asyncMap(function (data, callback) {
    db.get(data.value, function (err, value) {
      callback(null, value && { key: data.value, value: value })
    })
  })
}

function addIndexDocs (indexes) {
  return pull(
    pull.map(function (doc) {
      var batch = makeIndexDocs({ key: doc.key, value: doc.value }, indexes)
      doc.type = 'put'
      batch.push(doc)
      return batch
    }),
    pull.flatten()
  )
}

function makeIndexDocs (doc, indexes) {
  if (!tc('[String|[String]]', indexes)) {
    throw new Error('indexes is not supposed to be ' + indexes)
  }

  var batch = []

  // Generate an index doc for each index
  Object.keys(indexes).forEach(function (key) {
    batch.push(makeIndexDoc(doc, indexes[key]))
  })

  return batch
}


function makeIndexDoc (doc, index) {
  if (!Array.isArray(index)) { index = [ index ] }

  function reduceKey (acc, keypath) {
    var index_prop = access(doc.value, keypath)
    index_prop = esc(index_prop)
    acc.push(index_prop)
    return acc
  }

  var val = r.reduce(reduceKey, [], index)

  var index_doc = {
    key: 'ÿiÿ' + index.join(',') + 'ÿ' + val.join('ÿ') + 'ÿ' + doc.key + 'ÿ',
    value: doc.key,
    type: 'put'
  }
  console.log('INDEX DOC ->'.bgRed,colorize(JSON.stringify(index_doc.key,null,2)))
  return index_doc
}


function makeRange (query, level_opts) {
  // Avoid having to write queries with redundant array notation
  if (!Array.isArray(query.k)) { query.k = [ query.k ] }
  if (!Array.isArray(query.v)) { query.v = [ query.v ] }

  // Gathers values in query value field, generating gte - lte
  function reduceV (acc, item) {
    // Avoid having to write queries with redundant array notation
    if (!Array.isArray(item)) { item = [ item ] }
    // Push bottom of range (first array element) into gte
    acc.gte.push(esc(item[0]))
    // If it is not a range, use same value for lte, if it is use top of range
    acc.lte.push(esc(item.length > 1 ? item[1] : item[0]))

    return acc
  }

  var acc = r.reduce(reduceV, { gte: [], lte: [] }, query.v)

  // Eliminate null values
  var compact = r.filter(r.identity)
  var lte = compact(acc.lte)
  var gte = compact(acc.gte)

  var range = {
    // ÿiÿ identifies an index doc
    // esc(query.k.join(',')) makes an identifier for the index
    // gte/lte.join('ÿ') joins the ranges with the delimiter
    gte: 'ÿiÿ' + query.k.join(',') + 'ÿ' + gte.join('ÿ') + 'ÿ',
    lte: 'ÿiÿ' + query.k.join(',') + 'ÿ' + lte.join('ÿ') + 'ÿÿ'
  }
  console.log('RANGE LTE ->'.bgBlue,colorize(JSON.stringify(range.lte,null,2)))
  console.log('RANGE GTE ->'.bgBlue,colorize(JSON.stringify(range.gte,null,2)))
  return r.mixin(level_opts || {}, range)
}
