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

const addLogs = require('pino-http')({ logger: log })
const server = require('http').createServer((request, response) => {
  addLogs(request, response)
  const method = request.method
  if (method === 'GET') return get(request, response)
  if (method === 'POST') return post(request, response)
  response.statusCode = 405
  response.end()
})

const basicAuth = require('basic-auth')
const escapeHTML = require('escape-html')
const fs = require('fs')
const runParallel = require('run-parallel')

function get (request, response) {
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
    render(
      posts
        .filter(item => item.toread === 'yes')
        .sort((a, b) => a.time.localeCompare(b.time))
        .slice(0, 100)
    )
  })

  function internalError (error) {
    request.log.error(error)
    response.statusCode = 500
    response.end()
  }

  function render (posts) {
    response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    <meta charset=UTF-8>
    <meta name=viewport content=width=device-width,initial-scale=1>
    <title>${escapeHTML(TITLE)}</title>
    <style>
.posts li {
  margin: 1rem 0;
}

.posts .description {
  font-size: 125%;
}

.posts .description,
.posts a[href],
.posts date {
  display: block;
}
    </style>
  </head>
  <body>
    <script>
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    const target = event.target
    if (target.tagName !== 'BUTTON') return
    const postURL = target.dataset.url
    const endpoint = new URL('/')
    endpoint.searchParams.append('url', postURL)
    fetch(endpoint, { method: 'POST' })
      .then(response => {
        if (response.status === 200) {
          const li = target.parentNode
          li.parentNode.removeChild(li)
        } else {
          window.alert('error marking read')
        }
      })
  })
})
    </script>
    <header role=banner>
      <h1>${escapeHTML(TITLE)}</h1>
    </header>
    <main role=main>
      <ul class=posts>
        ${posts.map(item => `
        <li>
          <span class=description>${escapeHTML(item.description)}</span>
          <a href="${item.href}">${escapeHTML(item.href)}</a>
          <date>${escapeHTML(item.time)}</date>
          <button data-url="${item.href}">Mark Read</button>
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
  const { url } = parseURL(request.url, true).query
  if (!url) {
    response.statusCode = 400
    return response.end()
  }
  request.log.info({ url }, 'marking read')
  markRead(request, url, error => {
    if (error) {
      request.log.error(error)
      response.statusCode = 500
      return response.end()
    }
    response.end()
  })
}

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
      https.get(`https://api.pinboard.in/v1/posts/get?url=${url}&format=json&auth_token=${PINBOARD_TOKEN}`)
        .once('error', error => done(error))
        .once('response', response => {
          const chunks = []
          response
            .on('data', chunk => { chunks.push(chunk) })
            .once('error', error => done(error))
            .once('end', () => {
              const buffer = Buffer.concat(chunks)
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
      https.get(`https://api.pinboard.in/v1/posts/add?${querystring.stringify(query)}`)
        .once('error', error => done(error))
        .once('response', response => {
          const { statusCode } = response
          if (statusCode !== 200) {
            return done(new Error('pinboard responded ' + statusCode))
          }
          const chunks = []
          response
            .on('data', chunk => { chunks.push(chunk) })
            .once('error', error => done(error))
            .once('end', () => {
              const buffer = Buffer.concat(chunks)
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

const runSeries = require('run-series')

server.listen(process.env.PORT || 8080, function () {
  const port = this.address().port
  log.info({ port }, 'listening')
})

const { pipeline } = require('stream')
const schedule = require('node-schedule')
const EVERY_TEN_MINUTES = '*/10 * * * *'
schedule.scheduleJob(EVERY_TEN_MINUTES, fetchPosts)

function fetchPosts () {
  runParallel({
    // Read last updated date from disk.
    disk: done => {
      fs.readFile(UPDATED_FILE, 'utf8', (error, date) => {
        if (error) {
          if (error.code === 'ENOENT') return done(null, null)
          return done(error)
        }
        date = date.trim()
        log.info({ date }, 'disk')
        return done(null, date)
      })
    },
    // Fetch last updated date from Pinboard.
    api: done => {
      https.get(`https://api.pinboard.in/v1/posts/update?format=json&auth_token=${PINBOARD_TOKEN}`)
        .once('error', error => { done(error) })
        .once('response', response => {
          const chunks = []
          response
            .on('data', chunk => { chunks.push(chunk) })
            .once('error', error => done(error))
            .once('end', () => {
              const buffer = Buffer.concat(chunks)
              let parsed
              try {
                parsed = JSON.parse(buffer)
              } catch (error) {
                return done(error)
              }
              const date = parsed.update_time.trim()
              log.info({ date }, 'API')
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
        https.get(`https://api.pinboard.in/v1/posts/all?format=json&auth_token=${PINBOARD_TOKEN}`)
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
    })
  })
}

fetchPosts()
