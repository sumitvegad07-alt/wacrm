"use client";

import { useState } from "react";
import { Plus, MoreVertical, Copy, UserPlus, Pencil, LayoutTemplate } from "lucide-react";
import { SettingsPanelHead } from "../settings-panel-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

const MODULES = [
  { id: "order", label: "Order" },
  { id: "estimate", label: "Estimate" },
  { id: "dispatch", label: "Dispatch" },
  { id: "outstanding", label: "Outstanding" },
  { id: "payment", label: "Payment Collection" },
];

// Dummy data for Phase 1 UI
const DUMMY_TEMPLATES: Record<string, any[]> = {
  order: [
    { id: "1", name: "Default", isDefault: true, thumbnail: "" },
    { id: "2", name: "Copy of Default", isDefault: false, thumbnail: "" },
  ],
  estimate: [
    { id: "3", name: "Standard Estimate", isDefault: true, thumbnail: "" },
  ]
};

export function DocumentTemplatesPanel() {
  const router = useRouter();
  const [activeModule, setActiveModule] = useState(MODULES[0].id);
  const templates = DUMMY_TEMPLATES[activeModule] || [];

  return (
    <section className="w-full animate-in fade-in-50 duration-200 flex flex-col h-[calc(100vh-120px)]">
      <SettingsPanelHead
        title="Document Templates"
        description="Configure PDF templates for transactions like Orders, Estimates, and Dispatches."
        action={
          <Button onClick={() => router.push(`/settings/document-templates/new?module=${activeModule}`)}>
            <Plus className="mr-2 size-4" /> New Template
          </Button>
        }
      />

      <div className="flex flex-1 overflow-hidden border rounded-xl bg-card">
        {/* Left Sidebar: Modules */}
        <div className="w-64 border-r bg-muted/30 overflow-y-auto">
          <div className="p-3 font-semibold text-sm border-b">Module</div>
          <div className="p-2 space-y-1">
            {MODULES.map((mod) => (
              <button
                key={mod.id}
                onClick={() => setActiveModule(mod.id)}
                className={cn(
                  "w-full flex items-center px-3 py-2.5 text-sm rounded-md transition-colors text-left",
                  activeModule === mod.id
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {mod.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Area: Templates Grid */}
        <div className="flex-1 overflow-y-auto bg-muted/10 p-6">
          <div className="font-semibold text-sm mb-4">Templates</div>
          
          {templates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
              No templates found for this module.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {templates.map((tpl) => (
                <div key={tpl.id} className="group flex flex-col">
                  {/* Template Card */}
                  <Card className="relative overflow-hidden aspect-[1/1.4] flex flex-col bg-white">
                    {tpl.isDefault && (
                      <div className="absolute top-4 -left-8 -rotate-45 bg-emerald-500 text-white text-[10px] font-bold py-1 w-32 text-center shadow-sm z-10">
                        DEFAULT
                      </div>
                    )}
                    
                    <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-8 w-8 bg-blue-600 hover:bg-blue-700 shadow-sm text-white outline-none focus:outline-none focus:ring-0">
                          <MoreVertical className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => router.push(`/settings/document-templates/${tpl.id}/edit`)}>
                            <Pencil className="mr-2 size-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="mr-2 size-4" /> Clone
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <UserPlus className="mr-2 size-4" /> Assign User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <CardContent className="p-0 flex-1 flex flex-col">
                      <div className="flex-1 bg-muted/20 flex items-center justify-center p-4">
                         {/* Placeholder for template thumbnail */}
                         <div className="w-full h-full border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground/50">
                           <LayoutTemplate className="size-12 mb-2 stroke-[1]" />
                           <span className="text-xs">Preview</span>
                         </div>
                      </div>
                      
                      {!tpl.isDefault && (
                        <div className="p-3 border-t bg-muted/10 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="default" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-8 text-xs">
                            MAKE DEFAULT
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* Template Name & Status */}
                  <div className="mt-2 flex items-center justify-between px-1">
                    <span className="text-sm font-medium text-foreground truncate">{tpl.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
