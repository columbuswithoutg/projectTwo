# Voice chat TURN setup (5 minutes)

## Why you need this

Proximity voice chat in `/world` and `/home` is peer-to-peer WebRTC. Two
players on friendly networks (home Wi-Fi) connect directly using the free
Google STUN servers — no setup needed. But when either player is on
**cellular data, a strict/symmetric NAT, or a corporate firewall**, direct
connection is impossible and the pair needs a **TURN relay** to forward
audio. Without one, voice silently fails for those pairs (the voice
diagnostics panel shows "STUN only").

The app is already fully wired: the client fetches ICE servers from
`GET /api/config/voice-turn`, and the server builds that list from three
environment variables. You only need to create a TURN account and set them.

## Option A — Metered.ca (recommended, free tier)

1. Sign up at https://www.metered.ca/stun-turn (free tier: 20 GB/month of
   relayed audio — plenty; most pairs still connect direct and use zero).
2. Create an app; the dashboard shows your TURN credentials.
3. Set the env vars (Render dashboard → Environment, and local `.env`):

```
TURN_URLS=turn:a.relay.metered.ca:80,turn:a.relay.metered.ca:443?transport=tcp
TURN_USERNAME=<your username from the dashboard>
TURN_CREDENTIAL=<your credential from the dashboard>
```

Comma-separate multiple URLs. The `:443?transport=tcp` variant helps on
networks that block UDP entirely.

## Option B — Cloudflare Calls TURN

https://developers.cloudflare.com/calls/turn/ — generates short-lived
credentials via API. The current server code expects static credentials, so
prefer Option A unless you want to extend `routes/config.js` to mint
Cloudflare credentials per request.

## Option C — self-hosted coturn

Run [coturn](https://github.com/coturn/coturn) on any VPS, set
`TURN_URLS=turn:your-server:3478`, plus the long-term credential user/pass
you configured. Only worth it if you outgrow free tiers.

## Verifying it works

1. Restart the server after setting the env vars.
2. Open `/world`, enable the mic (🎙️), open the voice diagnostics panel —
   it should now read **"TURN configured"** instead of "STUN only".
3. Real-world test: one player on Wi-Fi + one on cellular data should hear
   each other; the diagnostics' candidate types will include `relay` when
   TURN is actually carrying the audio.

## Notes

- Never commit the credentials — they live only in env vars
  (`.env` locally, Render dashboard in production; see `.env.example`).
- If the env vars are unset, everything behaves exactly as before
  (STUN-only, direct connections still work).
