/*

# level-librarian
level-librarian is a simple indexing tool for leveldb. You define indexes, and
then query by them.

```javascript
/**/

// Why do these docs look wierd? They are also the tests.
'use strict';

var test = require('tape')
var level = require('level')
var llibrarian = require('../index.js')
var pull = require('pull-stream')
var pl = require('pull-level')
var rimraf = require('rimraf')

rimraf.sync('./test.db')
var db = level('./test.db', { valueEncoding: 'json' })

/*
```
# High level
## .write(db, indexes[, opts, done])
Returns a pull-stream sink that writes a stream of documents to the db, adding
index documents as well.
- `db`: A leveldb.
- `indexes`: An array of index keypaths.

#### Indexes array
level-librarian consumes index definitions as an object or array of keypaths,
or keypath arrays. Keypaths are resolved by safe-access, using the `value`
property of the document as a base. To create multi-level indexes, use an
array.
```javascript
/**/
var example_document = {
  key: 'w32fwfw33',
  value: {
    timestamp: '29304857',
    content: {
      name: 'richard',
      score: 4
    }
  }
}

var indexes = [
  // The values at these keypaths are concatenated to create the keys of
  // index documents. By default, level-librarian will add the key of the main
  // document to the end of the index key to ensure uniqueness.
  'content.score',
  // Key generated: 'ÿcontent.scoreÿ4ÿw32fwfw33'

  // You can create secondary indexes by supplying an array
  ['content.score', 'timestamp'],
  // Key generated: 'ÿcontent.score,timestampÿ4ÿ29304857ÿw32fwfw33'

  // You can pass an options object in the array. Right now, the only option
  // is `latest`. It will only index the latest document with a given value at the keypath.
  ['content.score', '$latest']
  // Key generated: 'ÿcontent.scoreÿ4ÿ'
  // (Any subsequent documents with a content.score of 4 will overwrite this)

]


test('\n\n.write(db, indexes)', function(t) {
  var docs = [{
    key: 'w32fwfw33',
    value: {
      timestamp: '29304857',
      content: {
        name: 'richard',
        score: 4
      }
    }
  }, {
    key: '39djdjj31',
    value: {
      timestamp: '29304932',
      content: {
        name: 'mary',
        score: 5
      }
    }
  }, {
    key: 'dlnqoq003',
    value: {
      timestamp: '29304990',
      content: {
        name: 'jeff',
        score: 4
      }
    }
  }]

  pull(
    pull.values(docs),
    llibrarian.write(db, indexes, null, function() { // <-- Here's how you do it
      checkDB()
    })
  )

  function checkDB () {
    pull(
      pl.read(db),
      pull.collect(function(err, arr) {
        console.log(JSON.stringify(arr))
        t.deepEqual(arr, dbContents, '.write(db, indexes)')
        t.end()
      })
    )
  }

  var dbContents = [{
    key: '39djdjj31',
    value: {'timestamp':'29304932','content':{'name':'mary','score':5}}
  }, {
    key: 'dlnqoq003',
    value: {'timestamp':'29304990','content':{'name':'jeff','score':4}}
  }, {
    key: 'w32fwfw33',
    value: {'timestamp':'29304857','content':{'name':'richard','score':4}}
  }, {
    key: 'ÿcontent.score,$latestÿ4ÿÿ',
    value: 'dlnqoq003'
  }, {
    key: 'ÿcontent.score,$latestÿ5ÿÿ',
    value: '39djdjj31'
  }, {
    key: 'ÿcontent.score,timestampÿ4ÿ29304857ÿw32fwfw33ÿ',
    value: 'w32fwfw33'
  }, {
    key: 'ÿcontent.score,timestampÿ4ÿ29304990ÿdlnqoq003ÿ',
    value: 'dlnqoq003'
  }, {
    key: 'ÿcontent.score,timestampÿ5ÿ29304932ÿ39djdjj31ÿ',
    value: '39djdjj31'
  }, {
    key: 'ÿcontent.scoreÿ4ÿdlnqoq003ÿ',
    value: 'dlnqoq003'
  }, {
    key: 'ÿcontent.scoreÿ4ÿw32fwfw33ÿ',
    value: 'w32fwfw33'
  }, {
    key: 'ÿcontent.scoreÿ5ÿ39djdjj31ÿ',
    value: '39djdjj31'
  }]
})
/*
```
## .read (db, query[, options])
Returns a pull-stream source of documents matching the query.
- `db`: A leveldb.
- `query`: A query in the `{ k: ..., v: ... }` format.
- `options`: same as the options passed into pull-level, except for the fact
that `gt`, `lt`, `gte`, `lte` will not work, as they are generated by
level-librarian.

#### Query format
level-librarian expects queries as objects with `k` and `v` properties.
- `k` is one of the index definitions that you supplied when writing.
- `v` is an array of value(s) to search for. If you supply an array with 2
values, level-librarian will find the documents in that range. If you leave an
index off, level-librarian will find documents with any value at that
position.
```javascript
/**/
test('\n\n.read(db, query[, options])', function(t) {
  t.plan(6)

  // This should retrieve all documents with a score of 4
  var queryA = {
    k: ['content.score'],
    v: '4'
  }

  var resultA = [{
    key: 'dlnqoq003',
    value: {'timestamp':'29304990','content':{'name':'jeff','score':4}}
  }, {
    key: 'w32fwfw33',
    value: {'timestamp':'29304857','content':{'name':'richard','score':4}}
  }]

  pull(
    llibrarian.read(db, queryA), // <-- Here's how you do it
    pull.collect(function(err, arr) {
      console.log('A', JSON.stringify(arr))
      t.deepEqual(arr, resultA, 'A')
    })
  )

  // Reduce reptition of test code
  function check (query, result, string) {
    pull(
      llibrarian.read(db, query),
      pull.collect(function(err, arr) {
        console.log(string, JSON.stringify(arr))
        t.deepEqual(arr, result, string)
      })
    )
  }

  // This should retrieve the latest documents with a score of 4 or 5
  var queryB = {
    k: ['content.score', '$latest'],
    v: [['4', '5']] // content.score value range
  }

  var resultB = [{
    key: 'dlnqoq003',
    value: {'timestamp':'29304990','content':{'name':'jeff','score':4}}
  }, {
    key: '39djdjj31',
    value: {'timestamp':'29304932','content':{'name':'mary','score':5}}
  }]

  check(queryB, resultB, 'B')

  // This should retrieve all documents with a content.score of 4 with a
  // timestamp between '29304857' and '29304923'
  var queryC = {
    k: ['content.score', 'timestamp'],
    v: ['4', ['29304857', '29304923']] // timestamp value range
  }

  var resultC = [{
    key: 'w32fwfw33',
    value: {'timestamp':'29304857','content':{'name':'richard','score':4}}
  }]

  check(queryC, resultC, 'C')


  // This should retrieve all documents with a score of 4 (just like the first
  // example, since we left the timestamp off)
  var queryD = {
    k: ['content.score', 'timestamp'],
    v: '4', // Timestamp value left off
  }

  var resultD = [{
    key: 'w32fwfw33',
    value: {'timestamp':'29304857','content':{'name':'richard','score':4}}
  }, {
    key: 'dlnqoq003',
    value: {'timestamp':'29304990','content':{'name':'jeff','score':4}}
  }]

  check(queryD, resultD, 'D')


  // This should retrieve all documents with a score of 4 and a timestamp >
  // 29304950
  var queryE = {
    k: ['content.score', 'timestamp'],
    v: ['4', ['29304950', null]]
  }

  var resultE = [{
    key: 'dlnqoq003',
    value: {'timestamp':'29304990','content':{'name':'jeff','score':4}}
  }]

  check(queryE, resultE, 'E')


  // This should retrieve all documents with a score of 4 and a timestamp <
  // 29304950
  var queryF = {
    k: ['content.score', 'timestamp'],
    v: ['4', [null, '29304950']]
  }

  var resultF = [{
    key: 'w32fwfw33',
    value: {'timestamp':'29304857','content':{'name':'richard','score':4}}
  }]

  check(queryF, resultF, 'F')
})

