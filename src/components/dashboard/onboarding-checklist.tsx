"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, Circle, X, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

export function OnboardingChecklist() {
  const { hasWhatsApp, account, isSuperadmin } = useAuth();
  const [isVisible, setIsVisible] = useState(true);
  const [hasPipeline, setHasPipeline] = useState(false);
  const [hasTemplate, setHasTemplate] = useState(false);

  useEffect(() => {
    async function checkSetup() {
      if (!account?.id) return;
      const supabase = createClient();
      
      // Use maybeSingle or count to check existence. 
      // Pipelines come pre-provisioned usually, but if we want them to *customize* it, maybe we check for deals?
      // Let's just check if pipelines > 0 for now.
      const { count: pipeCount } = await supabase.from('pipelines').select('*', { count: 'exact', head: true }).eq('account_id', account.id);
      const { count: tmplCount } = await supabase.from('message_templates').select('*', { count: 'exact', head: true }).eq('account_id', account.id);
      
      setHasPipeline((pipeCount || 0) > 0);
      setHasTemplate((tmplCount || 0) > 0);
    }
    checkSetup();
  }, [account?.id]);

  // In a real app, these states would be fetched from the DB (e.g., has_created_pipeline, has_created_template)
  // For the sake of this UX update, we'll visually show them as tasks.
  const tasks = [
    { id: "account", label: "Account created", completed: true, href: null },
    { id: "plan", label: "Plan selected", completed: true, href: null },
    { 
      id: "pipeline", 
      label: "Build your first pipeline (2 mins)", 
      completed: hasPipeline, 
      href: "/settings?tab=deals"
    },
    { 
      id: "template", 
      label: "Create your first WhatsApp template (2 mins)", 
      completed: hasTemplate, 
      href: "/settings?tab=templates" 
    },
  ];

  const completedCount = tasks.filter((t) => t.completed).length;
  const progress = Math.round((completedCount / tasks.length) * 100);

  // Hide if superadmin or if they dismissed it locally (or if all completed)
  useEffect(() => {
    const dismissed = localStorage.getItem("wacrm_onboarding_dismissed");
    if (dismissed === "true" || completedCount === tasks.length) {
      setIsVisible(false);
    }
  }, [completedCount, tasks.length]);

  if (!isVisible || isSuperadmin) return null;

  return (
    <Card className="mb-6 border-border bg-card shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-bold text-foreground">
          Welcome to waCRM! Let's get you set up.
        </CardTitle>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => {
            localStorage.setItem("wacrm_onboarding_dismissed", "true");
            setIsVisible(false);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-3">
          <Progress value={progress} className="h-2 flex-1" />
          <span className="text-sm font-medium text-muted-foreground">
            {progress}% Complete
          </span>
        </div>
        
        <div className="grid gap-3 sm:grid-cols-2">
          {tasks.map((task) => (
            <div 
              key={task.id} 
              className={`flex items-center justify-between rounded-lg border p-3 ${
                task.completed 
                  ? "border-primary/20 bg-primary/5" 
                  : "border-border bg-background"
              }`}
            >
              <div className="flex items-center gap-3">
                {task.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
                <span className={`text-sm font-medium ${task.completed ? "text-foreground" : "text-muted-foreground"}`}>
                  {task.label}
                </span>
              </div>
              
              {!task.completed && task.href && (
                <Link href={task.href}>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                    Start <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
