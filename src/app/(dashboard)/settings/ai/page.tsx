import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Trash, Plus, FileText, CheckCircle2, AlertCircle } from 'lucide-react'
import { saveBotSettings, addKnowledgeDocument, deleteKnowledgeDocument } from './actions'

export const metadata = { title: 'AI Assistant' }

export default async function AISettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user?.id).single()

  // 1. Fetch Bot Settings
  const { data: settings } = await supabase
    .from('bot_settings')
    .select('*')
    .eq('account_id', profile?.account_id)
    .maybeSingle()

  // 2. Fetch Knowledge Base Docs
  const { data: documents } = await supabase
    .from('kb_documents')
    .select('*, chunks:kb_chunks(count)')
    .eq('account_id', profile?.account_id)
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Assistant Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure your AI Assistant and Knowledge Base. When active, the bot will auto-reply to users based on the documents you upload.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* SETTINGS CARD */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Assistant Configuration</CardTitle>
            <CardDescription>Adjust how the AI behaves and when it hands off to a human.</CardDescription>
          </CardHeader>
          <form action={saveBotSettings}>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch 
                  id="is_active" 
                  name="is_active" 
                  defaultChecked={settings?.is_active ?? false} 
                />
                <Label htmlFor="is_active">Enable AI Auto-Responder</Label>
              </div>

              <div className="space-y-1">
                <Label htmlFor="bot_name">Bot Name</Label>
                <Input 
                  id="bot_name" 
                  name="bot_name" 
                  defaultValue={settings?.bot_name ?? 'Assistant'} 
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="handoff_message">Handoff Message</Label>
                <p className="text-xs text-muted-foreground">The message sent when the bot encounters a question it cannot answer from the knowledge base.</p>
                <Input 
                  id="handoff_message" 
                  name="handoff_message" 
                  defaultValue={settings?.handoff_message ?? 'I am unable to answer that right now, let me connect you with a human agent.'} 
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <p className="text-xs text-muted-foreground">The core instructions for the LLM. Keep it strict so it does not hallucinate.</p>
                <Textarea 
                  id="system_prompt" 
                  name="system_prompt" 
                  rows={4}
                  defaultValue={settings?.system_prompt ?? 'You are a helpful customer support assistant. Answer the user\'s question based ONLY on the provided context. If the answer is not in the context, reply with the exact word: HANDOFF.'} 
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit">Save Settings</Button>
            </CardFooter>
          </form>
        </Card>

        {/* DOCUMENTS LIST */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Knowledge Base</CardTitle>
            <CardDescription>Your uploaded documents.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {documents?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No documents uploaded yet.</p>
            ) : (
              <ul className="space-y-3">
                {documents?.map((doc) => (
                  <li key={doc.id} className="flex items-start justify-between p-3 border rounded-md">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-blue-500" />
                        <span className="font-medium text-sm">{doc.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {doc.status === 'ready' ? (
                          <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3" /> Ready</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600"><AlertCircle className="size-3" /> Failed</span>
                        )}
                        <span>• {doc.chunks[0]?.count ?? 0} chunks</span>
                      </div>
                    </div>
                    <form action={deleteKnowledgeDocument.bind(null, doc.id)}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"><Trash className="size-4" /></Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* UPLOAD FORM */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Add New Source</CardTitle>
            <CardDescription>Paste raw text to ingest into the vector store.</CardDescription>
          </CardHeader>
          <form action={addKnowledgeDocument}>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required placeholder="e.g. Return Policy" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="content">Raw Text Content</Label>
                <Textarea 
                  id="content" 
                  name="content" 
                  required 
                  rows={6} 
                  placeholder="Paste the text here..." 
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full">
                <Plus className="size-4 mr-2" /> Ingest Text
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
