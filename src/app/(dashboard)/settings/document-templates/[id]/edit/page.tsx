import { DocumentTemplateEditor } from "@/components/settings/document-templates/document-template-editor";

export default function EditDocumentTemplatePage({
  params,
}: {
  params: { id: string };
}) {
  return <DocumentTemplateEditor templateId={params.id} />;
}
