import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { isAIAuthoringReady } from "@/lib/ai-authoring/runtime";
import { AiStudioHub } from "@/components/admin/ai-studio/ai-studio-hub";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminAiStudioPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return <AiStudioHub configured={await isAIAuthoringReady()} />;
}
