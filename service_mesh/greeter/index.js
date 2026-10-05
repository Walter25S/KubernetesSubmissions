// The greeter service of exercise 5.3: answers a GET with a greeting. Two versions of it run at the same time
// and the service mesh splits the traffic between them; VERSION tells which one answered.
const http = require('http')

const port = process.env.PORT || 3000
const version = process.env.VERSION || 'v1'
const greeting = process.env.GREETING || 'hello'

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/greet')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`${greeting} from greeter ${version}\n`)
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found\n')
})

server.listen(port, () => {
  console.log(`greeter ${version} listening in port ${port}`)
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
