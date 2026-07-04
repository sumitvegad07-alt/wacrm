"use client";

import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, MapPin, Calendar as CalendarIcon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const ATTENDANCE_DATA = [
  { id: 1, name: "KOOPS DEMO", punchIn: "03-06-2026 12:01 PM", punchOut: "-", duration: "0min", status: "Present", img: null },
  { id: 2, name: "Ritesh", punchIn: "03-06-2026 12:01 PM", punchOut: "-", duration: "0min", status: "Present", img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150&h=150" },
  { id: 3, name: "Prakash", punchIn: "-", punchOut: "-", duration: "-", status: "Absent", img: null },
  { id: 4, name: "Rahul", punchIn: "-", punchOut: "-", duration: "-", status: "Absent", img: null },
];

const USERS_SUMMARY_DATA = [
  { id: 1, name: "Ritesh", totalDays: 59, present: 6, absent: 53, leave: 0, holidays: 0, presencePct: "10.17%", lateStart: 6, earlyLeave: 3, shortPresent: 6 },
  { id: 2, name: "Prakash", totalDays: 59, present: 1, absent: 58, leave: 0, holidays: 0, presencePct: "1.69%", lateStart: 1, earlyLeave: 1, shortPresent: 1 },
  { id: 3, name: "KOOPS DEMO", totalDays: 59, present: 1, absent: 50, leave: 0, holidays: 8, presencePct: "1.69%", lateStart: 1, earlyLeave: 0, shortPresent: 1 },
];

export default function UserAttendancePage() {
  const [activeTab, setActiveTab] = useState("Punch in");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPunchData = useMemo(() => {
    return ATTENDANCE_DATA.filter(row => row.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery]);

  const filteredUsersData = useMemo(() => {
    return USERS_SUMMARY_DATA.filter(row => row.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">User Attendance</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2"><CalendarIcon className="h-4 w-4" /> 03-06-2026</Button>
          <Button size="sm">Filter (0)</Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-border flex flex-wrap gap-2 px-4 sm:px-6">
          {["Punch in", "Users", "Days", "Monthly"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-0">
          <div className="flex flex-col sm:flex-row justify-between items-center p-4 border-b border-border gap-4">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search by name..." 
                className="pl-8 bg-background" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">
              Total: {activeTab === "Punch in" ? filteredPunchData.length : activeTab === "Users" ? filteredUsersData.length : 0}
            </span>
          </div>

          <div className="overflow-x-auto">
            {activeTab === "Punch in" && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Name</TableHead>
                    <TableHead>Punch in time</TableHead>
                    <TableHead>Punch out time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Present/Absent</TableHead>
                    <TableHead className="text-center">View Map</TableHead>
                    <TableHead className="text-center">Image</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPunchData.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No records found.</TableCell></TableRow>
                  ) : filteredPunchData.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.punchIn}</TableCell>
                      <TableCell>{row.punchOut}</TableCell>
                      <TableCell>{row.duration}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === "Present" ? "default" : "destructive"} className={row.status === "Present" ? "bg-green-500 hover:bg-green-600" : ""}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs whitespace-nowrap">
                          <MapPin className="h-3 w-3" /> VIEW MAP
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        {row.img ? (
                          <Dialog>
                            <DialogTrigger className="h-8 w-8 rounded overflow-hidden border border-border inline-flex hover:ring-2 hover:ring-primary transition-all">
                              <img src={row.img} alt="Selfie" className="w-full h-full object-cover" />
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                              <DialogHeader>
                                <DialogTitle>Punch In Selfie - {row.name}</DialogTitle>
                              </DialogHeader>
                              <div className="flex justify-center p-4">
                                <img src={row.img} alt="Selfie" className="max-w-full rounded-md shadow-lg" />
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <div className="h-8 w-8 rounded border border-border inline-flex items-center justify-center bg-muted mx-auto">
                            <Camera className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {activeTab === "Users" && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Total Days</TableHead>
                    <TableHead className="text-right">Present Days</TableHead>
                    <TableHead className="text-right">Absent Days</TableHead>
                    <TableHead className="text-right">Leave Days</TableHead>
                    <TableHead className="text-right">Holidays</TableHead>
                    <TableHead className="text-right">Presence (%)</TableHead>
                    <TableHead className="text-right">Late Start</TableHead>
                    <TableHead className="text-right">Early Leaving</TableHead>
                    <TableHead className="text-right">Short Present</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsersData.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">No records found.</TableCell></TableRow>
                  ) : filteredUsersData.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium whitespace-nowrap">{row.name}</TableCell>
                      <TableCell className="text-right">{row.totalDays}</TableCell>
                      <TableCell className="text-right text-green-600 font-medium">{row.present}</TableCell>
                      <TableCell className="text-right text-red-500 font-medium">{row.absent}</TableCell>
                      <TableCell className="text-right">{row.leave}</TableCell>
                      <TableCell className="text-right">{row.holidays}</TableCell>
                      <TableCell className="text-right font-medium">{row.presencePct}</TableCell>
                      <TableCell className="text-right">{row.lateStart}</TableCell>
                      <TableCell className="text-right">{row.earlyLeave}</TableCell>
                      <TableCell className="text-right">{row.shortPresent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {(activeTab === "Days" || activeTab === "Monthly") && (
              <div className="p-8 text-center text-muted-foreground">
                <CalendarIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>No data available for {activeTab} view in this date range.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
