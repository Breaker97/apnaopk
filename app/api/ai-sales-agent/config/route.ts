import { getSettings } from "@/models";
import { successResponse } from "@/lib/api/response";
import {
  normalizeAISalesAgentSettings,
  toPublicAISalesAgentConfig,
} from "@/lib/ai-sales-agent/settings";
import { withApi } from "@/lib/api/handler";

export const GET = withApi(
  {},
  async () => {
    const settings = await getSettings();
    const aiSettings = normalizeAISalesAgentSettings(settings.aiSalesAgent);
    return successResponse(
      toPublicAISalesAgentConfig(aiSettings, {
        faviconUrl: settings.general?.faviconUrl,
        aiAuthoring: settings.aiAuthoring,
      }),
    );
  },
);
