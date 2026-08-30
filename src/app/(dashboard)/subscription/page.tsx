import { Metadata } from "next";
import { SubscriptionPanel } from "@/components/settings/subscription-panel";
import { RequirePermission } from "@/components/auth/require-permission";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Manage your subscription details",
};

export default function SubscriptionPage() {
  return (
    <RequirePermission permission="billing">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <SubscriptionPanel />
      </div>
    </RequirePermission>
  );
}
