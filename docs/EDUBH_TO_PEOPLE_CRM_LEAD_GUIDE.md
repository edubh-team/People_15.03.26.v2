# EduBH.com to People EduBH CRM Lead Integration

## 1. Purpose

This integration sends every student application submitted on `edubh.com` into the `people.edubh.com` CRM Leads workflow. The lead is created in the shared, unassigned pool so an authorized CRM manager can review and assign it.

## 2. Simple workflow

```text
Student submits form on edubh.com
        ↓
EduBH saves the application
        ↓
EduBH signs the application payload with HMAC-SHA256
        ↓
POST https://people.edubh.com/api/integrations/edubh/leads
        ↓
People verifies the timestamp and signature
        ↓
People validates and de-duplicates the application
        ↓
Lead is stored in Firestore: leads/{leadId}
        ↓
CRM → Leads → Fresh Queue
        ↓
Advanced → Lead origin → EduBH website
```

There are two delivery methods:

1. **Automatic push:** a successful website application is sent immediately to People CRM.
2. **Manual recovery fetch:** a manager selects a date range and clicks **Fetch EduBH leads** in People CRM. This asks EduBH to retry pending or failed deliveries.

## 3. Required environment variables

### On `edubh.com`

```env
# Must exactly match EDUBH_PEOPLE_INTEGRATION_SECRET on People.
EDUBH_PEOPLE_INTEGRATION_SECRET=replace-with-a-long-random-secret

# People CRM receiver. This is optional when the production default is correct.
PEOPLE_CRM_LEAD_ENDPOINT=https://people.edubh.com/api/integrations/edubh/leads

# Protects the EduBH retry/delivery endpoint.
CRON_SECRET=replace-with-another-long-random-secret
```

### On `people.edubh.com`

```env
# Must exactly match the value on edubh.com.
EDUBH_PEOPLE_INTEGRATION_SECRET=replace-with-a-long-random-secret

# Must exactly match CRON_SECRET on edubh.com.
EDUBH_PEOPLE_PULL_SECRET=replace-with-another-long-random-secret

# Optional; this is the current production default.
EDUBH_PEOPLE_PULL_ENDPOINT=https://edubh.com/api/cron/people-lead-delivery
```

Important:

- Never prefix secrets with `NEXT_PUBLIC_`.
- Configure variables in the server/deployment environment, not browser code.
- Restart or redeploy both applications after changing environment variables.

## 4. Automatic push request

### Endpoint

```http
POST https://people.edubh.com/api/integrations/edubh/leads
Content-Type: application/json
X-EduBH-Timestamp: <current Unix timestamp in seconds>
X-EduBH-Signature: sha256=<HMAC hex digest>
```

### Payload

```json
{
  "version": 1,
  "applicationId": "APP_2026_000123",
  "submittedAt": 1788201000000,
  "application": {
    "fullName": "Example Student",
    "email": "student@example.com",
    "phone": "+91 9876543210",
    "state": "Uttar Pradesh",
    "program": "MBA",
    "qualification": "B.Com",
    "preferredUniversity": "Example University",
    "budget": "250000",
    "preferredSession": "July 2026",
    "callbackDate": "2026-09-05",
    "callbackTime": "11:30",
    "leadSource": "Google Ads",
    "utmAttribution": {
      "utm_source": "google",
      "utm_medium": "cpc",
      "utm_campaign": "mba_2026"
    }
  }
}
```

Required application fields are `fullName`, `email`, `phone`, `state`, and `program`. The `applicationId` must be stable and unique for the website application.

### Signature generation

The signed value is:

```text
<timestamp>.<exact raw JSON request body>
```

Node.js example:

```ts
import { createHmac } from "node:crypto";

const rawBody = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = `sha256=${createHmac(
  "sha256",
  process.env.EDUBH_PEOPLE_INTEGRATION_SECRET!,
)
  .update(`${timestamp}.${rawBody}`, "utf8")
  .digest("hex")}`;

const response = await fetch(
  "https://people.edubh.com/api/integrations/edubh/leads",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-edubh-timestamp": timestamp,
      "x-edubh-signature": signature,
    },
    body: rawBody,
  },
);
```

Do not stringify the payload again after signing it. The receiver verifies the exact raw body.

### Success response

New lead:

```json
{
  "success": true,
  "leadId": "WEB-1513B5F55D50F0289BDC",
  "created": true,
  "duplicateFlag": false
}
```

Previously delivered application:

```json
{
  "success": true,
  "leadId": "WEB-1513B5F55D50F0289BDC",
  "created": false,
  "duplicateFlag": false
}
```

`created: false` is a successful idempotent response, not an error.

