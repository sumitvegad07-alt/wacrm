import { Metadata } from "next";
import { CompanyProfilePanel } from "@/components/settings/company-profile-panel";
import { RequirePermission } from "@/components/auth/require-permission";

export const metadata: Metadata = {
  title: "Company Profile",
  description: "Manage your company profile details",
};

export default function CompanyProfilePage() {
  return (
    <RequirePermission permission="manage_company_profile">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <CompanyProfilePanel />
      </div>
    </RequirePermission>
  );
}
