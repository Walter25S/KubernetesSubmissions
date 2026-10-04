# todo_backend

Service that stores the todos of the project. The todos are kept in memory
(they are lost when the pod restarts); a database comes later in the course.

## Configuration (exercise 2.6)

Nothing is hard coded: the values come from environment variables, defined in
the ConfigMap `todo-backend-config`
([manifests/configmap.yaml](manifests/configmap.yaml)) and loaded with
`envFrom`. A missing variable stops the app on startup with a message.

| Variable | Meaning | Value in the ConfigMap |
| -------- | ------- | ---------------------- |
| `PORT` | Port the server listens on | `3000` |
| `MAX_TODO_LENGTH` | Maximum length of a todo | `140` |
| `MAX_BODY_BYTES` | Maximum size of a request body | `10240` |

| Method and path | Description |
| --------------- | ----------- |
| `GET /todos` | Returns the list of todos as JSON: `[{"id": 1, "todo": "Buy milk"}]`. |
| `POST /todos` | Creates a todo from the JSON body `{"todo": "Buy milk"}` and returns it with status `201`. A todo must have 1-140 characters, otherwise the response is `400`. |

It is only reachable inside the cluster, through the Service `todo-backend-svc`
(`http://todo-backend-svc:2345` from the `project` namespace, or
`todo-backend-svc.project` from another one); `todo_app` talks to it.

## Run locally

```bash
PORT=3001 MAX_TODO_LENGTH=140 MAX_BODY_BYTES=10240 node index.js
curl -X POST -H 'Content-Type: application/json' -d '{"todo":"Buy milk"}' localhost:3001/todos
curl localhost:3001/todos
```

## Build and push the image

```bash
docker build -t wallas25/todo-backend:2.6 .
docker push wallas25/todo-backend:2.6
```

## Deploy to the cluster

The app runs in the `project` namespace (exercise 2.4):

```bash
kubectl apply -f ../namespaces/project.yaml
kubectl apply -f manifests/
```

## Exercises

- 2.2
- 2.4 (moved to the `project` namespace)
- 2.6 (configuration in a ConfigMap, nothing hard coded)
