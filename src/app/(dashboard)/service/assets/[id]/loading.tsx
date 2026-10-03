import { PageLoader } from "@/components/shared";

// The list's loading.tsx (a table skeleton) would otherwise show here too, because a loading file
// covers its nested routes. A detail screen is not a table.
export default function AssetDetailLoading() {
  return <PageLoader text="Loading..." />;
}
