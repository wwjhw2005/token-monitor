# API

The hub exposes a small JSON HTTP API.

## Authentication

All endpoints except `/api/health` require the configured shared secret.

Use either:

```http
Authorization: Bearer <secret>
```

or:

```http
X-Token-Monitor-Secret: <secret>
```

## `GET /api/health`

Health check. Does not require authentication.

Example response:

```json
{
  "ok": true,
  "role": "hub",
  "version": 1,
  "deviceCount": 2,
  "secretRequired": true,
  "now": "2026-05-18T00:00:00.000Z"
}
```

## `POST /api/ingest`

Posts one device usage summary.

Example payload:

```json
{
  "deviceId": "macbook",
  "hostname": "macbook.local",
  "platform": "darwin-arm64",
  "updatedAt": "2026-05-18T00:00:00.000Z",
  "agentVersion": "0.1.0",
  "today": {
    "totalTokens": 1234,
    "costUsd": 0.01,
    "clients": {
      "codex": 1234
    },
    "clientCosts": {
      "codex": 0.01
    }
  },
  "month": {
    "totalTokens": 4567,
    "costUsd": 0.04,
    "clients": {},
    "clientCosts": {}
  },
  "allTime": {
    "totalTokens": 8901,
    "costUsd": 0.08,
    "clients": {},
    "clientCosts": {}
  },
  "limits": {
    "updatedAt": "2026-05-18T00:00:00.000Z",
    "refreshMs": 300000,
    "providers": [
      {
        "provider": "claude",
        "accountKey": "sha256:...",
        "status": "ok",
        "updatedAt": "2026-05-18T00:00:00.000Z",
        "windows": [
          {
            "kind": "session",
            "usedPercent": 42,
            "remainingPercent": 58,
            "resetsAt": "2026-05-18T05:00:00.000Z"
          },
          {
            "kind": "weekly",
            "usedPercent": 20,
            "remainingPercent": 80,
            "resetsAt": "2026-05-25T00:00:00.000Z"
          }
        ]
      }
    ]
  }
}
```

The hub normalizes records before storing them.

`limits` is optional. Agents and widgets include it when AI Tool Limits detection is enabled. Raw OAuth credentials, access tokens, refresh tokens, emails, and provider response bodies must never be sent.

## `GET /api/stats`

Returns aggregate stats for the widget.

Response includes:

- `periods.today`
- `periods.month`
- `periods.allTime`
- `limits.providers` aggregated by provider account
- `devices`
- stale status for devices that have not reported recently

If multiple devices report the same provider account, the hub keeps the freshest valid limits status for that account. Public Worker stats omit account identifiers.

## `GET /api/devices`

Returns normalized records for all stored devices.

## `DELETE /api/devices/:id`

Deletes one device record from the hub store.

This is useful after renaming a device id.
