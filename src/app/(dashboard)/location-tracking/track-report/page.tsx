import { redirect } from "next/navigation";

/**
 * Track Report was merged into Tracking Health — every column it showed (distance, total,
 * regular, GPS off, switch off, critical, mock, accuracy) now lives there, alongside the
 * diagnosis of WHY the numbers look the way they do.
 *
 * Kept as a redirect rather than deleted: bookmarks and any saved links still land somewhere
 * useful instead of a 404.
 */
export default function TrackReportRedirect() {
  redirect("/location-tracking/health");
}
