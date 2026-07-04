"use client";

import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Image as ImageIcon, Calendar as CalendarIcon, Download, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const VISITS_DATA = [
  { id: 1, name: "[2356] APSP solutions", checkIn: "29-06-2026 04:50 PM", checkOut: "29-06-2026 04:52 PM", duration: "2min", feedbackType: "Excellent", feedback: "order taken", visitedBy: "Prakash", img: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=150&h=150&fit=crop" },
  { id: 2, name: "[531] A2z it solution", checkIn: "29-06-2026 04:47 PM", checkOut: "29-06-2026 04:48 PM", duration: "1min", feedbackType: "Good", feedback: "discussion", visitedBy: "KOOPS DEMO", img: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=150&h=150&fit=crop" },
  { id: 3, name: "[57] abc", checkIn: "29-06-2026 04:42 PM", checkOut: "29-06-2026 04:43 PM", duration: "1min", feedbackType: "Average", feedback: "wrong contact", visitedBy: "KOOPS DEMO", img: null },
];

export default function CustomerVisitsPage() {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredVisits = useMemo(() => {
    return VISITS_DATA.filter(row => 
      row.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      row.visitedBy.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Customer Visits</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2"><CalendarIcon className="h-4 w-4" /> 29-06-2026</Button>
          <Button size="sm">Filter (0)</Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row justify-between items-center p-4 border-b border-border gap-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by customer or employee..." 
              className="pl-8 bg-background" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" className="gap-2 ml-auto">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Customer</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-center">Image</TableHead>
                <TableHead>Feedback Type</TableHead>
                <TableHead>Feedback</TableHead>
                <TableHead>Visited By</TableHead>
                <TableHead className="text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVisits.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No records found.</TableCell></TableRow>
              ) : filteredVisits.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium whitespace-nowrap">{row.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{row.checkIn}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{row.checkOut}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.duration}</TableCell>
                  <TableCell className="text-center">
                    {row.img ? (
                      <Dialog>
                        <DialogTrigger className="h-10 w-10 rounded-md overflow-hidden border border-border inline-flex hover:ring-2 hover:ring-primary transition-all">
                          <img src={row.img} alt="Shop" className="w-full h-full object-cover" />
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Visit Photo - {row.name}</DialogTitle>
                          </DialogHeader>
                          <div className="flex justify-center p-4">
                            <img src={row.img} alt="Shop" className="max-w-full rounded-md shadow-lg" />
                          </div>
                        </DialogContent>
                      </Dialog>
                    ) : (
                      <div className="h-10 w-10 rounded-md border border-border inline-flex items-center justify-center bg-muted mx-auto">
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className={
                        row.feedbackType === 'Excellent' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 
                        row.feedbackType === 'Good' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
                        'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      }
                    >
                      {row.feedbackType}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate">{row.feedback}</TableCell>
                  <TableCell>{row.visitedBy}</TableCell>
                  <TableCell className="text-center">
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs whitespace-nowrap">
                      <MapPin className="h-3 w-3" /> MAP
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
