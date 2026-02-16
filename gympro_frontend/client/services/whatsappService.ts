import { ApiService, API_BASE_URL } from "@/services/apiService";

export type WhatsAppChannel = "whatsapp";

export type CampaignHistoryItem = {
  id?: number | string;
  campaign_name?: string;
  campaign_type?: string;
  recipients_count?: number;
  status?: string;
  credits_debited?: number;
  currency?: string;
  created_at?: string;
  [key: string]: any;
};

export type CampaignTypeItem = {
  id?: number | string;
  campaign_code: string;
  campaign_name: string;
  display_order?: number;
  status?: string;
  created_at?: string;
  [key: string]: any;
};

export type WhatsAppTemplateItem = {
  id?: number | string;
  message_id?: number | string;
  template_name?: string;
  category_code?: string;
  variable_count?: number | string;
  variable_values?: string;
  api_url?: string;
  api_key?: string;
  media_required?: string;
  message_content?: string;
  status?: string;
  created_at?: string;
  [key: string]: any;
};

export type SendCampaignRequest = {
  accountCode: string;
  retailCode: string;
  channel?: WhatsAppChannel;
  campaignName: string;
  campaignType?: string | null;
  recipientsCount: number;
  attachmentType?: string | null;
  scheduleMode?: string | null;
  scheduleAt?: string | Date | null;
  // Template Details
  templateId?: string | number | null;
  templateName?: string | null;
  templateVariables?: Record<string, string> | null;
  mediaFileUrl?: string | null;
  // Customer Details
  customers?: any[] | null;
};

export type UploadMediaResponse = {
  success?: boolean;
  message?: string;
  filename?: string;
  file_url?: string;
  image_url?: string;
  [key: string]: any;
};

const toNumberOrNull = (v: any): number | null => {
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

const pick = <T>(...candidates: any[]): T | undefined => {
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c as T;
  }
  return undefined;
};

export class WhatsAppService {
  static channel: WhatsAppChannel = "whatsapp";

  static async getCampaignTypes(params?: { status?: string }): Promise<CampaignTypeItem[]> {
    const qp = new URLSearchParams();
    qp.set("status", String(params?.status ?? "ACTIVE"));
    const res: any = await ApiService.get(`/whatsapp-campaign-types?${qp.toString()}`);
    const items = pick<any[]>(res?.items, res?.data?.items, []);
    const rows = Array.isArray(items) ? (items as CampaignTypeItem[]) : [];
    const getOrder = (x: any) => {
      const raw = pick<any>(x?.display_order, x?.displayOrder, x?.displayorder);
      const n = raw === null || raw === undefined ? NaN : Number(raw);
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    };

    return rows.slice().sort((a, b) => {
      const ao = getOrder(a);
      const bo = getOrder(b);
      if (ao !== bo) return ao - bo;
      return String(a?.campaign_name ?? "").localeCompare(String(b?.campaign_name ?? ""));
    });
  }

  static async getTemplates(params?: { status?: string; categoryCode?: string }): Promise<WhatsAppTemplateItem[]> {
    const qp = new URLSearchParams();
    qp.set("status", String(params?.status ?? "ACTIVE"));
    const categoryCode = String(params?.categoryCode ?? "").trim();
    if (categoryCode) qp.set("category_code", categoryCode);

    const res: any = await ApiService.get(`/whatsapp-templates?${qp.toString()}`);
    const items = pick<any[]>(res?.items, res?.data?.items, []);
    return Array.isArray(items) ? (items as WhatsAppTemplateItem[]) : [];
  }

  static async sendCampaign(req: SendCampaignRequest): Promise<any> {
    const scheduleAt = req.scheduleAt
      ? (req.scheduleAt instanceof Date ? req.scheduleAt.toISOString() : String(req.scheduleAt))
      : null;

    return ApiService.post("/whatsapp-campaigns/send", {
      account_code: String(req.accountCode),
      retail_code: String(req.retailCode),
      channel: String(req.channel || WhatsAppService.channel),
      campaign_name: String(req.campaignName),
      campaign_type: req.campaignType ?? null,
      recipients_count: Number(req.recipientsCount),
      attachment_type: req.attachmentType ?? null,
      schedule_mode: req.scheduleMode ?? null,
      schedule_at: scheduleAt,
      // Extended details
      template_id: req.templateId === null || req.templateId === undefined || req.templateId === "" ? null : String(req.templateId),
      template_name: req.templateName ?? null,
      template_variables: req.templateVariables ?? null,
      media_file_url: req.mediaFileUrl ?? null,
      customers: req.customers ?? [],
    });
  }

  static async uploadCampaignMedia(params: {
    accountCode: string;
    retailCode: string;
    file: File;
  }): Promise<UploadMediaResponse> {
    const form = new FormData();
    form.append("file", params.file);

    const url = `${API_BASE_URL}/upload-image/`;
    const resp = await ApiService.fetchWithAuth(url, {
      method: "POST",
      body: form,
    });
    return ApiService.handleResponse<UploadMediaResponse>(resp);
  }

  static async getCampaignHistory(params: {
    accountCode: string;
    retailCode: string;
    channel?: WhatsAppChannel;
    limit?: number;
  }): Promise<CampaignHistoryItem[]> {
    const qp = new URLSearchParams();
    qp.set("account_code", String(params.accountCode));
    qp.set("retail_code", String(params.retailCode));
    qp.set("channel", String(params.channel || WhatsAppService.channel));
    qp.set("limit", String(params.limit ?? 50));

    const res: any = await ApiService.get(`/campaign-history?${qp.toString()}`);
    const items = pick<any[]>(res?.items, res?.data?.items, []);
    return Array.isArray(items) ? (items as CampaignHistoryItem[]) : [];
  }
}

export default WhatsAppService;
