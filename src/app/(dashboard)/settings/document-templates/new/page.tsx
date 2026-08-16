import { DocumentTemplateEditor } from "@/components/settings/document-templates/document-template-editor";

export default async function NewDocumentTemplatePage({
  searchParams,
}: {
  // Next 15+ passes searchParams as a promise; reading it synchronously throws at runtime.
  searchParams: Promise<{ module?: string }>;
}) {
  const { module } = await searchParams;
  return <DocumentTemplateEditor moduleParam={module} />;
}
