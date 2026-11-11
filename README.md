# paste-img

Paste or drop images, get public URLs. Built for sending screenshots to LLM agents over SSH.

## Run

    node server.js

Zero dependencies. Node 26+.

## Config (env)

| Var | Default | Note |
| --- | --- | --- |
| PORT | 3000 | |
| DATA_DIR | ./data | Container default: `/data` |
| PUBLIC_URL | from headers | e.g. https://img.example.com |
| UPLOAD_TOKEN | none | Require `x-token` header on upload |
| MAX_MB | 20 | |
| RETENTION_DAYS | 30 | 0 keeps forever |

## Deploy (Dokploy)

Application, Dockerfile build, port 3000, add a domain.

## CLI

    curl -s -H "x-token: $T" --data-binary @shot.png https://img.example.com/api/upload
