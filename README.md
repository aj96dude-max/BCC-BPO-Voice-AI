# BCC BPO Voice

Inbound call-center software for BPOs. A US customer calls a Twilio number, this platform answers with a campaign-specific AI agent, captures a structured ticket, and hands the result to your CRM or a live agent.

The same runtime covers medical billing, auto insurance, home services, mortgage, final expense, or a campaign you define. Campaigns are JSON playbooks, not hardcoded prompts.

## What it replaces

Pakistan (or any) inbound desks that take orders and intake by hand:

1. Caller in the US dials the client number.
2. Twilio webhooks this app.
3. Deepgram transcribes, Groq runs the playbook, ElevenLabs speaks.
4. Supervisors watch the live transcript on the mobile command center.
5. Completed tickets POST to your webhook. "Speak to a human" dials your SIP/PSTN fallback.

## Architecture

```
US caller -> Twilio number -> /incoming-call (campaign by DID or ?campaign=)
                -> bidirectional media stream
                -> Deepgram STT -> Groq playbook -> ElevenLabs TTS -> caller
                -> Command Center WebSocket (mobile)
                -> ORDER_WEBHOOK_URL (your CRM)
```

## Quick start

```bash
cd backend
copy .env.example .env   # then fill in keys
npm install
npm test
npm start
```

Expose the server with HTTPS/WSS (ngrok, Cloudflare Tunnel, or your load balancer):

```bash
ngrok http 8080
```

Set `PUBLIC_WS_URL=wss://<your-tunnel>` and point the Twilio number's voice webhook to:

```
https://<your-tunnel>/incoming-call
```

To pin a number to a vertical:

```
https://<your-tunnel>/incoming-call?campaign=medical-billing
```

Or map DIDs in `backend/config/number-map.json`.

## Embed this in another BPO

1. Deploy the backend (Docker, Render, Railway, or any Node 18+ host).
2. Copy a campaign JSON in `backend/campaigns/` or `POST /v1/campaigns`.
3. Map the client's inbound number to that campaign.
4. Set `ORDER_WEBHOOK_URL` to the BPO's CRM/ticket API.
5. Set `TRANSFER_SIP_URI` or `TRANSFER_NUMBER` for live-agent backup.
6. Give floor supervisors the mobile command center pointed at `wss://<host>/mobile`.

A new vertical does **not** require a code change. Add JSON, map the number, done.

### Campaign JSON

```json
{
  "id": "acme-hvac",
  "name": "Acme HVAC Intake",
  "vertical": "home-services",
  "greeting": "Thank you for calling Acme Heating. This call may be recorded. How can I help?",
  "persona": "You are an HVAC dispatch intake agent. Ask one question at a time.",
  "closing": "A dispatcher will confirm your window shortly.",
  "fields": [
    { "key": "caller_name", "label": "Caller name", "required": true },
    { "key": "callback_number", "label": "Callback number", "required": true },
    { "key": "address", "label": "Service address", "required": true },
    { "key": "issue_description", "label": "Issue", "required": true }
  ],
  "transferPhrases": ["human", "dispatcher", "supervisor"]
}
```

Built-in playbooks: `generic-inbound`, `auto-insurance`, `medical-billing`, `home-service`, `mortgage`, `final-expense`.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness and provider configuration |
| GET | `/v1/campaigns` | List playbooks |
| POST | `/v1/campaigns` | Create or replace a playbook |
| GET | `/v1/calls` | Recent and live calls |
| POST | `/v1/calls/:id/transfer` | Supervisor warm transfer |
| GET | `/v1/orders` | Completed intake tickets |
| POST | `/v1/simulate-turn` | Test a playbook without a phone call |
| POST | `/incoming-call` | Twilio Voice webhook |

Send `X-API-Key: $BCC_API_KEY` when that env var is set.

Simulate a medical-billing turn:

```bash
curl -s http://localhost:8080/v1/simulate-turn ^
  -H "Content-Type: application/json" ^
  -d "{\"campaignId\":\"medical-billing\",\"userText\":\"Hi, I have a bill from last Tuesday.\"}"
```

Completed tickets POST to `ORDER_WEBHOOK_URL` with optional HMAC header `X-BCC-Signature` (sha256 of the body using `ORDER_WEBHOOK_SECRET`).

## Command center

```bash
cd mobile
npx expo start
```

Enter the backend WebSocket URL (`ws://<lan-ip>:8080/mobile` on a device, `ws://localhost:8080/mobile` on a simulator). Optional `COMMAND_CENTER_TOKEN` is passed as `?token=`.

## Docker

```bash
docker compose up --build
```

## Environment

See `backend/.env.example`. Production requires Groq, Deepgram, ElevenLabs, Twilio, and `BCC_API_KEY`.

## Compliance

This is an intake engine. It is not itself a HIPAA, TCPA, or insurance-licensed product. Each BPO must:

- Play a recording disclosure (included in every built-in greeting).
- Sign a BAA before handling PHI, and lock down logs and webhooks.
- Keep licensed humans behind SIP transfer for advice, rates, or coverage decisions.
- Review each playbook's `complianceNotes` before going live.

## Stack

- Node 18+, Express 5, Twilio Media Streams
- Deepgram Nova-3 STT, Groq LLM, ElevenLabs Flash TTS
- Expo 57 command center
