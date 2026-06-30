"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { TaskComment, Profile } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface TaskCommentsProps {
  taskId: string;
}

export function TaskCommentsSection({ taskId }: TaskCommentsProps) {
  const supabase = createClient();
  const { user } = useAuth();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [taskId]);

  async function fetchComments() {
    setLoading(true);
    const { data, error } = await supabase
      .from("task_comments")
      .select("*, user:profiles(*)")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setComments(data as TaskComment[]);
    }
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim() || !user) return;

    setSubmitting(true);
    const { error } = await supabase
      .from("task_comments")
      .insert({
        task_id: taskId,
        user_id: user.id,
        content: newComment.trim(),
      });

    if (error) {
      toast.error("Failed to post comment");
    } else {
      setNewComment("");
      fetchComments();
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <MessageSquare className="size-5 text-muted-foreground" />
        Comments
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading comments...
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <Avatar className="size-8 mt-1">
                <AvatarImage src={comment.user?.avatar_url || ""} />
                <AvatarFallback>
                  {comment.user?.full_name?.charAt(0) || comment.user?.email?.charAt(0) || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 bg-muted/50 border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">
                    {comment.user?.full_name || comment.user?.email || "Unknown User"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}

          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
              No comments yet. Start the conversation!
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-start gap-3 mt-4">
        <Avatar className="size-8 mt-1 shrink-0">
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="min-h-[80px] bg-card resize-none"
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !newComment.trim()} size="sm">
              {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : <Send className="size-4 mr-2" />}
              Post Comment
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
