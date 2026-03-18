# WhatsApp Mock Integration Runbook

This setup gives you a full mock flow now, and keeps the API shape ready for real WhatsApp webhook integration later.

## 1) Environment Variables

Add these to `.env.local`:

```env
WHATSAPP_MOCK_API_KEY=change-this-to-a-secret
WHATSAPP_VERIFY_TOKEN=change-this-verify-token
WHATSAPP_DEFAULT_OWNER_UID=<manager-or-bda-uid>
```

Notes:
- `WHATSAPP_MOCK_API_KEY` protects mock endpoints.
- `WHATSAPP_VERIFY_TOKEN` is for WhatsApp webhook verification handshake (`GET` challenge).
- `WHATSAPP_DEFAULT_OWNER_UID` auto-assigns new WhatsApp leads if payload does not send `ownerUid`.

## 2) Start the App

```powershell
npm run dev
```

## 3) Verify Endpoints

Health:

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:3000/api/integrations/whatsapp/webhook"
```

Pull-history (requires key):

```powershell
Invoke-RestMethod -Method GET `
  -Uri "http://localhost:3000/api/integrations/whatsapp/pull?key=change-this-to-a-secret"
```

## 4) Mock Webhook Push (campaign pushes leads)

```powershell
$body = @{
  source = "WhatsApp Campaign"
  campaignName = "March Admissions WA"
  batchId = "wa-mar-2026-01"
  ownerUid = "<optional-owner-uid>"
  tags = @("marketing", "wa-campaign")
  events = @(
    @{
      waId = "919876543210"
      name = "Rahul Sharma"
      messageBody = "I want details for MBA"
      leadLocation = "Ranchi"
      preferredLanguage = "Hindi"
      targetDegree = "MBA"
      targetUniversity = "Arka Jain University"
      courseFees = 100000
    },
    @{
      waId = "918888777766"
      name = "Priya Singh"
      messageBody = "Share BCA brochure"
      leadLocation = "Patna"
      preferredLanguage = "English"
      targetDegree = "BCA"
      targetUniversity = "LPU"
      courseFees = 150000
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method POST `
  -Uri "http://localhost:3000/api/integrations/whatsapp/webhook" `
  -Headers @{ "Content-Type" = "application/json"; "x-whatsapp-mock-key" = "change-this-to-a-secret" } `
  -Body $body
```

## 5) Mock Contact Pull (adapter-style)

Use this when your campaign/export tool provides a contact list and you want to ingest in one API call.

```powershell
$body = @{
  source = "WhatsApp Campaign"
  campaignName = "Meta Lead Ads WA"
  batchId = "wa-pull-2026-03-18"
  ownerUid = "<optional-owner-uid>"
  tags = @("meta", "whatsapp-generated")
  contacts = @(
    @{
      waId = "919900001111"
      name = "Aman Verma"
      message = "Need MCA admission details"
      leadLocation = "Delhi"
      preferredLanguage = "Hindi"
      targetDegree = "MCA"
      targetUniversity = "LPU"
      courseFees = 148000
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method POST `
  -Uri "http://localhost:3000/api/integrations/whatsapp/pull" `
  -Headers @{ "Content-Type" = "application/json"; "x-whatsapp-mock-key" = "change-this-to-a-secret" } `
  -Body $body
```

## 6) What Gets Written to CRM

For new leads:
- `status = "new"` (shows in New queue)
- `source = "WhatsApp Inbound"` (or provided source)
- `importBatchId` and batch log in `crm_import_batches`
- tags include `WhatsApp Lead` + your payload tags
- location/language stored in:
  - `leadLocation`
  - `preferredLanguage`
  - context lead tags (`Location: ...`, `Language: ...`)

For existing leads (same phone/email):
- lead is updated (not duplicated)
- WhatsApp tags/campaign metadata are merged
- timeline entry is appended

Inbound message behavior:
- Any inbound WhatsApp message can create/update a lead.
- Campaign/CTA metadata is optional.
- If there is no campaign context, lead still ingests with source `WhatsApp Inbound`.

## 7) Collections Used

- `leads`
- `leads/{leadId}/timeline`
- `crm_import_batches`
- `crm_whatsapp_ingest_events`
- `notifications` (if owner assigned)

## 8) Move to Real WhatsApp Later

When you connect actual WhatsApp:
1. Point provider webhook URL to:
   - `/api/integrations/whatsapp/webhook`
2. Set `WHATSAPP_VERIFY_TOKEN`.
3. Keep payload format from Meta webhook (`entry[].changes[].value...`).
4. Keep `WHATSAPP_MOCK_API_KEY` for internal mock calls (optional in non-prod, recommended in prod).
