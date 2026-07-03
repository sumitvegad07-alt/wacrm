'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash, Plus, FileText, CheckCircle2, AlertCircle, Loader2, Link2, Video, FileUp } from 'lucide-react';
import { saveBotSettings, addKnowledgeDocument, deleteKnowledgeDocument } from '@/app/(dashboard)/settings/ai/actions';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { EditDocumentModal } from './edit-document-modal';

export function AISettingsPanel() {
  const { accountId } = useAuth();
  const [settings, setSettings] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAI = async () => {
    if (!accountId) return;
    const supabase = createClient();
    
    const { data: s } = await supabase
      .from('bot_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    
    const { data: docs } = await supabase
      .from('kb_documents')
      .select('*, chunks:kb_chunks(count)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    setSettings(s);
    setDocuments(docs || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAI();
  }, [accountId]);

  const handleSaveSettings = async (formData: FormData) => {
    try {
      await saveBotSettings(formData);
      toast.success('Settings saved successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to save settings');
    }
  };

  const handleAddDocument = async (formData: FormData) => {
    try {
      await addKnowledgeDocument(formData);
      toast.success('Document ingested successfully');
      (document.getElementById('add-doc-form') as HTMLFormElement)?.reset();
      fetchAI();
    } catch (error: any) {
      toast.error(error.message || 'Failed to ingest document');
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteKnowledgeDocument(id);
      toast.success('Document deleted');
      fetchAI();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete document');
    }
  };

  if (loading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

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
          <form action={handleSaveSettings}>
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
                <Label htmlFor="gemini_api_key">Gemini API Key</Label>
                <p className="text-xs text-muted-foreground">Get a free key from Google AI Studio.</p>
                <Input 
                  id="gemini_api_key" 
                  name="gemini_api_key" 
                  type="password"
                  placeholder="AIzaSy..."
                  defaultValue={settings?.gemini_api_key ?? ''} 
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <p className="text-xs text-muted-foreground">The core instructions for the LLM. Keep it strict so it does not hallucinate.</p>
                <Textarea 
                  id="system_prompt" 
                  name="system_prompt" 
                  rows={4}
                  defaultValue={settings?.system_prompt ?? 'You are a helpful, polite, and conversational customer support assistant. Start with a friendly greeting when appropriate. Synthesize the answer naturally based ONLY on the provided context, rather than copy-pasting raw text. If the answer is not in the context, reply with the exact word: HANDOFF.'} 
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
                    <div className="flex items-center gap-1">
                      <EditDocumentModal document={doc} onSuccess={fetchAI} />
                      <form action={() => handleDeleteDocument(doc.id)}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"><Trash className="size-4" /></Button>
                      </form>
                    </div>
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
            <CardDescription>Provide a source to ingest into the vector store.</CardDescription>
          </CardHeader>
          <Tabs defaultValue="text" className="w-full">
            <div className="px-6">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="text"><FileText className="size-4" /></TabsTrigger>
                <TabsTrigger value="url"><Link2 className="size-4" /></TabsTrigger>
                <TabsTrigger value="youtube"><Video className="size-4" /></TabsTrigger>
                <TabsTrigger value="file"><FileUp className="size-4" /></TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="text">
              <form action={handleAddDocument}>
                <input type="hidden" name="source_type" value="text" />
                <CardContent className="space-y-4 mt-4">
                  <div className="space-y-1">
                    <Label htmlFor="title-text">Title</Label>
                    <Input id="title-text" name="title" required placeholder="e.g. Return Policy" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="content">Raw Text Content</Label>
                    <Textarea id="content" name="content" required rows={6} placeholder="Paste the text here..." />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    <Plus className="size-4 mr-2" /> Ingest Text
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            <TabsContent value="url">
              <form action={handleAddDocument}>
                <input type="hidden" name="source_type" value="url" />
                <CardContent className="space-y-4 mt-4">
                  <div className="space-y-1">
                    <Label htmlFor="title-url">Title</Label>
                    <Input id="title-url" name="title" required placeholder="e.g. Homepage" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="url">Website URL</Label>
                    <Input id="url" name="url" type="url" required placeholder="https://example.com" />
                  </div>
                  <p className="text-xs text-muted-foreground">The bot will scrape the readable text from this webpage.</p>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    <Plus className="size-4 mr-2" /> Ingest URL
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            <TabsContent value="youtube">
              <form action={handleAddDocument}>
                <input type="hidden" name="source_type" value="youtube" />
                <CardContent className="space-y-4 mt-4">
                  <div className="space-y-1">
                    <Label htmlFor="title-yt">Title</Label>
                    <Input id="title-yt" name="title" required placeholder="e.g. Product Demo" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="youtube_url">YouTube URL</Label>
                    <Input id="youtube_url" name="youtube_url" type="url" required placeholder="https://youtube.com/watch?v=..." />
                  </div>
                  <p className="text-xs text-muted-foreground">The bot will download and index the video's captions/transcript.</p>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    <Plus className="size-4 mr-2" /> Ingest YouTube
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            <TabsContent value="file">
              <form action={handleAddDocument}>
                <input type="hidden" name="source_type" value="file" />
                <CardContent className="space-y-4 mt-4">
                  <div className="space-y-1">
                    <Label htmlFor="title-file">Title</Label>
                    <Input id="title-file" name="title" required placeholder="e.g. Training Manual" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="file">File (PDF, Word, Text)</Label>
                    <Input id="file" name="file" type="file" accept=".pdf,.doc,.docx,.txt" required />
                  </div>
                  <p className="text-xs text-muted-foreground">The bot will extract text from the uploaded document.</p>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    <Plus className="size-4 mr-2" /> Ingest File
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  )
}
