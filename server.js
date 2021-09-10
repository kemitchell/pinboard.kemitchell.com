const log = require('pino')()

process.on('SIGINT', trap)
process.on('SIGQUIT', trap)
process.on('SIGTERM', trap)
process.on('uncaughtException', exception => {
  log.error(exception, 'uncaughtException')
  close()
})

function trap (signal) {
  log.info({ signal }, 'signal')
  close()
}

function close () {
  log.info('closing')
  server.close(() => {
    log.info('closed')
    process.exit(0)
  })
}

const TITLE = process.env.TITLE || 'Reverse Pinboard'

const PINBOARD_TOKEN = process.env.PINBOARD_TOKEN
if (!PINBOARD_TOKEN) {
  log.error('no PINBOARD_TOKEN in env')
  process.exit(1)
}

const DIRECTORY = process.env.DIRECTORY
if (!DIRECTORY) {
  log.error('no DIRECTORY in env')
  process.exit(1)
}

const path = require('path')
const POSTS_FILE = path.join(DIRECTORY, 'posts.json')
const UPDATED_FILE = path.join(DIRECTORY, 'updated')

const USERNAME = process.env.USERNAME
if (!USERNAME) {
  log.error('no USERNAME in env')
  process.exit(1)
}

const PASSWORD = process.env.PASSWORD
if (!PASSWORD) {
  log.error('no PASSWORD in env')
  process.exit(1)
}

const currentYear = new Date().getFullYear()
const years = []
for (let year = 2014; year <= currentYear; year++) {
  years.push(year)
}

const addLogs = require('pino-http')({ logger: log })
const server = require('http').createServer((request, response) => {
  addLogs(request, response)
  const method = request.method
  if (method === 'GET') {
    if (request.url === '/client.js') {
      response.setHeader('Content-Type', 'application/json')
      return fs.createReadStream('client.js').pipe(response)
    } else if (request.url === '/styles.css') {
      response.setHeader('Content-Type', 'text/css')
      return fs.createReadStream('styles.css').pipe(response)
    }
    return get(request, response)
  }
  if (method === 'POST') return post(request, response)
  response.statusCode = 405
  response.end()
})

const basicAuth = require('basic-auth')
const escapeHTML = require('escape-html')
const fs = require('fs')
const runParallel = require('run-parallel')

const videoDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'nebula.app', 'wondrium.com']

const filters = {
  '/videos': post => (
    videoDomains.some(domain => post.href.includes(domain)) ||
    post.tags.includes('video')
  ),
  '/wiki': post => post.href.includes('wikipedia.org'),
  '/github': post => post.href.includes('github.com'),
  '/twitter': post => post.href.includes('twitter.com'),
  '/readontablet': post => post.tags.includes('readontablet'),
  '/printme': post => post.tags.includes('printme'),
  '/ken': post => post.href.includes('adamsdrafting.com')
}