/*
```
# Through streams
level-librarian provides through streams, which are also used internally in
`read` and `write`.

## .addIndexDocs(indexes)
Add index documents to a stream of primary documents.
```javascript
/**/
test('\n\n.addIndexDocs(indexes)', function (t) {
  var doc = {
    key: 'w32fwfw33',
    value: {
      timestamp: '29304857',
      content: {
        name: 'richard',
        score: 4
      }
    }
  }

  var expected = [
  {
    key: 'ÿcontent.scoreÿ4ÿw32fwfw33ÿ',
    type: 'put',
    value: 'w32fwfw33'
  },
  {
    key: 'ÿcontent.score,timestampÿ4ÿ29304857ÿw32fwfw33ÿ',
    type: 'put',
    value: 'w32fwfw33'
  },
  {
    key: 'ÿcontent.score,$latestÿ4ÿÿ',
    type: 'put',
    value: 'w32fwfw33'
  },
  {
    key: 'w32fwfw33',
    type: 'put',
    value: {
      content: {
        name: 'richard',
        score: 4
      },
      timestamp: '29304857'
    }
  }]

  pull(
    pull.values([doc]),
    llibrarian.addIndexDocs(indexes), // <-- Here's how you do it
    pull.collect(function(err, arr) {
      console.log(JSON.stringify(arr))
      t.deepEqual(arr, expected)
      t.end()
    })
  )

})
/*
```
## .resolveIndexDocs(db)
Resolve index documents to primary documents.
```javascript
/**/
test('\n\n.resolveIndexDocs(db)', function (t) {
  var docs = [{
    key: 'ÿcontent.scoreÿ4ÿdlnqoq003ÿ',
    value: 'dlnqoq003'
  }, {
    key: 'ÿcontent.scoreÿ4ÿw32fwfw33ÿ',
    value: 'w32fwfw33'
  }, {
    key: 'ÿcontent.scoreÿ5ÿ39djdjj31ÿ',
    value: '39djdjj31'
  }]

  var expected = [{
    key: 'dlnqoq003',
    value: {
      timestamp: '29304990',
      content: {
        name: 'jeff',
        score: 4
      }
    }
  }, {
    key: 'w32fwfw33',
    value: {
      timestamp: '29304857',
      content: {
        name: 'richard',
        score: 4
      }
    }
  }, {
    key: '39djdjj31',
    value: {
      timestamp: '29304932',
      content: {
        name: 'mary',
        score: 5
      }
    }
  }]

  pull(
    pull.values(docs),
    llibrarian.resolveIndexDocs(db), // <-- Here's how you do it
    pull.collect(function(err, arr) {
      console.log(JSON.stringify(arr))
      t.deepEqual(arr, expected)
      t.end()
    })
  )
})
/*
```
/**/
