# broadcaster

Service that sends the messages about the todos to an external chat service (exercise 4.6). When a
todo is created or updated, the backend publishes a message to **NATS**; the broadcaster is subscribed
to it and forwards it:

```
todo_backend --publish--> NATS (subject "todos") --queue group "broadcaster"--> broadcaster --POST--> chat service
```

It is a separate service so that the backend does not need to know who is interested in the changes, and
so that sending messages can be scaled, or fail, without affecting the application.

## Messages

| When | Message sent to the chat service |
| ---- | -------------------------------- |
| A todo is created | `A todo was created: "Buy milk"` |
| A todo is marked as done | `A todo was marked as done: "Buy milk"` |
| A todo is marked as not done | `A todo was marked as not done: "Buy milk"` |

The payload depends on `MESSAGE_FORMAT`:

| `MESSAGE_FORMAT` | Payload |
| ---------------- | ------- |
| `generic` (the one of the exercise) | `{"user": "bot", "message": "A todo was created: \"Buy milk\""}` |
| `discord` | `{"username": "bot", "content": "...", "allowed_mentions": {"parse": []}}` (so a todo with `@everyone` does not ping the channel) |
| `slack` | `{"text": "..."}` |

## Scaling without duplicated messages

The broadcaster can run with any number of replicas (it was tested with **6**). All the replicas subscribe
to the subject with the **same queue group** (`NATS_QUEUE`): NATS gives each message of a queue group to only
**one** of its members, so a message is sent to the chat service once, however many replicas there are.
A plain subscription (no queue group) would give the message to all of them and the chat service would get
it 6 times.

Test with 6 replicas: 30 todos created at the same time and 10 of them marked as done:

```
messages of this test : 40 (expected 40)
  "created"           : 30 (expected 30), duplicated: 0
  "marked as done"    : 10 (expected 10), duplicated: 0
```

and the 40 messages were shared between the replicas (8, 5, 7, 4, 6 and 10 each).

### What happens when something fails

Core NATS delivers *at most once*, and the broadcaster does not retry. So **a message can be lost, but it
is never sent twice** (which is what the exercise accepts):

- **The chat service is down**: the broadcaster logs `Could not send ...` and goes on. The message is lost.
- **NATS is down**: the backend still saves the todo (publishing never makes a request fail and does not
  wait); the broadcaster becomes *not ready* (`0/1`) and reconnects by itself; the messages of that
  period are lost, and the ones after it are delivered once.
- **A replica is stopped** (rollout, scale down): on `SIGTERM` it finishes the messages it already
  received (`drain`) before exiting.

If every part works, every message is delivered. (JetStream, the persistent mode of NATS, would give
*at least once* delivery, but then duplicates are possible and it would need de-duplication.)

## Configuration

Nothing is hard coded. The values are in the ConfigMap [manifests/configmap.yaml](manifests/configmap.yaml)
and the URL of the chat service is a Secret.

| Variable | Meaning | Source |
| -------- | ------- | ------ |
| `PORT` | Port of the probes | ConfigMap |
| `NATS_URL` | The NATS server | ConfigMap (`nats://my-nats.nats.svc.cluster.local:4222`) |
| `NATS_SUBJECT` | The subject the backend publishes to | ConfigMap (`todos`) |
| `NATS_QUEUE` | The queue group shared by all the replicas | ConfigMap (`broadcaster`) |
| `MESSAGE_FORMAT` | `generic`, `discord` or `slack` | ConfigMap (`generic`) |
| `REQUEST_TIMEOUT_MS` | Timeout of the request to the chat service | ConfigMap |
| `WEBHOOK_URL` | Where the messages are sent | Secret `broadcaster-webhook`, key `WEBHOOK_URL` |

The webhook URL of Discord or Slack contains a token, so it is **not** in the repository: the Secret is
created in the cluster ([secret.example.yaml](secret.example.yaml) only shows its shape).

Probes: **readiness** `/healthz` (connected to NATS and subscribed), **liveness** `/livez`.

## Install NATS and deploy

NATS is installed with Helm ([nats-values.yaml](nats-values.yaml): a small server, no JetStream):

```bash
helm repo add nats https://nats-io.github.io/k8s/helm/charts/
helm repo update
helm upgrade --install my-nats nats/nats --namespace nats --create-namespace --values nats-values.yaml
```

The Secret with the URL of the chat service, then the whole project with the local overlay, which includes
the broadcaster and tells the backend where NATS is
([../project/k3d](../project/k3d/kustomization.yaml)):

```bash
# a real Discord webhook (set MESSAGE_FORMAT: discord in the ConfigMap):
kubectl create secret generic broadcaster-webhook -n project \
  --from-literal=WEBHOOK_URL='https://discord.com/api/webhooks/<id>/<token>'
kubectl apply -k ../project/k3d
kubectl scale deployment/broadcaster-dep -n project --replicas=6      # try it with 6 replicas
```

The messaging is **not** part of the GKE environments: `project/gke` and `project/production` do not include
the broadcaster and the backend has no `NATS_URL` there, so it does not try to publish (it logs
`Messaging is off`). The nodes of the GKE cluster have no room for NATS.

### Without a Discord, Telegram or Slack account

[test-receiver](test-receiver/) is a tiny fake chat service: it accepts the messages and lets you read them
(`GET /messages`). It is what the tests above used:

```bash
docker build -t wallas25/webhook-receiver:4.6 test-receiver
kubectl apply -f test-receiver/deployment.yaml
kubectl create secret generic broadcaster-webhook -n project \
  --from-literal=WEBHOOK_URL=http://webhook-receiver.project.svc.cluster.local:8080/
```

## Build and push the image

```bash
docker build -t wallas25/broadcaster:4.6 .
docker push wallas25/broadcaster:4.6
```

## Exercises

- 4.6
