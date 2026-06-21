# VPS Info

> Repo path on BOTH boxes: `/opt/trello`. Deploy with `bash /opt/trello/deploy.sh`
> (path-independent; tier comes from `packages/infra/.env`). Never hardcode another path.

## trello-dev-vps

- ssh alias: trello-dev-vps (`ssh trello-dev-vps`)
- host: 103.82.192.197
- repo path: /opt/trello
- deploy user: deploy (passwordless sudo)
- local key: ~/.ssh/id_ed25519_trello
- domains (Cloudflare-proxied): dev-app.trello-clone.shop (frontend), dev-api.trello-clone.shop (backend), dev.trello-clone.shop (landing), dev-monitor.trello-clone.shop (grafana), dev-minio.trello-clone.shop (minio console)
- TLS: Cloudflare Origin CA cert on the VPS at packages/infra/certs/{origin.pem,origin.key}; CF SSL mode Full (strict)
- public ports: 22, 80, 443 only (proxy publishes 80/443; grafana bound to 127.0.0.1:3000, SSH-tunnel only)
- deployment environment: dev
- password login disabled: true
- root login disabled: true
- github deploy key on vps: ~/.ssh/id_ed25519_github (repo nsnl-coder/trello, read-only)

## trello-prod-vps

- ssh alias: trello-prod-vps (`ssh trello-prod-vps`)
- host: 129.121.112.37
- repo path: /opt/trello
- deploy user: deploy (passwordless sudo)
- local key: ~/.ssh/id_ed25519_trello
- domains (Cloudflare-proxied): app.trello-clone.shop (frontend), api.trello-clone.shop (backend), trello-clone.shop (landing), monitor.trello-clone.shop (grafana), minio.trello-clone.shop (minio console)
- TLS: Cloudflare Origin CA cert at packages/infra/certs/{origin.pem,origin.key} (wildcard *.trello-clone.shop); CF SSL mode Full (strict)
- public ports: 22, 80, 443 only
- deployment environment: prod
- password login disabled: true
- root login disabled: true
- github deploy key on vps: ~/.ssh/id_ed25519_github (repo nsnl-coder/trello, read-only)
