"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function FollowUpsPage() {
  const [profiles, setProfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [activityStatus, setActivityStatus] = useState("Undone");
  const [period, setPeriod] = useState("Today");
  const [activityType, setActivityType] = useState("");

  useEffect(() => {
    async function loadProfiles() {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");
      
      if (data) {
        setProfiles(data);
        if (data.length > 0) setAssignTo(data[0].id);
      }
    }
    loadProfiles();
  }, []);

  const handleSearch = () => {
    // In a real implementation, this would trigger a data fetch
    console.log("Searching with filters:", {
      assignTo,
      activityStatus,
      period,
      activityType,
    });
  };

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] -m-4 md:-m-6 bg-background">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center border-r border-border p-6 text-center">
        <h2 className="text-2xl font-light text-muted-foreground mb-6">
          No activity found.
        </h2>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-2 h-auto text-sm">
          SCHEDULE AN ACTIVITY
        </Button>
      </div>

      {/* Right Sidebar Filters */}
      <div className="w-80 bg-card p-6 flex flex-col gap-6 shrink-0 overflow-y-auto">
        <div className="flex justify-end mb-2">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 h-8 text-xs font-semibold">
            ADD
          </Button>
        </div>

        <div className="space-y-4">
          {/* Assign To */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">Assign To</Label>
            <Select value={assignTo} onValueChange={(val) => setAssignTo(val || "")}>
              <SelectTrigger className="h-9 text-sm bg-background">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name || "Unknown User"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Activity Status */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">Activity Status</Label>
            <Select value={activityStatus} onValueChange={(val) => setActivityStatus(val || "")}>
              <SelectTrigger className="h-9 text-sm bg-background">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Undone">Undone</SelectItem>
                <SelectItem value="Done">Done</SelectItem>
                <SelectItem value="All">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Period */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">Period</Label>
            <Select value={period} onValueChange={(val) => setPeriod(val || "")}>
              <SelectTrigger className="h-9 text-sm bg-background">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Today">Today</SelectItem>
                <SelectItem value="Tomorrow">Tomorrow</SelectItem>
                <SelectItem value="This Week">This Week</SelectItem>
                <SelectItem value="This Month">This Month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Activity Type */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">Activity Type</Label>
            <Select value={activityType} onValueChange={(val) => setActivityType(val || "")}>
              <SelectTrigger className="h-9 text-sm bg-background text-muted-foreground">
                <SelectValue placeholder="Select Activity Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Call">Call</SelectItem>
                <SelectItem value="Meeting">Meeting</SelectItem>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="Follow-up">Follow-up</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-2">
            <Button
              onClick={handleSearch}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              SEARCH
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
