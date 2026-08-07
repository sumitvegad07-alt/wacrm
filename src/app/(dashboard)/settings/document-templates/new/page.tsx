import { DocumentTemplateEditor } from "@/components/settings/document-templates/document-template-editor";

export default function NewDocumentTemplatePage({
  searchParams,
}: {
  searchParams: { module?: string };
}) {
  return <DocumentTemplateEditor moduleParam={searchParams.module} />;
}
