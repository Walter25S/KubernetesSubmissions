# namespaces

Namespaces used to keep the resources of the course separated (exercise 2.3).

| Namespace | Used for |
| --------- | -------- |
| `exercises` | `log_output` and `ping_pong`, and the rest of the exercises that are not the project (exercise 2.3). |
| `project` | The course project: `todo_app`, `todo_backend` and the PersistentVolumeClaim of the picture cache (exercise 2.4). |
| `monitoring` | The logging stack: Loki, Alloy and Grafana (exercise 2.10), see [../monitoring](../monitoring/README.md). |

```bash
kubectl apply -f namespaces/exercises.yaml
kubectl apply -f namespaces/project.yaml
kubectl apply -f namespaces/monitoring.yaml
```

Apply it before the applications. Resources of a namespace are listed with
`-n <namespace>`, for example `kubectl get all -n project`.

Both the `exercises` Ingress (`log_output`) and the `project` Ingress route `/`,
so only one of them should be applied at a time until they get their own routes.
