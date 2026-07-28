"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Trash2, Edit2, Loader2, GripVertical, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { useAuth } from "@/hooks/use-auth";

export function DealPipelinesSettings() {
  const supabase = createClient();
  const { account } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const fetchPipelines = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .eq("account_id", account.id)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Failed to load deal pipelines");
      setLoading(false);
      return;
    }

    setPipelines(data || []);
    if (data && data.length > 0) {
      if (!selectedPipeline || !data.some(p => p.id === selectedPipeline.id)) {
        setSelectedPipeline(data[0]);
      }
    } else {
      setSelectedPipeline(null);
    }
    setLoading(false);
  }, [account?.id, supabase, selectedPipeline]);

  const fetchStages = useCallback(async () => {
    if (!selectedPipeline) {
      setStages([]);
      return;
    }
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", selectedPipeline.id)
      .order("position", { ascending: true });

    if (error) {
      toast.error("Failed to load stages");
      return;
    }
    setStages(data || []);
  }, [selectedPipeline, supabase]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    fetchStages();
  }, [fetchStages]);

  const handleCreatePipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPipelineName.trim() || !account?.id) return;

    setCreatingPipeline(true);
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) {
      setCreatingPipeline(false);
      return;
    }

    const { data: newPipeline, error } = await supabase
      .from("pipelines")
      .insert({
        account_id: account.id,
        user_id: user.user.id,
        name: newPipelineName.trim(),
        is_default: pipelines.length === 0,
      })
      .select()
      .single();

    if (error || !newPipeline) {
      toast.error("Failed to create pipeline");
      setCreatingPipeline(false);
      return;
    }

    // Default stages for the new pipeline
    const defaultStages = [
      { name: "New Lead", color: "#3b82f6", position: 0 },
      { name: "Contacted", color: "#6366f1", position: 1 },
      { name: "Proposal Sent", color: "#eab308", position: 2 },
      { name: "Won", color: "#22c55e", position: 3 },
      { name: "Lost", color: "#f43f5e", position: 4 },
    ].map(s => ({
      ...s,
      pipeline_id: newPipeline.id,
      user_id: user.user?.id,
    }));

    await supabase.from("pipeline_stages").insert(defaultStages);

    toast.success("Deal Pipeline created successfully");
    setNewPipelineName("");
    setCreatingPipeline(false);
    await fetchPipelines();
    setSelectedPipeline(newPipeline);
  };

  const handleDeletePipeline = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the "${name}" pipeline? All deals in this pipeline will be deleted.`)) {
      return;
    }
    const { error } = await supabase.from("pipelines").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete pipeline");
      return;
    }
    toast.success("Pipeline deleted");
    await fetchPipelines();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            Deal Pipelines
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage pipelines and their customizable stages for your deals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Pipeline List & Create Form */}
        <div className="space-y-6 lg:col-span-1 border-r border-border pr-0 lg:pr-6">
          <form onSubmit={handleCreatePipeline} className="space-y-3 bg-card p-4 rounded-lg border border-border shadow-sm">
            <Label htmlFor="newPipeline" className="text-sm font-medium">Add New Pipeline</Label>
            <div className="flex gap-2">
              <Input
                id="newPipeline"
                placeholder="e.g. Enterprise Sales"
                value={newPipelineName}
                onChange={(e) => setNewPipelineName(e.target.value)}
              />
              <Button type="submit" disabled={creatingPipeline || !newPipelineName.trim()}>
                {creatingPipeline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Your Pipelines ({pipelines.length})
            </Label>
            {pipelines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No pipelines found. Create one above.</p>
            ) : (
              <div className="space-y-2">
                {pipelines.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPipeline(p)}
                    className={`flex items-center justify-between p-3 rounded-md cursor-pointer border transition-all ${
                      selectedPipeline?.id === p.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <GitBranch className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium text-sm truncate">{p.name}</span>
                      {p.is_default && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                    </div>
                    {pipelines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePipeline(p.id, p.name);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Selected Pipeline Stages */}
        <div className="lg:col-span-2 space-y-6">
          {selectedPipeline ? (
            <div className="bg-card rounded-lg border border-border p-6 space-y-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span>{selectedPipeline.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {stages.length} Stages
                    </Badge>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Manage the sequence of stages deals progress through in this pipeline.
                  </p>
                </div>
                <Button onClick={() => setSettingsModalOpen(true)} size="sm">
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Stages & Rules
                </Button>
              </div>

              <div className="space-y-3">
                {stages.map((stage, idx) => (
                  <div
                    key={stage.id}
                    className="flex items-center justify-between p-3.5 rounded-md border border-border bg-background"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-6 text-center">#{idx + 1}</span>
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: stage.color || "#3b82f6" }}
                      />
                      <span className="font-medium text-sm">{stage.name}</span>
                    </div>
                  </div>
                ))}
              </div>

              {settingsModalOpen && (
                <PipelineSettings
                  open={settingsModalOpen}
                  onOpenChange={setSettingsModalOpen}
                  pipeline={selectedPipeline}
                  stages={stages}
                  onPipelinesChanged={fetchPipelines}
                  onStagesChanged={fetchStages}
                  onCreateNewPipeline={() => {}}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground">
              <GitBranch className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">Select or create a pipeline to view and edit its stages.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
