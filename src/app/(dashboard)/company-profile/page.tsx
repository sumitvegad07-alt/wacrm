import { Metadata } from "next";
import { CompanyProfilePanel } from "@/components/settings/company-profile-panel";

export const metadata: Metadata = {
  title: "Company Profile",
  description: "Manage your company profile details",
};

export default function CompanyProfilePage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <CompanyProfilePanel />
    </div>
  );
}
