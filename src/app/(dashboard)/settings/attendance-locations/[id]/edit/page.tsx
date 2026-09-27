import { AttendanceLocationForm } from "@/components/settings/attendance-locations/attendance-location-form";

export default async function EditAttendanceLocationPage({
  params,
}: {
  // Next 15+ passes params as a promise; reading it synchronously throws at runtime.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AttendanceLocationForm locationId={id} />;
}
