// Controller of the DummySite resource (exercise 5.1).
//
// A DummySite has a spec.website_url. For each one the controller downloads the page and creates what is needed
// to serve a copy of it inside the cluster, all of it owned by the DummySite (so deleting it deletes everything):
//
//   DummySite --> ConfigMap "<name>-html"  (index.html: the copy of the page)
//             --> Deployment "<name>"       (nginx that serves the ConfigMap)
//             --> Service "<name>"          (port 80)
//
// It uses the REST API of Kubernetes directly (no client library): list + watch of the DummySites, and
// "server-side apply" to create or update the other objects, so every reconciliation is idempotent.
const fs = require('fs')
const { createHash } = require('crypto')

const GROUP = 'stable.dwk'
const VERSION = 'v1'
const PLURAL = 'dummysites'
const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'
const API = process.env.API_URL || `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`
const NGINX_IMAGE = process.env.NGINX_IMAGE || 'nginx:1.27-alpine'
const FIELD_MANAGER = 'dummysite-controller'
// a ConfigMap can not be bigger than 1 MiB
const MAX_BYTES = 900 * 1024
const RETRY_MS = 30 * 1000

// the token of a ServiceAccount is rotated, so it is read every time
const token = () => process.env.TOKEN || fs.readFileSync(`${SA_DIR}/token`, 'utf8').trim()