function get (request, response) {
  const { limit = 100 } = parseURL(request.url, true).query
  const auth = basicAuth(request)
  if (!auth || auth.name !== USERNAME || auth.pass !== PASSWORD) {
    response.statusCode = 401
    response.setHeader('WWW-Authenticate', 'Basic realm=todo')
    return response.end()
  }
  fs.readFile(POSTS_FILE, (error, json) => {
    if (error) return internalError(error)
    let posts
    try {
      posts = JSON.parse(json)
    } catch (error) {
      return internalError(error)
    }
    const unread = posts
      .filter(post => post.toread === 'yes')
      .sort((a, b) => a.time.localeCompare(b.time))
    let filtered = unread
    const filter = filters[request.url]
    if (filter) {
      filtered = unread.filter(filter)
    } else if (/^\/\d\d\d\d$/.test(request.url)) {
      const year = request.url.slice(1)
      filtered = unread.filter(post => post.time.startsWith(year))
    }
    const count = filtered.length
    const slice = filtered.slice(0, limit)
    render(slice, count, filtered, posts)
  })

  function internalError (error) {
    request.log.error(error)
    response.statusCode = 500
    response.end()
  }

  function render (posts, count, allMatching, allPosts) {
    response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    <meta charset=UTF-8>
    <meta name=viewport content=width=device-width,initial-scale=1>
    <title>${escapeHTML(TITLE)}</title>
    <link rel=stylesheet href=styles.css>
  </head>
  <body>
    <script src=/client.js></script>
    <header role=banner>
      <h1>${escapeHTML(TITLE)}</h1>
    </header>
    <nav role=navigation>
      <a href=/>all</a>
      ${
        Object.keys(filters)
          .filter(path => allPosts.some(post => filters[path](post) && post.toread === 'yes'))
          .map(path => `<a href="${path}">${path}</a>`)
          .join(' ')
      }
    </nav>
    <nav role=navigation>
      ${
        years
          .filter(year => allMatching.some(post => post.time.startsWith(year)))
          .map(year => `<a href=/${year}>${year}</a>`).join(' ')
      }
    </nav>
    <main role=main>
      <form method=post action=/refresh>
        <button type=submit>Refresh</button>
      </form>
      <p>Total: ${count}, Showing: ${posts.length}</p>
      <ul class=posts>
        ${posts.map(item => `
        <li>
          <span class=description>${escapeHTML(item.description)}</span>
          <a href="${item.href}">${escapeHTML(item.href)}</a>
          <date>${escapeHTML(item.time)}</date>
          <button class=markRead data-url="${item.href}">Mark Read</button>
          <button class=delete data-url="${item.href}">Delete</button>
        </li>
        `).join('')}
      </ul>
    </main>
  </body>
</html>
    `.trim())
  }
}

const https = require('https')
const querystring = require('querystring')
const parseURL = require('url-parse')

function post (request, response) {
  const auth = basicAuth(request)
  if (!auth || auth.name !== USERNAME || auth.pass !== PASSWORD) {
    response.statusCode = 401
    response.setHeader('WWW-Authenticate', 'Basic realm=todo')
    return response.end()
  }
  if (request.url === '/refresh') {
    return fetchPosts(() => {
      response.statusCode = 303
      response.setHeader('Location', request.url)
      response.end()
    })
  }
  const { url, action } = parseURL(request.url, true).query
  if (!url) {
    response.statusCode = 400
    return response.end()
  }
  if (action === 'read') {
    request.log.info({ url }, 'marking read')
    markRead(request, url, error => {
      if (error) {
        request.log.error(error)
        response.statusCode = 500
        return response.end()
      }
      response.end()
    })
  } else if (action === 'delete') {
    request.log.info({ url }, 'deleting')
    deletePost(request, url, error => {
      if (error) {
        request.log.error(error)
        response.statusCode = 500
        return response.end()
      }
      response.end()
    })
  } else {
    response.statusCode = 400
    response.end()
  }
}

const concat = require('simple-concat')
const PINBOARD_API = 'https://api.pinboard.in/v1'

function markRead (request, url, callback) {
  const postProperties = {
    href: 'url',
    description: 'description',
    extended: 'extended',
    tags: 'tags',
    time: 'dt',
    shared: 'shared'
  }
  let oldPost
  runSeries([
    // Fetch existing post data.
    done => {
      const query = {
        url,
        format: 'json',
        auth_token: PINBOARD_TOKEN
      }
      https.get(`${PINBOARD_API}/posts/get?${querystring.stringify(query)}`)
        .once('error', error => done(error))
        .once('response', response => {
          concat(response, (error, buffer) => {
            if (error) return done(error)
            let parsed
            try {
              parsed = JSON.parse(buffer)
            } catch (error) {
              return done(error)
            }
            request.log.info(parsed, 'parsed')
            if (!Array.isArray(parsed.posts)) {
              return done(new Error('no posts array'))
            }
            const length = parsed.posts.length
            if (length !== 1) {
              return done(new Error(`${length} posts`))
            }
            oldPost = parsed.posts[0]
            done()
          })
        })
    },
    // Overwrite the post.
    done => {
      const query = {
        format: 'json',
        auth_token: PINBOARD_TOKEN,
        toread: 'no'
      }
      for (const [from, to] of Object.entries(postProperties)) {
        query[to] = oldPost[from]
      }
      request.log.info(query, 'query')
      https.get(`${PINBOARD_API}/posts/add?${querystring.stringify(query)}`)
        .once('error', error => done(error))
        .once('response', response => {
          const { statusCode } = response
          if (statusCode !== 200) {
            return done(new Error('pinboard responded ' + statusCode))
          }
          concat(response, (error, buffer) => {
            if (error) return done(error)
            let parsed
            try {
              parsed = JSON.parse(buffer)
            } catch (error) {
              return done(error)
            }
            request.log.info(parsed, 'pinboard response')
            done()
          })
        })
    }
  ], callback)
}

function deletePost (request, url, callback) {
  const query = {
    format: 'json',
    auth_token: PINBOARD_TOKEN,
    url
  }
  request.log.info(query, 'delete')
  https.get(`${PINBOARD_API}/posts/delete?${querystring.stringify(query)}`)
    .once('error', error => callback(error))
    .once('response', response => {
      const { statusCode } = response
      if (statusCode !== 200) {
        return callback(new Error('pinboard responded ' + statusCode))
      }
      concat(response, (error, buffer) => {
        if (error) return callback(error)
        let parsed
        try {
          parsed = JSON.parse(buffer)
        } catch (error) {
          return callback(error)
        }
        request.log.info(parsed, 'pinboard response')
        callback()
      })
    })
}

const runSeries = require('run-series')

fetchPosts()

server.listen(process.env.PORT || 8080, function () {
  const port = this.address().port
  log.info({ port }, 'listening')
})

const { pipeline } = require('stream')
const schedule = require('node-schedule')
const EVERY_TEN_MINUTES = '*/10 * * * *'
schedule.scheduleJob(EVERY_TEN_MINUTES, fetchPosts)

function fetchPosts (callback) {
  runParallel({
    // Read last updated date from disk.
    disk: done => {
      fs.readFile(UPDATED_FILE, 'utf8', (error, date) => {
        if (error) {
          if (error.code === 'ENOENT') return done(null, null)
          return done(error)
        }
        date = date.trim()
        log.info({ date }, 'updated from disk')
        return done(null, date)
      })
    },
    // Fetch last updated date from Pinboard.
    api: done => {
      const query = {
        format: 'json',
        auth_token: PINBOARD_TOKEN
      }
      https.get(`${PINBOARD_API}/posts/update?${querystring.stringify(query)}`)
        .once('error', error => { done(error) })
        .once('response', response => {
          concat(response, (error, buffer) => {
            if (error) return done(error)
            let parsed
            try {
              parsed = JSON.parse(buffer)
            } catch (error) {
              return done(error)
            }
            const date = parsed.update_time.trim()
            log.info({ date }, 'updated from API')
            done(null, date)
          })
        })
    }
  }, (error, { disk, api }) => {
    if (error) return log.error(error)
    if (disk === api) return
    runSeries([
      done => {
        log.info('fetching posts')
        const query = {
          format: 'json',
          auth_token: PINBOARD_TOKEN
        }
        https.get(`${PINBOARD_API}/posts/all?${querystring.stringify(query)}`)
          .once('error', error => done(error))
          .once('response', response => {
            log.info('writing to disk')
            pipeline(
              response,
              fs.createWriteStream(POSTS_FILE),
              error => {
                if (error) return done(error)
                log.info('wrote to disk')
                done()
              }
            )
          })
      },
      done => fs.writeFile(UPDATED_FILE, api, done)
    ], error => {
      if (error) return log.error(error)
      if (callback) callback()
    })
  })
}