## 5. Manual fetch from People CRM

For an authorized manager:

1. Open **People → CRM → Leads**.
2. Click **Fetch EduBH leads**.
3. Select **From date** and **To date**. The maximum range is 31 days.
4. Click **Fetch selected dates**.
5. Open the **Fresh Queue**.
6. Open **Advanced** and select **Lead origin → EduBH website**. The current UI applies this filter automatically after a successful fetch.

Internal request made by People:

```http
POST https://edubh.com/api/cron/people-lead-delivery
Authorization: Bearer <EDUBH_PEOPLE_PULL_SECRET>
Content-Type: application/json

{
  "fromDate": "2026-08-25",
  "toDate": "2026-09-01"
}
```

The EduBH endpoint finds pending/failed applications in the selected range and sends each one through the same signed automatic-push endpoint.

## 6. CRM field mapping

| EduBH application | People CRM lead |
|---|---|
| `applicationId` | `externalLeadId` |
| fixed value | `externalSystem = "edubh.com"` |
| `fullName` | `name` |
| `email` | `email`, `normalizedEmail` |
| `phone` | `phone`, `normalizedPhone` |
| `state` | `leadLocation` |
| `program` | `targetDegree` |
| `qualification` | `currentEducation` |
| `preferredUniversity` | `targetUniversity` |
| `budget` | `courseFees` |
| `leadSource` | `source` |
| `utmAttribution` | `utmAttribution` |
| callback date/time | `nextFollowUp`, `nextFollowUpDateKey` |

New website leads are created with:

- `status: "new"`
- `custodyState: "pooled"`
- `assignedTo: null`
- `ownerUid: null`
- tags `Website` and `edubh.com`
- a creation timeline and audit history

## 7. Duplicate protection

The integration uses two protections:

1. **Application idempotency:** `integration_events/edubh_<applicationId>` prevents the same application from creating another CRM lead.
2. **Contact matching:** normalized phone and email are checked against existing leads. A possible match sets `duplicateFlag`, `duplicateReasons`, and candidate lead IDs for review.

Do not generate a new `applicationId` when retrying the same website application.

## 8. Status and error guide

| Result | Meaning | Action |
|---|---|---|
| `201`, `created: true` | New CRM lead created | No action |
| `200`, `created: false` | Application was already delivered | No action |
| `400` | Invalid/missing payload field | Correct payload data |
| `401` | Signature invalid or timestamp expired | Check shared secret, server clocks, and raw body |
| `409` | Lead import conflict | Review the application/lead record |
| `413` | Payload exceeds 64 KB | Reduce payload size |
| `503` | People integration secret is not configured | Configure server environment |
| Fetch returns `502` | People could not contact/authorize EduBH | Check endpoint and pull/cron secret |

The signature timestamp is accepted only within five minutes. Keep both servers synchronized with NTP.

## 9. Verification checklist

1. Confirm all environment variables exist on the correct server.
2. Submit one test application on EduBH.com.
3. Confirm EduBH records `peopleDeliveryStatus: "delivered"` and a `peopleLeadId`.
4. In People CRM, open **Fresh Queue**.
5. Apply **Advanced → Lead origin → EduBH website**.
6. Confirm name, phone, email, program, source, UTM values, and callback date.
7. Resend the same application ID and confirm `created: false` with the same lead ID.
8. Test a failed delivery, then use **Fetch EduBH leads** for its date.

## 10. Relevant source files

### EduBH.com project

- `src/lib/people-crm.ts` — builds, signs, and sends the payload.
- `src/app/api/applications/route.ts` — triggers immediate delivery after application save.
- `src/app/api/cron/people-lead-delivery/route.ts` — retries pending/failed deliveries and supports date ranges.
- `src/lib/firebase-db.ts` — stores delivery status, lead ID, error, and attempt count.

### People EduBH project

- `src/app/api/integrations/edubh/leads/route.ts` — signed inbound receiver.
- `src/lib/server/edubh-lead-integration.ts` — validation, mapping, duplicate checks, and Firestore writes.
- `src/app/api/integrations/edubh/pull/route.ts` — authenticated manager fetch proxy.
- `src/components/leads/CrmWorkbench.tsx` — Fetch EduBH UI and Advanced lead-origin filtering.

## 11. Security rules

- Use HTTPS only.
- Keep both secrets server-side.
- Use different values for the HMAC integration secret and cron/pull secret.
- Rotate both sides together.
- Never log secrets or full signed headers.
- The inbound payload is limited to 64 KB.
- HMAC verification uses timing-safe comparison.
- Manual fetch requires an authenticated People user with team-management permission.

