# todo_cronjob

CronJob of the project (exercise 2.9). Every hour it creates a new todo that
reminds you to read a random Wikipedia article:

```
Read https://en.wikipedia.org/wiki/Fierville-Bray
```

The job asks `https://en.wikipedia.org/wiki/Special:Random`, which answers with a
redirect, takes the article URL from the `Location` header and sends it to
[todo_backend](../todo_backend/README.md) with `POST /todos`. The URL is plain
text in the todo (not a link); copy and paste it into the browser.

## Configuration

Nothing is hard coded. The values come from the ConfigMap `todo-cronjob-config`
([manifests/configmap.yaml](manifests/configmap.yaml)); a missing variable stops
the job with a message.

| Variable | Meaning | Value in the ConfigMap |
| -------- | ------- | ---------------------- |
| `RANDOM_ARTICLE_URL` | URL that redirects to a random article | `https://en.wikipedia.org/wiki/Special:Random` |
| `TODO_BACKEND_URL` | Base URL of `todo_backend` | `http://todo-backend-svc:2345` |
| `USER_AGENT` | Identifies the client to Wikipedia | `KubernetesSubmissions-todo-cronjob/1.0 (...)` |
| `REQUEST_TIMEOUT_MS` | Timeout of each request | `5000` |

## The CronJob

[manifests/cronjob.yaml](manifests/cronjob.yaml), in the `project` namespace:

- `schedule: "0 * * * *"`: every hour, at minute 0.
- `concurrencyPolicy: Forbid`: a new run does not start while the previous one is still running.
- `backoffLimit: 3` and `restartPolicy: Never`: a failed run is retried up to 3 times with a new pod.
- It keeps the last 3 successful and 1 failed Job for inspection.

## Run locally

```bash
RANDOM_ARTICLE_URL=https://en.wikipedia.org/wiki/Special:Random TODO_BACKEND_URL=http://localhost:3001 \
USER_AGENT="my-test/1.0" REQUEST_TIMEOUT_MS=5000 node index.js
```

## Build and push the image

```bash
docker build -t wallas25/todo-cronjob:2.9 .
docker push wallas25/todo-cronjob:2.9
```

## Deploy to the cluster

```bash
kubectl apply -f manifests/
kubectl get cronjob -n project
```

Run it right now instead of waiting for the next hour, and read the result:

```bash
kubectl create job --from=cronjob/todo-cronjob manual-1 -n project
kubectl logs job/manual-1 -n project
kubectl delete job manual-1 -n project
```

## Exercises

- 2.9
