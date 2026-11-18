# Deployment

> This is the standalone **relay-only** installer. For the current Aevum deployment
> (MrHua, kernel VGA, exhibit page and relay), use `ops/deploy/systemd/install.sh`
> instead. It installs three services (`aevum-kernel`, `aevum-bridge`, `aevum-relay`)
> and the nginx routes those pages need. The old monitor and auth/chat APIs are archived under
> `archive/backend-python/monitor` and are not part of the current deployment.

One command brings up the static site and the in-memory relay on one host:

```bash
sudo bash control/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn
```

Run it from the repository root, after cloning. The script is idempotent; re-run it
after `git pull`.

## What it sets up

| Piece | Where | Notes |
| --- | --- | --- |
| Static site | nginx, `interface/web` (fallback `preview/web`) | plain files, no server-side rendering |
| Relay | `127.0.0.1:8790`, systemd `aevum-relay` | loopback only; never exposed directly |
| Public API | `https://<domain>/v1/` → relay | nginx injects `X-Relay-Token`; the browser never holds the token |
| TLS | certbot `--nginx`, auto-redirect | skipped when the certificate already exists or `--no-cert` is passed |
| Firewall | firewalld 80/443 | only when firewalld is active |

The relay process is memory-only. `MemoryMax=256M`, `ProtectSystem=strict` and
`PrivateTmp=true` are set in the unit because a relay that writes nothing needs no
filesystem access at all.

## Requirements

- Alibaba Cloud Linux 3 (or a compatible RHEL 8/9 host) with `dnf`, `systemd`, `nginx`
- Python >= 3.10; the script picks 3.13 → 3.10 in that order and installs `python3.11` when none is present
- A DNS `A` record for the domain pointing at the host, before running certbot

## Options

```bash
sudo bash control/relay/deploy/install.sh --domain example.com --email admin@example.com
sudo bash control/relay/deploy/install.sh --domain example.com --no-cert      # HTTP only, for a first smoke test
sudo bash control/relay/deploy/install.sh --domain example.com --with-qemu    # also install qemu-kvm + iproute
```

`--with-qemu` installs the RHEL-family package names on purpose: `qemu-kvm` (not
`qemu-system-x86`) and `iproute` (not `iproute2`).

## After deployment

```bash
systemctl status aevum-relay --no-pager
journalctl -u aevum-relay -f
curl -fsS https://<domain>/v1/health
```

Update:

```bash
git pull
systemctl restart aevum-relay
systemctl reload nginx
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `502` on `/v1/...` | `systemctl status aevum-relay`; is anything listening on `127.0.0.1:8790`? |
| `401 0x060101` | nginx config lost the `X-Relay-Token` line, or `/etc/aevum/relay.env` was regenerated without reloading nginx |
| certificate not issued | DNS not resolved yet, or port 80 blocked; re-run with `--email` after fixing DNS |
| site shows 403 | static tree not readable by the `nginx` user; `chmod -R a+rX` the web root |
| `nginx -t` fails after certbot | certbot edited a vhost with a missing certificate path; restore `control/relay/deploy/nginx-aevum.conf` and re-run the installer |

## Why not serve the static site from the relay

The relay is a kernel, not a web host. It owns sessions, transfers and presence;
the page is the shell that displays them. Keeping nginx as the only public entry
point also means CORS disappears in production and the token stays server-side.
