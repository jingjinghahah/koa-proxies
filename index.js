/**
 * Dependencies
 */
const { URL } = require('url')
const HttpProxy = require('http-proxy')
const pathMatch = require('path-match')

/**
 * Constants
 */

const proxy = HttpProxy.createProxyServer()
const route = pathMatch({
  // path-to-regexp options
  sensitive: false,
  strict: false,
  end: false
})

let eventRegistered = false

/**
 * Koa Http Proxy Middleware
 */
module.exports = (path, options) => (ctx, next) => {
  // create a match function
  const match = route(path)
  const params = match(ctx.path)
  if (!params) return next()

  let opts
  if (typeof options === 'function') {
    opts = options.call(options, params, ctx)
  } else {
    opts = Object.assign({}, options)
  }
  // object-rest-spread is still in stage-3
  // https://github.com/tc39/proposal-object-rest-spread
  const { logs, rewrite, events } = opts

  const httpProxyOpts = Object.keys(opts)
    .filter(n => ['logs', 'rewrite', 'events'].indexOf(n) < 0)
    .reduce((prev, cur) => {
      prev[cur] = opts[cur]
      return prev
    }, {})

  return new Promise((resolve, reject) => {
    ctx.req.oldPath = ctx.req.url

    if (typeof rewrite === 'function') {
      ctx.req.url = rewrite(ctx.req.url, ctx)
    }

    if (logs) {
      typeof logs === 'function' ? logs(ctx, opts.target) : logger(ctx, opts.target)
    }
    if (events && typeof events === 'object' && !eventRegistered) {
      Object.entries(events).forEach(([event, handler]) => {
        proxy.on(event, handler)
      })
      eventRegistered = true
    }

    // Let the promise be solved correctly after the proxy.web.
    // The solution comes from https://github.com/nodejitsu/node-http-proxy/issues/951#issuecomment-179904134
    ctx.res.on('close', () => {
      resolve()
    })

    ctx.res.on('finish', () => {
      resolve()
    })

    ctx.res.on('timeout', (a) => {
      ctx.res.statusCode = 504;
      // 连接超时，超时时间为 a?.timeout
      ctx.res.end(`Socket timeout, timeout: ${a?.timeout}ms`);
      resolve()
    })
  
    proxy.web(ctx.req, ctx.res, httpProxyOpts, (e, res) => {
      console.log('proxy error:', e, e.code, res.statusCode);
      const status = {
        ECONNREFUSED: 503,
        ETIMEOUT: 504
      }[e.code]
      ctx.status = res.statusCode || status || 502;
      ctx.body = {
        success: false,
        code: e.code,
        message: e.message,
      };
      resolve();
    })
  })
}

module.exports.proxy = proxy

function logger (ctx, target) {
  console.log('%s - %s %s proxy to -> %s', new Date().toISOString(), ctx.req.method, ctx.req.oldPath, new URL(ctx.req.url, target))
}
