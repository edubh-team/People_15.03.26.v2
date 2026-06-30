import { MeetingsListClient } from "@/components/meetings/MeetingsListClient";

export default function MeetingsUpcomingPage() {
  return (
    <MeetingsListClient
      title="Upcoming Meetings"
      description="Start, join, edit, and cancel scheduled sessions from one CRM-native queue with live participant and attendance visibility."
      endpoint="/api/meetings/upcoming"
      showDashboard
    />
  );
}