const log = (...args) => console.log(new Date().toISOString(), ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const request = async (method, path, { body, contentType = 'application/json' } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json', 'Content-Type': contentType },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return res
}

const call = async (method, path, options) => {
  const res = await request(method, path, options)
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// create or update (server-side apply: a JSON document is valid YAML)
const apply = (path, object) =>
  call('PATCH', `${path}?fieldManager=${FIELD_MANAGER}&force=true`, { body: object, contentType: 'application/apply-patch+yaml' })

const setStatus = (site, status) =>
  call('PATCH', `/apis/${GROUP}/${VERSION}/namespaces/${site.metadata.namespace}/${PLURAL}/${site.metadata.name}/status`, {
    body: { status: { observedGeneration: site.metadata.generation, ...status } },
    contentType: 'application/merge-patch+json'
  })

// The copy is the HTML of the page. A <base> tag makes the relative links, the styles and the images of the
// page load from the original site, so the copy looks like it even though only the HTML is stored.
const withBase = (html, url) => {
  if (/<base[\s>]/i.test(html)) return html
  const base = `<base href="${url}">`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${base}`) : base + html
}

const download = async (url) => {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'dummysite-controller/1.0 (course exercise)' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  const html = withBase(await res.text(), res.url || url)
  const bytes = Buffer.byteLength(html)
  if (bytes > MAX_BYTES) throw new Error(`the page is ${bytes} bytes, more than the ${MAX_BYTES} that fit in a ConfigMap`)
  return { html, bytes }
}

const reconcile = async (site) => {
  const { name, namespace, uid } = site.metadata
  const url = site.spec && site.spec.website_url
  if (!url) {
    await setStatus(site, { phase: 'Failed', message: 'spec.website_url is required' })
    return
  }
  try {
    new URL(url)
  } catch {
    await setStatus(site, { phase: 'Failed', message: `"${url}" is not a valid URL` })
    return
  }

  log(`DummySite ${namespace}/${name}: downloading ${url}`)
  const { html, bytes } = await download(url)

  const sha256 = createHash('sha256').update(html).digest('hex')
  const owner = [{ apiVersion: `${GROUP}/${VERSION}`, kind: 'DummySite', name, uid, controller: true }]
  const labels = { app: name, 'app.kubernetes.io/managed-by': FIELD_MANAGER }
  const meta = (extra = {}) => ({ name, namespace, labels, ownerReferences: owner, ...extra })

  await apply(`/api/v1/namespaces/${namespace}/configmaps/${name}-html`, {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: meta({ name: `${name}-html` }),
    data: { 'index.html': html }
  })

  await apply(`/apis/apps/v1/namespaces/${namespace}/deployments/${name}`, {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: meta(),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        // the kubelet takes up to a minute to refresh a mounted ConfigMap: a new hash of the page restarts the pod,
        // so a change of the URL (or of the page) is served at once
        metadata: { labels: { app: name }, annotations: { 'dummysite.stable.dwk/content-sha256': sha256 } },
        spec: {
          containers: [
            {
              name: 'nginx',
              image: NGINX_IMAGE,
              ports: [{ containerPort: 80 }],
              volumeMounts: [{ name: 'html', mountPath: '/usr/share/nginx/html', readOnly: true }],
              readinessProbe: { httpGet: { path: '/', port: 80 }, periodSeconds: 5 },
              resources: { requests: { cpu: '10m', memory: '16Mi' }, limits: { cpu: '100m', memory: '64Mi' } }
            }
          ],
          volumes: [{ name: 'html', configMap: { name: `${name}-html` } }]
        }
      }
    }
  })

  await apply(`/api/v1/namespaces/${namespace}/services/${name}`, {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: meta(),
    spec: { selector: { app: name }, ports: [{ port: 80, targetPort: 80 }] }
  })

  await setStatus(site, { phase: 'Ready', message: `serving a copy of ${url}`, bytes, fetchedAt: new Date().toISOString() })
  log(`DummySite ${namespace}/${name}: ready (${bytes} bytes), Service ${name}`)
}

// one pending retry per DummySite
const retries = new Map()
const keyOf = (site) => `${site.metadata.namespace}/${site.metadata.name}`

// reconcile, and if it fails say so in the status and try again later
const handle = async (site) => {
  const key = keyOf(site)
  clearTimeout(retries.get(key))
  retries.delete(key)
  try {
    await reconcile(site)
  } catch (error) {
    log(`DummySite ${key}: ${error.message}`)
    await setStatus(site, { phase: 'Failed', message: error.message.slice(0, 300) }).catch(() => {})
    retries.set(
      key,
      setTimeout(async () => {
        retries.delete(key)
        try {
          const current = await call('GET', `/apis/${GROUP}/${VERSION}/namespaces/${site.metadata.namespace}/${PLURAL}/${site.metadata.name}`)
          await handle(current)
        } catch {
          // it was deleted meanwhile
        }
      }, RETRY_MS)
    )
  }
}

// What the controller wrote in the status makes the DummySite change, and that event comes back to it. A
// DummySite whose status was written for its current spec (ready or failed: the retry is already scheduled)
// has nothing new to do.
const upToDate = (site) => site.status && site.status.observedGeneration === site.metadata.generation

// The events of the DummySites, from a resourceVersion, until the connection ends
const watch = async (resourceVersion) => {
  const path = `/apis/${GROUP}/${VERSION}/${PLURAL}?watch=true&allowWatchBookmarks=true&timeoutSeconds=300&resourceVersion=${resourceVersion}`
  const res = await request('GET', path)
  if (!res.ok) throw new Error(`watch -> ${res.status}`)
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop()
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line)
      if (event.type === 'ERROR') throw new Error(`watch error: ${event.object.message}`)
      if (event.type === 'BOOKMARK') continue
      const site = event.object
      if (event.type === 'DELETED') {
        clearTimeout(retries.get(keyOf(site)))
        retries.delete(keyOf(site))
        log(`DummySite ${keyOf(site)} deleted: its ConfigMap, Deployment and Service are removed by Kubernetes`)
      } else if (!upToDate(site)) {
        await handle(site)
      }
    }
  }
}

const main = async () => {
  log(`DummySite controller, API ${API}`)
  for (;;) {
    try {
      // list (every object is reconciled, so what was deleted by hand comes back) and then watch from there
      const list = await call('GET', `/apis/${GROUP}/${VERSION}/${PLURAL}`)
      for (const site of list.items) await handle(site)
      await watch(list.metadata.resourceVersion)
    } catch (error) {
      log(`restarting the watch: ${error.message}`)
      await sleep(3000)
    }
  }
}

process.on('SIGTERM', () => process.exit(0))
main()
