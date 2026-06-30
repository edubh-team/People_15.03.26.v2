# Meetings Module

## Overview

This module adds a Zoho Meeting backed Meetings area to the Next.js + Firebase CRM.

Core capabilities:

- Zoho OAuth 2.0 authorization and refresh-token management
- Firestore-backed meetings, participants, attendance, and recordings
- CRM pages for create, upcoming, history, and recordings
- My Day dashboard widgets for today's meetings, upcoming meetings, and missed meetings
- Manager audience selection for entire team, department, or individual employees
- Attendance and recording sync from Zoho after meetings complete
- Server-side audit logging through `audit_logs`

## Environment Variables

Required:

- `ZOHO_MEETING_CLIENT_ID`
- `ZOHO_MEETING_CLIENT_SECRET`
- `ZOHO_MEETING_REDIRECT_URI`

Supported aliases:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REDIRECT_URI`

Optional:

- `ZOHO_MEETING_ACCOUNTS_BASE_URL`
  Default: `https://accounts.zoho.com`
- `ZOHO_MEETING_API_BASE_URL`
  Default: `https://meeting.zoho.com/api/v2`
- `ZOHO_MEETING_RECORDING_API_BASE_URL`
  Default: `https://meeting.zoho.com/meeting/api/v2`
- `ZOHO_MEETING_SCOPES`
  Default scopes:
  - `ZohoMeeting.manageOrg.READ`
  - `ZohoMeeting.meeting.READ`
  - `ZohoMeeting.meeting.CREATE`
  - `ZohoMeeting.meeting.UPDATE`
  - `ZohoMeeting.meeting.DELETE`
  - `ZohoMeeting.recording.READ`

## Firestore Collections

### `meetings`

One document per meeting scheduled through the CRM.

Key fields:

- `title`
- `agenda`
- `date`
- `time`
- `timezone`
- `startTimeMs`
- `endTimeMs`
- `durationMinutes`
- `status`
  Values: `scheduled`, `live`, `completed`, `cancelled`, `sync_error`
- `audience`
  - `mode`: `team`, `department`, `individual`
  - `departmentNames`
  - `participantUids`
  - `scopeSummary`
- `participantCount`
- `participantUserUids`
- `participantEmails`
- `createdBy`
- `updatedBy`
- `cancelledBy`
- `host`
- `zoho`
  - `connectionUid`
  - `organizationId`
  - `presenterZuid`
  - `zohoMeetingId`
  - `meetingKey`
  - `joinUrl`
  - `startUrl`
  - `passwordMasked`
  - `encryptedPasswordMasked`
  - `embedUrl`
  - `lastAttendanceSyncAt`
  - `lastRecordingSyncAt`
  - `lastSuccessfulSyncAt`
  - `lastSyncError`
- `attendanceSummary`
  - `invited`
  - `attended`
  - `missed`
  - `totalDurationMs`
- `recordingSummary`
  - `count`
  - `lastRecordingSyncAt`
- `createdAt`
- `updatedAt`
- `cancelledAt`
- `completedAt`

### `participants`

One document per meeting participant snapshot.

Key fields:

- `meetingId`
- `meetingTitle`
- `meetingStartTimeMs`
- `participantUid`
- `email`
- `displayName`
- `role`
- `orgRole`
- `department`
- `employeeId`
- `audienceMode`
- `audienceSourceLabel`
- `status`
  Values: `invited`, `joined`, `left`, `no_show`, `removed`
- `zohoParticipantId`
- `joinedAtMs`
- `leftAtMs`
- `durationMs`
- `createdAt`
- `updatedAt`

### `attendance`

This repository already uses `attendance` for workforce attendance. Meeting attendance is stored in the same top-level collection with `kind: "meeting"` so the new module can meet the requested collection naming without breaking existing HR attendance features.

Meeting-attendance fields:

- `kind`
  Value: `meeting`
- `meetingId`
- `zohoMeetingId`
- `participantUid`
- `email`
- `memberId`
- `role`
- `joinSource`
- `joinedAtMs`
- `leftAtMs`
- `durationMs`
- `inAndOutTime`
- `participantAvatar`
- `syncedAt`
- `createdAt`
- `updatedAt`
- `raw`

### `recordings`

One document per Zoho recording.

Key fields:

- `meetingId`
- `zohoConnectionUid`
- `zohoOrganizationId`
- `meetingKey`
- `recordingId`
- `encryptedRecordingId`
- `topic`
- `status`
- `durationMs`
- `durationMinutes`
- `startTimeMs`
- `endTimeMs`
- `uploadedAtMs`
- `playUrl`
- `shareUrl`
- `downloadUrl`
- `transcriptDownloadUrl`
- `summaryDownloadUrl`
- `fileSizeBytes`
- `fileSizeLabel`
- `resourceName`
- `isMeeting`
- `isTranscriptGenerated`
- `isSummaryGenerated`
- `createdAt`
- `updatedAt`
- `syncedAt`
- `raw`

### `zoho_meeting_connections`

Per-user OAuth connection storage for Zoho Meeting.

Key fields:

- `uid`
- `owner`
- `accessToken`
- `refreshToken`
- `tokenType`
- `scopes`
- `expiresAtMs`
- `accountsBaseUrl`
- `apiBaseUrl`
- `recordingApiBaseUrl`
- `organizationId`
- `zuid`
- `primaryEmail`
- `portalName`
- `redirectionServer`
- `isAdmin`
- `connectedAt`
- `updatedAt`
- `lastRefreshAt`
- `lastError`

## Routes

Pages:

- `/crm/meetings`
- `/crm/meetings/create`
- `/crm/meetings/history`
- `/crm/meetings/recordings`

APIs:

- `GET /api/zoho/authorize`
- `GET /api/zoho/callback`
- `GET /api/zoho/meetings/oauth/authorize`
- `GET /api/zoho/meetings/oauth/callback`
- `GET /api/meetings/audience`
- `POST /api/meetings/create`
- `POST /api/meetings/update`
- `POST /api/meetings/cancel`
- `GET /api/meetings/upcoming`
- `GET /api/meetings/history`
- `GET /api/meetings/dashboard`
- `GET /api/meetings/recordings`
- `GET /api/meetings/[meetingId]`

## Permissions

- Admin and HR can create, update, cancel, and review all meetings.
- Managers and team leads can create, update, and cancel meetings in their workflow.
- Employees and other authenticated users can consume meetings through the server APIs and UI based on access filtering.
- Audit logging is written to `audit_logs` for Zoho connection, create, update, and cancel events.
