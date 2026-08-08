import { DocumentTemplateEditor } from "@/components/settings/document-templates/document-template-editor";

export default async function EditDocumentTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentTemplateEditor templateId={id} />;
}
