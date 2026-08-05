import { Metadata } from "next";
import { SubscriptionPanel } from "@/components/settings/subscription-panel";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Manage your subscription details",
};

export default function SubscriptionPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <SubscriptionPanel />
    </div>
  );
}
