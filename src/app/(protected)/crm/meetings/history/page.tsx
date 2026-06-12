import { MeetingsListClient } from "@/components/meetings/MeetingsListClient";

export default function MeetingHistoryPage() {
  return (
    <MeetingsListClient
      title="Meeting History"
      description="Review completed and cancelled meetings with synced attendance, no-shows, and recording relationships."
      endpoint="/api/meetings/history"
    />
  );
}
