import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  CalendarClock,
  Check,
  Loader2,
  ListChecks,
  PhoneCall,
  Send,
  Wallet,
  X,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CustomerService } from "@/services/customerService";
import { ApiService } from "@/services/apiService";
import WhatsAppService from "@/services/whatsappService";
import { useToast } from "@/hooks/use-toast";

// Types
type CampaignTypeRow = {
  id?: number | string;
  campaign_code: string;
  campaign_name: string;
  display_order?: number;
  status?: string;
};

type WhatsAppTemplateRow = {
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
};

type Step = 0 | 1 | 2 | 3 | 4;

interface CampaignCustomer { id: string; name: string; phone?: string; gender?: string; last_visit?: string | null; service_category?: string; category_id?: string; }

type BillingTransitionRow = {
  invoice_id?: string | number;
  txn_invoice_id?: string | number;
  id?: string | number;
  customer_id?: string | number;
  txn_customer_id?: string | number;
  billing_customer_id?: string | number;
  cust_id?: string | number;
  txn_customer_name?: string;
  customer_name?: string;
  customer_mobile?: string;
  txn_customer_mobile?: string;
  customer_phone?: string;
  customer_number?: string;
  txn_created_at?: string;
  created_at?: string;
  last_created_at?: string;
  date?: string;
  grand_total?: string | number;
  total_amount?: string | number;
  net_amount?: string | number;
  amount?: string | number;
  [key: string]: any;
};

function RequiredAsterisk() {
  return (
    <span aria-hidden="true" className="ml-1 text-rose-600">
      *
    </span>
  );
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Label>
      <span>{children}</span>
      {required ? <RequiredAsterisk /> : null}
    </Label>
  );
}

function WhatsAppLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 21c4.97 0 9-3.806 9-8.5S16.97 4 12 4 3 7.806 3 12.5c0 1.556.45 3.02 1.235 4.28L3.5 20.5l4.02-.98C8.86 20.46 10.38 21 12 21Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 10.15c.15-.42.37-.55.78-.55h.43c.16 0 .38.02.5.3l.66 1.55c.1.23.08.42-.06.62l-.34.48c-.12.16-.1.36.05.5.5.49 1.13.96 1.88 1.26.18.07.38.02.5-.13l.42-.52c.18-.22.42-.28.66-.18l1.4.58c.3.12.36.33.33.6-.07.68-.76 1.4-1.47 1.54-.38.07-.88.12-1.85-.26-1.19-.47-2.49-1.56-3.44-2.82-.63-.83-1.15-1.91-1.15-2.91 0-.9.46-1.67.7-2.06Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MetaLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M16.924 5.574c-2.614 0-4.73 1.706-5.918 4.234l-1.077 2.292c-.675 1.439-1.637 2.149-2.85 2.149-1.892 0-3.14-1.39-3.14-3.5 0-2.108 1.298-3.486 3.16-3.486 1.139 0 2.035.539 2.508 1.487l.218.441a.573.573 0 0 0 1.025-.51l-.216-.438C10.05 7.108 8.682 6.2 6.94 6.2c-2.486 0-4.306 1.848-4.306 4.548 0 2.701 1.737 4.659 4.286 4.659 1.638 0 3.012-.909 3.92-2.842l1.076-2.29c.772-1.643 1.83-2.58 3.23-2.58 1.957 0 3.248 1.438 3.248 3.596 0 2.155-1.353 3.558-3.322 3.558-1.096 0-2.022-.574-2.532-1.564l-.177-.358a.571.571 0 0 0-1.026.509l.178.358c.706 1.372 2.008 2.213 3.557 2.213 2.614 0 4.468-1.848 4.468-4.716 0-2.866-1.789-4.717-4.436-4.717z"/>
    </svg>
  );
}

export default function WhatsAppCampaignWizard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [accountMasterRow, setAccountMasterRow] = useState<any | null>(null);

  const businessName = useMemo(() => {
    const r = accountMasterRow;
    if (!r) return "";
    const v =
      r.account_name ??
      r.accountName ??
      r.company_name ??
      r.companyName ??
      r.business_name ??
      r.businessName ??
      r.AccountName ??
      r.CompanyName ??
      r.BusinessName ??
      r.name ??
      r.Name;
    return String(v ?? "").trim();
  }, [accountMasterRow]);

  const businessPhone = useMemo(() => {
    const r = accountMasterRow;
    if (!r) return "";
    const v =
      r.phone1 ??
      r.phone ??
      r.phone_number ??
      r.mobile ??
      r.contact_no ??
      r.contact ??
      r.Phone1 ??
      r.Phone ??
      r.PhoneNumber ??
      r.Mobile ??
      r.ContactNo;
    return String(v ?? "").trim();
  }, [accountMasterRow]);

  type TemplateMediaState = {
    mode?: "upload" | "url";
    file_url?: string;
    filename?: string;
    url?: string;
    preview_url?: string;
  };

  const FASTSMS_INVALID_IMAGE_MESSAGE =
    "Image is invalid. Please check the image properties; supported are JPG/JPEG, RGB/RGBA, 8 bit/channels and PNG, RGB/RGBA, up to 8 bit/channel.";

  const readAsArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
    if (typeof file.arrayBuffer === "function") return await file.arrayBuffer();
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Failed to read file"));
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.readAsArrayBuffer(file);
    });
  };

  const validateFastSmsImageFile = async (file: File): Promise<{ ok: boolean; reason?: string }> => {
    const mime = String(file.type || "").toLowerCase();
    if (mime !== "image/jpeg" && mime !== "image/jpg" && mime !== "image/png") {
      return { ok: false, reason: "unsupported-mime" };
    }

    const buf = new Uint8Array(await readAsArrayBuffer(file));
    if (buf.length < 16) return { ok: false, reason: "too-small" };

    // PNG: validate IHDR bit depth + color type
    const isPng =
      buf.length >= 26 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a;

    if (isPng) {
      // Expect IHDR first
      if (
        buf.length < 33 ||
        buf[12] !== 0x49 ||
        buf[13] !== 0x48 ||
        buf[14] !== 0x44 ||
        buf[15] !== 0x52
      ) {
        return { ok: false, reason: "png-missing-ihdr" };
      }

      const bitDepth = buf[24];
      const colorType = buf[25];
      const okColor = colorType === 2 || colorType === 6; // RGB or RGBA
      const okDepth = bitDepth > 0 && bitDepth <= 8;
      if (!okColor || !okDepth) {
        return { ok: false, reason: `png-unsupported(bitDepth=${bitDepth},colorType=${colorType})` };
      }
      return { ok: true };
    }

    // JPEG: validate SOF precision/components
    const isJpeg = buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8;
    if (!isJpeg) return { ok: false, reason: "not-jpeg-or-png" };

    let i = 2;
    const len = buf.length;
    const isSofMarker = (m: number) => {
      if (m < 0xc0 || m > 0xcf) return false;
      // Exclude: DHT (C4), JPG (C8), DAC (CC)
      if (m === 0xc4 || m === 0xc8 || m === 0xcc) return false;
      return true;
    };

    while (i + 1 < len) {
      // Seek next marker 0xFF
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }

      // Skip fill bytes
      while (i < len && buf[i] === 0xff) i += 1;
      if (i >= len) break;
      const marker = buf[i];
      i += 1;

      // Standalone markers
      if (marker === 0xd9) break; // EOI
      if (marker === 0xda) break; // SOS (start of scan)
      if (marker >= 0xd0 && marker <= 0xd7) continue; // RST
      if (marker === 0x01) continue; // TEM

      if (i + 1 >= len) break;
      const segLen = (buf[i] << 8) | buf[i + 1];
      if (segLen < 2) return { ok: false, reason: "jpeg-bad-seglen" };
      const segStart = i + 2;
      const segEnd = i + segLen;
      if (segEnd > len) return { ok: false, reason: "jpeg-truncated" };

      if (isSofMarker(marker)) {
        if (segStart + 5 >= segEnd) return { ok: false, reason: "jpeg-sof-too-short" };
        const precision = buf[segStart];
        const components = buf[segStart + 5];
        if (precision !== 8) {
          return { ok: false, reason: `jpeg-precision(${precision})` };
        }
        // FastSMS accepts RGB; reject CMYK/YCCK (often 4 components)
        if (components !== 3) {
          return { ok: false, reason: `jpeg-components(${components})` };
        }
        return { ok: true };
      }

      i = segEnd;
    }

    return { ok: false, reason: "jpeg-missing-sof" };
  };

  const extractTemplateVariables = (content: string): string[] => {
    const text = String(content || "");
    const re = /\{([^{}]+)\}/g;
    const seenByLower = new Map<string, string>();

    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = re.exec(text)) !== null) {
      const raw = String(match[1] ?? "").trim();
      if (!raw) continue;

      // Accept formats like: Var1, Customer_Name, wallet_amount, Business_Phone
      // Reject anything with spaces/special chars to avoid false positives.
      if (!/^Var\d+$/i.test(raw) && !/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) continue;

      const normalized = /^Var\d+$/i.test(raw) ? `Var${Number(String(raw).slice(3))}` : raw;
      const lower = normalized.toLowerCase();
      if (!seenByLower.has(lower)) seenByLower.set(lower, normalized);
    }

    // Preserve first-seen order to match template variable_values ordering.
    return Array.from(seenByLower.values());
  };

  const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const restoringDraftRef = useRef(false);

  // Stepper state
  const [step, setStep] = useState<Step>(0);

  const stepStorageKey = useMemo(() => {
    const acc = String(user?.account_code ?? "");
    const ret = String(user?.retail_code ?? "");
    return `waCampaignWizardStep:${acc}:${ret}`;
  }, [user?.account_code, user?.retail_code]);

  const draftStorageKey = useMemo(() => {
    const acc = String(user?.account_code ?? "");
    const ret = String(user?.retail_code ?? "");
    return `waCampaignWizardDraft:${acc}:${ret}`;
  }, [user?.account_code, user?.retail_code]);

  // Basics
  const [campaignName, setCampaignName] = useState("");
  const [campaignType, setCampaignType] = useState<string>("");
  const channel: "whatsapp" = "whatsapp";

  const [campaignTypes, setCampaignTypes] = useState<CampaignTypeRow[]>([]);
  const [campaignTypesLoading, setCampaignTypesLoading] = useState(false);
  const [campaignTypeOpen, setCampaignTypeOpen] = useState(false);

  const generateAutoCampaignName = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const typeStr = campaignType ? (campaignTypes.find(c => c.campaign_code === campaignType)?.campaign_name || "Offer") : "Campaign";
    // E.g. "Seasonal Offer - 30 Jan 14:30" or just "Campaign - 30 Jan 14:30"
    setCampaignName(`${typeStr} - ${dateStr} ${timeStr}`);
  };

  const selectedCampaignTypeLabel = useMemo(() => {
    const v = String(campaignType || "").trim().toLowerCase();
    if (!v) return "";
    const found = campaignTypes.find((c) => String(c.campaign_code || "").trim().toLowerCase() === v);
    return found?.campaign_name || "";
  }, [campaignType, campaignTypes]);

  const CampaignTypeCombobox = ({ buttonClassName }: { buttonClassName?: string }) => (
    <Popover open={campaignTypeOpen} onOpenChange={setCampaignTypeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={campaignTypeOpen}
          className={cn("w-full justify-between font-normal", buttonClassName)}
        >
          <span className={cn("truncate", !selectedCampaignTypeLabel ? "text-muted-foreground" : "text-foreground")}>
            {selectedCampaignTypeLabel || "Choose campaign type"}
          </span>
          <ArrowUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search campaign type..." className="h-9" />
          <CommandList>
            {campaignTypesLoading ? (
              <CommandEmpty>Loading…</CommandEmpty>
            ) : (
              <CommandEmpty>No campaign types found.</CommandEmpty>
            )}
            <CommandGroup>
              {campaignTypes.map((c) => {
                const code = String(c.campaign_code || "");
                const name = String(c.campaign_name || "");
                const selected = String(campaignType || "").toLowerCase() === code.toLowerCase();
                return (
                  <CommandItem
                    key={code}
                    value={`${name} ${code}`}
                    onSelect={() => {
                      setCampaignType(code);
                      setCampaignTypeOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  const [templates, setTemplates] = useState<WhatsAppTemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string>("");
  const [templateVarValuesByTemplateId, setTemplateVarValuesByTemplateId] = useState<Record<string, Record<string, string>>>({});

  const [mediaByTemplateId, setMediaByTemplateId] = useState<Record<string, TemplateMediaState>>({});
  const [mediaUploading, setMediaUploading] = useState(false);

  const mediaObjectUrlsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    return () => {
      try {
        Object.values(mediaObjectUrlsRef.current).forEach((u) => {
          if (u && typeof u === "string" && u.startsWith("blob:")) URL.revokeObjectURL(u);
        });
      } catch {
        // no-op
      }
    };
  }, []);

  // Audience
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [gender, setGender] = useState<"" | "all" | "male" | "female">("all");
  const [genderOpen, setGenderOpen] = useState(false);
  const [lastVisitRangePreset, setLastVisitRangePreset] = useState<"" | "all" | "30" | "45" | "60" | "90" | "custom">("45");
  const [lastVisitOpen, setLastVisitOpen] = useState(false);
  const [visitSegment, setVisitSegment] = useState<"all" | "visit" | "nonvisit">("nonvisit");
  const [visitSegmentOpen, setVisitSegmentOpen] = useState(false);
  const [lastVisitFrom, setLastVisitFrom] = useState<string>("");
  const [lastVisitTo, setLastVisitTo] = useState<string>("");
  const [customers, setCustomers] = useState<CampaignCustomer[]>([]);
  const [billingRows, setBillingRows] = useState<BillingTransitionRow[]>([]);
  const [billingRowsLoading, setBillingRowsLoading] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");

  const [customerSortKey, setCustomerSortKey] = useState<"name" | "lastVisit" | "lastBill">("name");
  const [customerSortDir, setCustomerSortDir] = useState<"asc" | "desc">("asc");
  const [customerPageSize, setCustomerPageSize] = useState<number>(25);
  const [customerPage, setCustomerPage] = useState<number>(1);

  // Credits balance
  const [balance, setBalance] = useState<number | null>(null);

  const fetchBalance = async () => {
    try {
      const res: any = await ApiService.get("/api/credits/balance");
      if (res.success) {
        setBalance(Number(res.balance));
      }
    } catch (error) {
      console.error("Failed to fetch credit balance", error);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.account_code || !user?.retail_code) return;
      try {
        const resp: any = await ApiService.post("/read", {
          tables: ["account_master"],
          account_code: String(user.account_code),
          retail_code: String(user.retail_code),
        });
        const rows = resp?.data;
        const first = Array.isArray(rows) ? rows[0] : rows;
        if (!cancelled) setAccountMasterRow(first || null);
      } catch {
        if (!cancelled) setAccountMasterRow(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.account_code, user?.retail_code]);

  // Message
  const [message, setMessage] = useState("");
  const [ctaType, setCtaType] = useState<"book" | "call" | "offer">("book");
  const [walletAmount, setWalletAmount] = useState("");

  // Delivery
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  const [sending, setSending] = useState(false);

  const clampStep = (n: number): Step => {
    const v = Math.max(0, Math.min(4, Number.isFinite(n) ? n : 0));
    return v as Step;
  };

  // Restore draft (inputs) and step from URL (?step=) or localStorage on first load.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const rawStep = url.searchParams.get("step");

      const rawDraft = window.localStorage.getItem(draftStorageKey);
      let draft: any = null;
      if (rawDraft) {
        try {
          draft = JSON.parse(rawDraft);
        } catch {
          draft = null;
        }
      }

      if (draft && typeof draft === "object") {
        restoringDraftRef.current = true;

        if (typeof draft.campaignName === "string") setCampaignName(draft.campaignName);
        if (typeof draft.campaignType === "string") setCampaignType(draft.campaignType);

        if (typeof draft.gender === "string") setGender(draft.gender as any);
        if (typeof draft.lastVisitRangePreset === "string") setLastVisitRangePreset(draft.lastVisitRangePreset as any);
        if (typeof draft.visitSegment === "string") setVisitSegment(draft.visitSegment as any);
        if (typeof draft.lastVisitFrom === "string") setLastVisitFrom(draft.lastVisitFrom);
        if (typeof draft.lastVisitTo === "string") setLastVisitTo(draft.lastVisitTo);
        if (Array.isArray(draft.selectedCustomerIds)) {
          setSelectedCustomerIds(draft.selectedCustomerIds.map((x: any) => String(x)));
        }

        if (typeof draft.message === "string") setMessage(draft.message);
        if (typeof draft.activeTemplateId === "string") setActiveTemplateId(draft.activeTemplateId);
        if (draft.templateVarValuesByTemplateId && typeof draft.templateVarValuesByTemplateId === "object") {
          setTemplateVarValuesByTemplateId(draft.templateVarValuesByTemplateId);
        }
        if (draft.mediaByTemplateId && typeof draft.mediaByTemplateId === "object") {
          setMediaByTemplateId(draft.mediaByTemplateId);
        }
        if (typeof draft.ctaType === "string") setCtaType(draft.ctaType);
        if (typeof draft.walletAmount === "string") setWalletAmount(draft.walletAmount);
        if (typeof draft.scheduleMode === "string") setScheduleMode(draft.scheduleMode);
        if (typeof draft.scheduleDate === "string") setScheduleDate(draft.scheduleDate);
        if (typeof draft.scheduleTime === "string") setScheduleTime(draft.scheduleTime);
      }

      // Step priority: URL param -> draft.step -> stepStorageKey
      if (rawStep !== null) {
        setStep(clampStep(Number(rawStep)));
        return;
      }

      if (draft && typeof draft.step === "number") {
        setStep(clampStep(Number(draft.step)));
        return;
      }

      const stored = window.localStorage.getItem(stepStorageKey);
      if (stored !== null && stored !== "") {
        setStep(clampStep(Number(stored)));
      }
    } catch {
      // no-op
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey, stepStorageKey]);

  // Persist step changes to URL (?step=) and localStorage.
  useEffect(() => {
    try {
      window.localStorage.setItem(stepStorageKey, String(step));
    } catch {
      // no-op
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("step", String(step));
      window.history.replaceState({}, "", url.toString());
    } catch {
      // no-op
    }
  }, [step, stepStorageKey]);

  // Persist the draft so refresh keeps all entered values (including review/preview).
  useEffect(() => {
    try {
      const draft = {
        step,
        campaignName,
        campaignType,
        gender,
        lastVisitRangePreset,
        visitSegment,
        lastVisitFrom,
        lastVisitTo,
        selectedCustomerIds,
        activeTemplateId,
        templateVarValuesByTemplateId,
        mediaByTemplateId,
        message,
        ctaType,
        walletAmount,
        scheduleMode,
        scheduleDate,
        scheduleTime,
      };
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    } catch {
      // no-op
    }
  }, [
    campaignName,
    campaignType,
    ctaType,
    draftStorageKey,
    gender,
    lastVisitFrom,
    lastVisitRangePreset,
    lastVisitTo,
    message,
    mediaByTemplateId,
    activeTemplateId,
    templateVarValuesByTemplateId,
    scheduleDate,
    scheduleMode,
    scheduleTime,
    selectedCustomerIds,
    step,
    visitSegment,
    walletAmount,
  ]);

  // Load templates from DB for the chosen campaign type
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cat = String(campaignType || "").trim();
      if (!cat) {
        setTemplates([]);
        return;
      }

      setTemplatesLoading(true);
      try {
        const rows = await WhatsAppService.getTemplates({ status: "ACTIVE", categoryCode: cat });
        const normalized: WhatsAppTemplateRow[] = (Array.isArray(rows) ? rows : []).map((r: any) => ({
          id: r?.id,
          message_id: r?.message_id,
          template_name: r?.template_name,
          category_code: r?.category_code,
          variable_count: r?.variable_count,
          variable_values: r?.variable_values,
          api_url: r?.api_url,
          api_key: r?.api_key,
          media_required: r?.media_required,
          message_content: r?.message_content,
          status: r?.status,
          created_at: r?.created_at,
        }));

        if (!cancelled) setTemplates(normalized);
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [campaignType]);

  // Effects
  useEffect(() => {
    if (restoringDraftRef.current) {
      restoringDraftRef.current = false;
      return;
    }
    // Don't auto-fill message content. Campaign type only affects which templates
    // are available in the dropdown.
    setMessage("");
    setWalletAmount("");
    setTemplates([]);
    setActiveTemplateId("");
    setTemplateVarValuesByTemplateId({});
    setMediaByTemplateId({});
  }, [campaignType]);

  // Scheduling is not available yet; always keep it as Send now.
  useEffect(() => {
    if (scheduleMode !== "now") {
      setScheduleMode("now");
      setScheduleDate("");
      setScheduleTime("");
    }
  }, [scheduleMode]);

  // Default to the first template after loading (if none is selected)
  useEffect(() => {
    if (templatesLoading) return;
    if (!templates || templates.length === 0) return;

    const existing = String(activeTemplateId || "");
    const stillExists = existing && templates.some((t) => String(t.id ?? "") === existing);
    if (stillExists) return;

    const first = templates[0];
    const id = String(first?.id ?? "");
    setActiveTemplateId(id);
    setMessage(typeof first?.message_content === "string" ? first.message_content : "");
  }, [activeTemplateId, templates, templatesLoading]);

  // Ensure we have a variable-value map for the selected template.
  useEffect(() => {
    const tid = String(activeTemplateId || "");
    if (!tid) return;
    const t = templates.find((x) => String(x?.id ?? "") === tid);
    const body = typeof t?.message_content === "string" ? t.message_content : message;
    const keys = extractTemplateVariables(body);

    setTemplateVarValuesByTemplateId((prev) => {
      const existing = prev[tid] || {};
      const nextForTemplate: Record<string, string> = {};
      keys.forEach((k) => {
        nextForTemplate[k] = (existing[k] ?? "");
      });

      // Auto-fill business info from account_master when the template uses these variables.
      if (businessName) {
        const k = keys.find((x) => String(x).toLowerCase() === "business_name");
        if (k && !String(nextForTemplate[k] ?? "").trim()) nextForTemplate[k] = businessName;
      }
      if (businessPhone) {
        const k = keys.find((x) => String(x).toLowerCase() === "business_phone");
        if (k && !String(nextForTemplate[k] ?? "").trim()) nextForTemplate[k] = businessPhone;
      }

      // Customer name is derived per-recipient; keep it read-only as {customer_name}.
      {
        const k = keys.find((x) => {
          const lower = String(x).toLowerCase();
          return lower === "customer_name" || lower === "customername";
        });
        if (k) nextForTemplate[k] = "{customer_name}";
      }

      // Preserve other templates' entries.
      return { ...prev, [tid]: nextForTemplate };
    });
  }, [activeTemplateId, businessName, businessPhone, message, templates]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      setCampaignTypesLoading(true);
      try {
        const rows = await WhatsAppService.getCampaignTypes({ status: "ACTIVE" });
        const normalized: CampaignTypeRow[] = (Array.isArray(rows) ? rows : [])
          .map((r: any) => ({
            id: r?.id,
            campaign_code: String(r?.campaign_code ?? r?.campaignCode ?? "").trim(),
            campaign_name: String(r?.campaign_name ?? r?.campaignName ?? "").trim(),
            display_order:
              r?.display_order != null
                ? Number(r.display_order)
                : r?.displayOrder != null
                ? Number(r.displayOrder)
                : r?.displayorder != null
                ? Number(r.displayorder)
                : undefined,
            status: r?.status != null ? String(r.status) : undefined,
          }))
          .filter((r) => r.campaign_code && r.campaign_name);

        if (!cancelled) setCampaignTypes(normalized);
      } catch {
        if (!cancelled) setCampaignTypes([]);
      } finally {
        if (!cancelled) setCampaignTypesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user?.account_code || !user?.retail_code) return;

      if (!lastVisitRangePreset || lastVisitRangePreset === "all") {
        setBillingRows([]);
        setBillingRowsLoading(false);
        return;
      }

      if (!lastVisitRangePreset) {
        setBillingRows([]);
        setBillingRowsLoading(false);
        return;
      }
      const rows: any[] = await CustomerService.getCustomers(user.account_code, user.retail_code);
      const mapped: CampaignCustomer[] = rows.map((c: any) => {
        const id = String(c.customer_id ?? c.id ?? c.CustomerID ?? c.CustID ?? c.master_customer_id ?? "").trim();
        const name = String(c.customer_name ?? c.CustomerName ?? c.name ?? "Unnamed").trim() || "Unnamed";
        const phone = String(
          c.mobile ??
            c.phone ??
            c.phone1 ??
            c.customer_mobile ??
            c.customer_number ??
            c.customer_phone ??
            c.txn_customer_mobile ??
            ""
        ).trim();
        const gender = String(c.gender ?? c.customer_gender ?? "unknown");
        const categoryId = c.category_id !== undefined && c.category_id !== null ? String(c.category_id) : (c.categoryId ? String(c.categoryId) : undefined);

        return {
          id,
          name,
          phone: phone || undefined,
          gender,
          // last_visit is derived from billing-transitions for date filters; keep any existing field as fallback.
          last_visit: c.last_visit_date || c.lastVisit || null,
          service_category: c.preferred_service || c.service_category || "general",
          category_id: categoryId,
          membership_cardno: c.membership_cardno ?? c.membershipCardNo ?? c.membership_no ?? c.membershipNo,
          birthday_date: c.birthday_date ?? c.birth_date ?? c.dob,
          anniversary_date: c.anniversary_date ?? c.anniversary ?? c.anniv_date,
          address: c.address ?? c.customer_address,
          visit_count: c.visit_count ?? c.visitCount,
          credit_pending: c.credit_pending ?? c.creditPending,
        } as any;
      });
      setCustomers(
        mapped.filter((c) => {
          const p = String(c.phone || "").replace(/\D/g, "");
          return p.length >= 10;
        })
      );
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user?.account_code || !user?.retail_code) return;

      // For presets we can safely pull last 90 days once and filter locally.
      // For custom, pull exactly the user-selected range.
      const acc = String(user.account_code);
      const ret = String(user.retail_code);

      const computeFromDays = (days: number) => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d.toISOString().slice(0, 10);
      };

      const customEffectiveFrom = lastVisitRangePreset === "custom" ? (lastVisitFrom ? lastVisitFrom : null) : null;
      const customEffectiveTo = lastVisitRangePreset === "custom" ? (lastVisitTo ? lastVisitTo : null) : null;

      const isCustom = lastVisitRangePreset === "custom";
      const presetDays = !isCustom ? Number(lastVisitRangePreset) : NaN;
      const fromDate = isCustom
        ? (customEffectiveFrom || computeFromDays(365))
        : computeFromDays(Number.isFinite(presetDays) && presetDays > 0 ? presetDays : 30);
      const toDate = isCustom ? (customEffectiveTo || today) : today;

      setBillingRowsLoading(true);
      try {
        const q = new URLSearchParams({
          account_code: acc,
          retail_code: ret,
          from_date: fromDate,
          to_date: toDate,
          limit: "5000",
          sendalldata: "N",
          include_details: "false",
        });

        const resp: any = await ApiService.get(`/billing-transitions?${q.toString()}`);
        const rows: any[] = Array.isArray(resp?.data?.data)
          ? resp.data.data
          : Array.isArray(resp?.data)
          ? resp.data
          : Array.isArray(resp)
          ? resp
          : [];
        setBillingRows(rows as BillingTransitionRow[]);
      } catch (e) {
        // best-effort; allow master_customer-only UI
        setBillingRows([]);
      } finally {
        setBillingRowsLoading(false);
      }
    })();
  }, [user, lastVisitRangePreset, lastVisitFrom, lastVisitTo, today]);

  // Segment only makes sense when a date range is selected; keep it sensible.
  useEffect(() => {
    if (lastVisitRangePreset === "all" || !lastVisitRangePreset) {
      setVisitSegment("all");
    } else if (visitSegment === "all") {
      // Preserve previous behavior (nonvisit) when user selects a range.
      setVisitSegment("nonvisit");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastVisitRangePreset]);

  const effectiveLastVisitRange = useMemo(() => {
    const to = today;
    if (!lastVisitRangePreset || lastVisitRangePreset === "all") {
      return { from: null, to: null } as const;
    }
    if (lastVisitRangePreset === "custom") {
      return {
        from: lastVisitFrom ? lastVisitFrom : null,
        to: lastVisitTo ? lastVisitTo : null,
      } as const;
    }

    const days = Number(lastVisitRangePreset);
    const d = new Date();
    d.setDate(d.getDate() - days);
    const from = d.toISOString().slice(0, 10);
    return { from, to } as const;
  }, [lastVisitFrom, lastVisitRangePreset, lastVisitTo, today]);

  const billingStatsByCustomerId = useMemo(() => {
    const fromStr = effectiveLastVisitRange.from;
    const toStr = effectiveLastVisitRange.to;

    const inRange = (d: string): boolean => {
      if (!d) return false;
      if (fromStr && d < fromStr) return false;
      if (toStr && d > toStr) return false;
      return true;
    };

    const getDate = (r: BillingTransitionRow): string => {
      const raw = r.txn_created_at || r.created_at || r.last_created_at || r.date || "";
      return raw ? String(raw).slice(0, 10) : "";
    };
    const getAmount = (r: BillingTransitionRow): number => {
      const n = Number(r.grand_total ?? r.total_amount ?? r.net_amount ?? r.amount ?? 0);
      return isNaN(n) ? 0 : n;
    };

    const map = new Map<
      string,
      {
        lastVisitDate: string;
        lastInvoiceId?: string;
        lastInvoiceAmount?: number;
        invoiceCount: number;
        totalAmount: number;
      }
    >();

    (billingRows || []).forEach((row) => {
      const custId = String(row.customer_id ?? row.txn_customer_id ?? row.billing_customer_id ?? row.cust_id ?? "").trim();
      if (!custId) return;

      const d = getDate(row);
      if (!inRange(d)) return;

      const invId = String(row.invoice_id ?? row.txn_invoice_id ?? row.id ?? "").trim() || undefined;
      const amt = getAmount(row);

      const prev = map.get(custId);
      if (!prev) {
        map.set(custId, {
          lastVisitDate: d,
          lastInvoiceId: invId,
          lastInvoiceAmount: amt,
          invoiceCount: 1,
          totalAmount: amt,
        });
        return;
      }

      const next = {
        ...prev,
        invoiceCount: prev.invoiceCount + 1,
        totalAmount: prev.totalAmount + amt,
      };

      if (d && (!prev.lastVisitDate || d >= prev.lastVisitDate)) {
        next.lastVisitDate = d;
        next.lastInvoiceId = invId;
        next.lastInvoiceAmount = amt;
      }
      map.set(custId, next);
    });

    return map;
  }, [billingRows, effectiveLastVisitRange.from, effectiveLastVisitRange.to]);

  // Derived
  const filteredCustomers = useMemo(() => {
    let list = [...customers];
    if (gender && gender !== "all") list = list.filter((c) => (c.gender || "").toLowerCase() === gender);
    if (effectiveLastVisitRange.from || effectiveLastVisitRange.to) {
      // Date filtering should follow billing activity (last visit) rather than stale master_customer fields.
      list = list.filter((c) => {
        const id = String(c.id || "").trim();
        if (!id) return false;
        const hasVisit = billingStatsByCustomerId.has(id);
        if (visitSegment === "visit") return hasVisit;
        if (visitSegment === "nonvisit") return !hasVisit;
        return true;
      });
    }
    return list;
  }, [customers, gender, effectiveLastVisitRange.from, effectiveLastVisitRange.to, billingStatsByCustomerId, visitSegment]);

  const visibleCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return filteredCustomers;
    return filteredCustomers.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const phone = String(c.phone || "");
      return name.includes(q) || phone.includes(q);
    });
  }, [customerSearch, filteredCustomers]);

  // Sorting + pagination for customer list
  const sortedCustomers = useMemo(() => {
    const list = [...visibleCustomers];
    const dir = customerSortDir === "desc" ? -1 : 1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    const getLastVisit = (c: CampaignCustomer): string => {
      const bill = billingStatsByCustomerId.get(String(c.id));
      const d = bill?.lastVisitDate || (c.last_visit ? String(c.last_visit).slice(0, 10) : "");
      return d ? String(d).slice(0, 10) : "";
    };
    const getLastBill = (c: CampaignCustomer): number => {
      const bill = billingStatsByCustomerId.get(String(c.id));
      const n = Number(bill?.lastInvoiceAmount ?? 0);
      return Number.isFinite(n) ? n : 0;
    };

    list.sort((a, b) => {
      if (customerSortKey === "name") {
        return dir * collator.compare(String(a.name || ""), String(b.name || ""));
      }
      if (customerSortKey === "lastVisit") {
        const da = getLastVisit(a);
        const db = getLastVisit(b);
        // Put blanks at the end for both directions.
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return dir * collator.compare(da, db);
      }
      // lastBill
      const aa = getLastBill(a);
      const bb = getLastBill(b);
      return dir * (aa === bb ? 0 : aa > bb ? 1 : -1);
    });
    return list;
  }, [billingStatsByCustomerId, customerSortDir, customerSortKey, visibleCustomers]);

  const totalCustomerPages = useMemo(() => {
    const size = Math.max(1, Number(customerPageSize) || 25);
    return Math.max(1, Math.ceil(sortedCustomers.length / size));
  }, [customerPageSize, sortedCustomers.length]);

  useEffect(() => {
    setCustomerPage(1);
  }, [customerSearch, gender, lastVisitRangePreset, visitSegment, lastVisitFrom, lastVisitTo]);

  useEffect(() => {
    setCustomerPage((p) => Math.max(1, Math.min(p, totalCustomerPages)));
  }, [totalCustomerPages]);

  const pagedCustomers = useMemo(() => {
    const size = Math.max(1, Number(customerPageSize) || 25);
    const page = Math.max(1, Number(customerPage) || 1);
    const start = (page - 1) * size;
    return sortedCustomers.slice(start, start + size);
  }, [customerPage, customerPageSize, sortedCustomers]);

  const customerRangeLabel = useMemo(() => {
    const total = sortedCustomers.length;
    if (total === 0) return "0 of 0";
    const size = Math.max(1, Number(customerPageSize) || 25);
    const page = Math.max(1, Number(customerPage) || 1);
    const start = (page - 1) * size + 1;
    const end = Math.min(total, (page - 1) * size + size);
    return `${start}-${end} of ${total}`;
  }, [customerPage, customerPageSize, sortedCustomers.length]);

  const toggleCustomer = (id: string, checked: boolean) => {
    setSelectedCustomerIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  };

  const selectAllVisible = () => {
    const ids = visibleCustomers.map((c) => c.id).filter(Boolean);
    setSelectedCustomerIds((prev) => {
      const set = new Set(prev);
      ids.forEach((id) => set.add(id));
      return Array.from(set);
    });
  };

  const clearSelection = () => setSelectedCustomerIds([]);

  const recipientCount = selectedCustomerIds.length;
  const ctaLabel = ctaType === "call" ? "Call Now" : ctaType === "offer" ? "View Offer" : "Book Now";
  const estimatedCost = useMemo(() => (recipientCount ? `${recipientCount.toLocaleString("en-IN")}` : "-"), [recipientCount]);

  const activeTemplate = useMemo(() => {
    const tid = String(activeTemplateId || "");
    if (!tid) return null;
    return templates.find((t) => String(t?.id ?? "") === tid) || null;
  }, [activeTemplateId, templates]);

  const isActiveTemplateMediaRequired = useMemo(() => {
    const v = String(activeTemplate?.media_required ?? "N").trim().toUpperCase();
    return v === "Y";
  }, [activeTemplate?.media_required]);

  const activeTemplateMedia = useMemo(() => {
    const tid = String(activeTemplateId || "");
    return tid ? (mediaByTemplateId[tid] || null) : null;
  }, [activeTemplateId, mediaByTemplateId]);

  const activeResolvedMediaUrl = useMemo(() => {
    if (!isActiveTemplateMediaRequired) return null;
    const info = activeTemplateMedia || null;
    const mode = info?.mode === "url" ? "url" : "upload";
    if (mode === "url") {
      const u = String(info?.url || "").trim();
      return u || null;
    }
    const f = String(info?.file_url || "").trim();
    return f || null;
  }, [activeTemplateMedia, isActiveTemplateMediaRequired]);

  const activePreviewMediaUrl = useMemo(() => {
    if (!isActiveTemplateMediaRequired) return null;
    const tid = String(activeTemplateId || "");
    const info = tid ? (mediaByTemplateId[tid] || null) : null;
    const u = String(info?.preview_url || "").trim();
    if (u) return u;
    return activeResolvedMediaUrl;
  }, [activeResolvedMediaUrl, activeTemplateId, isActiveTemplateMediaRequired, mediaByTemplateId]);

  const activeVarKeys = useMemo(() => extractTemplateVariables(message), [message]);
  const activeVarValues = useMemo(() => {
    const tid = String(activeTemplateId || "");
    return (tid && templateVarValuesByTemplateId[tid]) ? templateVarValuesByTemplateId[tid] : {};
  }, [activeTemplateId, templateVarValuesByTemplateId]);

  const previewMessage = useMemo(() => {
    let out = message;

    // Apply template variables first.
    if (activeVarKeys.length > 0) {
      for (const key of activeVarKeys) {
        const v = String(activeVarValues[key] ?? "").trim();
        if (!v) continue;
        out = out.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, "gi"), v);
      }
    }

    // Wallet placeholders.
    if (campaignType === "wallet") {
      const raw = walletAmount.trim();
      if (raw) {
        const formatted = raw.startsWith("₹") ? raw : `₹${raw}`;
        out = out.replace(/\{wallet_amount\}/g, formatted);
      }
    }

    return out;
  }, [activeVarKeys, activeVarValues, campaignType, message, walletAmount]);

  const isCampaignTypeSelected = () => {
    const v = String(campaignType || "").trim();
    if (!v) return false;
    if (v === "__loading" || v === "__none") return false;
    if (campaignTypesLoading) return false;
    if (campaignTypes.length === 0) return false;
    return campaignTypes.some((c) => String(c.campaign_code || "").toLowerCase() === v.toLowerCase());
  };

  const isAudienceFiltersSelected = () => {
    if (!String(gender || "").trim()) return false;
    if (!String(lastVisitRangePreset || "").trim()) return false;
    if (!String(visitSegment || "").trim()) return false;
    if (lastVisitRangePreset === "custom") {
      if (!lastVisitFrom || !lastVisitTo) return false;
      if (lastVisitFrom > lastVisitTo) return false;
    }
    return true;
  };

  // Navigation
  const canNext = () => {
    if (step === 0) return campaignName.trim().length > 0 && isCampaignTypeSelected() && String(channel || "").trim().length > 0;
    if (step === 1) return isAudienceFiltersSelected() && recipientCount > 0;
    if (step === 2) {
      if (message.trim().length <= 0) return false;
      if (isActiveTemplateMediaRequired && !activeResolvedMediaUrl) return false;
      if (activeVarKeys.length > 0) {
        return activeVarKeys.every((k) => String(activeVarValues[k] ?? "").trim().length > 0);
      }
      return true;
    }
    return true;
  };

  const next = () => setStep((s) => (Math.min(4, (s + 1) as Step)) as Step);
  const prev = () => setStep((s) => (Math.max(0, (s - 1) as Step)) as Step);

  const scheduleAtIso = useMemo(() => {
    if (scheduleMode !== "schedule") return null;
    if (!scheduleDate || !scheduleTime) return null;
    // Treat as local time; backend stores as DATETIME.
    const iso = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
    return iso;
  }, [scheduleDate, scheduleMode, scheduleTime]);

  const resetWizard = () => {
    try {
      window.localStorage.removeItem(draftStorageKey);
      window.localStorage.removeItem(stepStorageKey);
    } catch {
      // no-op
    }

    setStep(0);

    // Basics
    setCampaignName("");
    setCampaignType("");

    // Audience
    setGender("all");
    setLastVisitRangePreset("45");
    setVisitSegment("nonvisit");
    setLastVisitFrom("");
    setLastVisitTo("");
    setSelectedCustomerIds([]);
    setCustomerSearch("");

    // Message
    setActiveTemplateId("");
    setTemplates([]);
    setTemplatesLoading(false);
    setMessage("");
    setTemplateVarValuesByTemplateId({});
    setMediaByTemplateId({});
    setCtaType("book");
    setWalletAmount("");

    // Delivery
    setScheduleMode("now");
    setScheduleDate("");
    setScheduleTime("");
  };

  const uploadTemplateMedia = async (templateId: string, file: File) => {
    const tid = String(templateId || "").trim();
    if (!tid) return;
    if (!user?.account_code || !user?.retail_code) {
      toast({ title: "Missing account", description: "Please login again." });
      return;
    }

    // Validate before upload to match FastSMS restrictions.
    try {
      const res = await validateFastSmsImageFile(file);
      if (!res.ok) {
        toast({
          title: "Image is invalid",
          description: FASTSMS_INVALID_IMAGE_MESSAGE,
          variant: "destructive",
        });
        return;
      }
    } catch {
      toast({
        title: "Image is invalid",
        description: FASTSMS_INVALID_IMAGE_MESSAGE,
        variant: "destructive",
      });
      return;
    }

    // Local preview while uploading
    let localPreviewUrl = "";
    try {
      localPreviewUrl = URL.createObjectURL(file);
      const old = mediaObjectUrlsRef.current[tid];
      if (old && old.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(old);
        } catch {
          // ignore
        }
      }
      mediaObjectUrlsRef.current[tid] = localPreviewUrl;
    } catch {
      localPreviewUrl = "";
    }

    setMediaByTemplateId((prev) => ({
      ...prev,
      [tid]: {
        ...(prev[tid] || {}),
        mode: "upload",
        filename: file.name,
        preview_url: localPreviewUrl || prev[tid]?.preview_url,
      },
    }));

    setMediaUploading(true);
    try {
      const res: any = await WhatsAppService.uploadCampaignMedia({
        accountCode: user.account_code,
        retailCode: user.retail_code,
        file,
      });

      const imageUrl = String(res?.image_url || res?.file_url || "").trim();
      if (!imageUrl) {
        throw new Error(res?.message || "Upload failed");
      }

      // Prefer persisted remote URL for preview (draft restore safe)
      const old = mediaObjectUrlsRef.current[tid];
      if (old && old.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(old);
        } catch {
          // ignore
        }
        delete mediaObjectUrlsRef.current[tid];
      }

      setMediaByTemplateId((prev) => ({
        ...prev,
        [tid]: {
          ...(prev[tid] || {}),
          mode: "url",
          url: imageUrl,
          file_url: imageUrl,
          filename: undefined,
          preview_url: imageUrl,
        },
      }));

      toast({ title: "Media uploaded", description: "Upload successful" });
    } catch (e: any) {
      const msg = e?.message || "Failed to upload media";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setMediaUploading(false);
    }
  };

  const clearTemplateMedia = (templateId: string) => {
    const tid = String(templateId || "").trim();
    if (!tid) return;
    const old = mediaObjectUrlsRef.current[tid];
    if (old && old.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(old);
      } catch {
        // ignore
      }
      delete mediaObjectUrlsRef.current[tid];
    }
    setMediaByTemplateId((prev) => {
      if (!prev[tid]) return prev;
      const next = { ...prev };
      delete next[tid];
      return next;
    });
  };

  const setTemplateMediaMode = (templateId: string, mode: "upload" | "url") => {
    const tid = String(templateId || "").trim();
    if (!tid) return;
    setMediaByTemplateId((prev) => ({
      ...prev,
      [tid]: {
        ...(prev[tid] || {}),
        mode,
      },
    }));
  };

  const setTemplateMediaUrl = (templateId: string, url: string) => {
    const tid = String(templateId || "").trim();
    if (!tid) return;
    setMediaByTemplateId((prev) => ({
      ...prev,
      [tid]: {
        ...(prev[tid] || {}),
        mode: "url",
        url,
      },
    }));
  };

  const onSendCampaign = async () => {
    if (!user?.account_code || !user?.retail_code) {
      toast({ title: "Missing account", description: "Please login again." });
      return;
    }
    if (!String(channel || "").trim()) {
      toast({ title: "Channel required", description: "Please choose a channel." });
      return;
    }
    if (!campaignName.trim()) {
      toast({ title: "Campaign name required" });
      return;
    }
    if (!isCampaignTypeSelected()) {
      toast({ title: "Campaign type required", description: "Please select a campaign type." });
      return;
    }
    if (!isAudienceFiltersSelected()) {
      toast({
        title: "Audience filters required",
        description: "Please choose Gender, Segment and Last visit.",
      });
      return;
    }
    if (recipientCount <= 0) {
      toast({ title: "No recipients", description: "Please choose audience." });
      return;
    }
    if (!previewMessage.trim()) {
      toast({ title: "Message required" });
      return;
    }

    // All template variables are mandatory (except customer_name which is derived per-recipient).
    if (activeVarKeys.length > 0) {
      const missing = activeVarKeys.filter((k) => {
        const lower = String(k).toLowerCase();
        if (lower === "customer_name" || lower === "customername") return false;
        return !String(activeVarValues[k] ?? "").trim();
      });
      if (missing.length > 0) {
        toast({
          title: "Missing required fields",
          description: `Please fill: ${missing.map((k) => `{${k}}`).join(", ")}`,
          variant: "destructive",
        });
        return;
      }
    }

    if (isActiveTemplateMediaRequired && !activeResolvedMediaUrl) {
      toast({ title: "Media required", description: "Please upload the required media for this template." });
      return;
    }

    if (balance !== null && recipientCount > balance) {
      toast({
        title: "Insufficient credits",
        description: `Required: ${recipientCount}, Available: ${balance}. Please add credits.`,
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const templateVariablesToSend: Record<string, string> = { ...(activeVarValues || {}) };

      // Prepare details
      const targetCustomers = selectedCustomerIds.map((id) => {
        const c = customers.find((x) => String(x.id) === id);
        return c
          ? { id: c.id, name: c.name, phone: c.phone }
          : { id };
      });

      const res: any = await WhatsAppService.sendCampaign({
        accountCode: user.account_code,
        retailCode: user.retail_code,
        channel,
        campaignName: campaignName.trim(),
        campaignType,
        recipientsCount: recipientCount,
        scheduleMode,
        scheduleAt: scheduleAtIso,
        // Extended details
        templateId: activeTemplateId,
        templateName: activeTemplate?.template_name,
        templateVariables: templateVariablesToSend,
        mediaFileUrl: activeResolvedMediaUrl,
        customers: targetCustomers,
      });

      const debited = (res as any)?.credits_debited ?? (res as any)?.data?.credits_debited;
      const balanceAfter = (res as any)?.balance_after ?? (res as any)?.data?.balance_after;
      
      if (balanceAfter !== undefined) {
        setBalance(Number(balanceAfter));
      }

      await fetchBalance();

      // Refresh the credits badge in the header (AddCreditsButton keeps its own balance state).
      try {
        window.dispatchEvent(new CustomEvent("credits:refresh"));
      } catch {
        // ignore
      }

      toast({
        title: "Campaign sent",
        description: debited !== undefined ? `Used ${Math.trunc(Number(debited) || 0).toLocaleString("en-IN")} messages. Balance: ${Math.trunc(Number(balanceAfter) || 0).toLocaleString("en-IN")}` : "Success",
      });

      resetWizard();
    } catch (e: any) {
      const msg = e?.message || "Failed to send campaign";
      toast({ title: "Send failed", description: msg });
    } finally {
      setSending(false);
    }
  };

  const onRequestClearWizard = () => {
    if (sending) return;
    setClearConfirmOpen(true);
  };

  const onConfirmClearWizard = () => {
    setClearConfirmOpen(false);
    resetWizard();
  };

  const onRequestStartCampaign = () => {
    if (sending) return;
    setStartConfirmOpen(true);
  };

  const onConfirmStartCampaign = async () => {
    setStartConfirmOpen(false);
    await onSendCampaign();
  };

  // UI helpers
  const StepHeader = () => (
    <div className="rounded-b-2xl border border-slate-200 border-t-0 bg-white shadow-sm">
      <div className="px-3 py-2 md:px-4 md:py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {[
              "Basics",
              "Audience",
              "Message",
              "Delivery",
              "Review",
            ].map((label, idx) => {
              const isDone = idx < step;
              const isActive = idx === step;
              const isLocked = idx > step;

              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (!isLocked) setStep(idx as Step);
                  }}
                  disabled={isLocked}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                    isActive
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : isDone
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-slate-200 bg-white text-slate-500",
                    isLocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                  )}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                      isActive
                        ? "bg-white/20 text-white"
                        : isDone
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600"
                    )}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <div className="hidden md:block mr-2 text-xs text-slate-500">Step {step + 1} / 5</div>
            <Button variant="outline" onClick={prev} disabled={step === 0} className="h-9">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button variant="outline" onClick={onRequestClearWizard} disabled={sending} className="h-9">
              <X className="mr-2 h-4 w-4" />
              Clear
            </Button>
            <Button
              onClick={step === 4 ? onRequestStartCampaign : next}
              disabled={step === 4 ? sending : !canNext()}
              className={cn("h-9", step === 4 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "")}
            >
              {step === 4 ? (
                sending ? (
                  <span className="inline-flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</span>
                ) : (
                  <span className="inline-flex items-center"><Send className="mr-2 h-4 w-4" />Start Campaign</span>
                )
              ) : (
                <span className="inline-flex items-center">Next<ArrowRight className="ml-2 h-4 w-4" /></span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <StepHeader />

      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
        <Sparkles className="h-4 w-4 shrink-0 text-amber-500 fill-amber-200" />
        <div className="flex-1 overflow-hidden relative" style={{ containerType: "inline-size" }}>
          <p className="text-sm font-medium animate-marquee inline-flex items-center">
            Promotional campaigns achieve <span className="font-bold">80% retention 🚀</span>.
            <span className="mx-[600px] inline-flex items-center gap-1.5 font-normal">
              <MetaLogoIcon className="h-4 w-4" />
                Meta Official Integration — <span className="font-bold">No additional platform fees</span>.
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {step === 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Campaign Basics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <FieldLabel required>Campaign name</FieldLabel>
                  <div className="relative">
                    <Input
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      placeholder="e.g. Birthday Offer Jan"
                      required
                      aria-required="true"
                      className="pr-8"
                    />
                    <button
                      type="button"
                      onClick={generateAutoCampaignName}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"
                      title="Generate auto name"
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <FieldLabel required>Campaign type</FieldLabel>
                  <CampaignTypeCombobox />
                </div>
                <div>
                  <FieldLabel required>Channel</FieldLabel>
                  <Input value="WhatsApp" disabled aria-required="true" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Audience Selection</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn(
                  "grid gap-4",
                  lastVisitRangePreset === "custom" ? "md:grid-cols-5" : "md:grid-cols-3"
                )}
              >
                <div>
                  <FieldLabel required>Gender</FieldLabel>
                  <Popover open={genderOpen} onOpenChange={setGenderOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" role="combobox" aria-expanded={genderOpen} className="w-full justify-between font-normal">
                        <span className="truncate">
                          {gender === "male" ? "Male" : gender === "female" ? "Female" : "All"}
                        </span>
                        <ArrowUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search gender..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>No options found.</CommandEmpty>
                          <CommandGroup>
                            {([
                              { value: "all", label: "All" },
                              { value: "male", label: "Male" },
                              { value: "female", label: "Female" },
                            ] as const).map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() => {
                                  setGender(opt.value as any);
                                  setGenderOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", gender === (opt.value as any) ? "opacity-100" : "opacity-0")} />
                                {opt.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <FieldLabel required>Segment</FieldLabel>
                  <Popover open={visitSegmentOpen} onOpenChange={setVisitSegmentOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" role="combobox" aria-expanded={visitSegmentOpen} className="w-full justify-between font-normal">
                        <span className="truncate">
                          {visitSegment === "visit" ? "Visit" : visitSegment === "nonvisit" ? "Non visit" : "All"}
                        </span>
                        <ArrowUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search segment..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>No options found.</CommandEmpty>
                          <CommandGroup>
                            {([
                              { value: "all", label: "All" },
                              { value: "visit", label: "Visit" },
                              { value: "nonvisit", label: "Non visit" },
                            ] as const).map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() => {
                                  setVisitSegment(opt.value as any);
                                  setVisitSegmentOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", visitSegment === (opt.value as any) ? "opacity-100" : "opacity-0")} />
                                {opt.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {lastVisitRangePreset === "all" || !lastVisitRangePreset
                      ? "Segment filter is disabled when Last visit is All"
                      : visitSegment === "visit"
                        ? "Customers who have billing activity in the selected range"
                        : visitSegment === "nonvisit"
                          ? "Customers who do not have billing activity in the selected range"
                          : "All customers (ignores visit status)"}
                  </div>
                </div>

                <div>
                  <FieldLabel required>Last visit</FieldLabel>
                  <Popover open={lastVisitOpen} onOpenChange={setLastVisitOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" role="combobox" aria-expanded={lastVisitOpen} className="w-full justify-between font-normal">
                        <span className={cn("truncate", !lastVisitRangePreset ? "text-muted-foreground" : "text-foreground")}>
                          {!lastVisitRangePreset
                            ? "Select last visit"
                            : lastVisitRangePreset === "all"
                              ? "All"
                              : lastVisitRangePreset === "custom"
                                ? "Custom"
                                : `Last ${lastVisitRangePreset} days`}
                        </span>
                        <ArrowUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search last visit..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>No options found.</CommandEmpty>
                          <CommandGroup>
                            {([
                              { value: "all", label: "All" },
                              { value: "30", label: "Last 30 days" },
                              { value: "45", label: "Last 45 days" },
                              { value: "60", label: "Last 60 days" },
                              { value: "90", label: "Last 90 days" },
                              { value: "custom", label: "Custom" },
                            ] as const).map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() => {
                                  setLastVisitRangePreset(opt.value as any);
                                  setLastVisitOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", lastVisitRangePreset === (opt.value as any) ? "opacity-100" : "opacity-0")} />
                                {opt.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {!lastVisitRangePreset
                      ? "Choose a last visit range"
                      : lastVisitRangePreset === "all"
                      ? "Showing all customers (no last-visit filter)"
                      : effectiveLastVisitRange.from && effectiveLastVisitRange.to
                      ? (visitSegment === "visit"
                        ? `Showing customers billed from ${effectiveLastVisitRange.from} to ${effectiveLastVisitRange.to}`
                        : visitSegment === "nonvisit"
                          ? `Showing customers NOT billed from ${effectiveLastVisitRange.from} to ${effectiveLastVisitRange.to}`
                          : `Showing all customers from ${effectiveLastVisitRange.from} to ${effectiveLastVisitRange.to}`)
                      : effectiveLastVisitRange.from
                        ? (visitSegment === "visit"
                          ? `Showing customers billed since ${effectiveLastVisitRange.from}`
                          : visitSegment === "nonvisit"
                            ? `Showing customers NOT billed since ${effectiveLastVisitRange.from}`
                            : `Showing all customers since ${effectiveLastVisitRange.from}`)
                        : effectiveLastVisitRange.to
                          ? (visitSegment === "visit"
                            ? `Showing customers billed up to ${effectiveLastVisitRange.to}`
                            : visitSegment === "nonvisit"
                              ? `Showing customers NOT billed up to ${effectiveLastVisitRange.to}`
                              : `Showing all customers up to ${effectiveLastVisitRange.to}`)
                          : "No date filter"}
                  </div>
                </div>

                {lastVisitRangePreset === "custom" ? (
                  <>
                    <div>
                      <FieldLabel required>Last visit from</FieldLabel>
                      <Input
                        type="date"
                        value={lastVisitFrom}
                        onChange={(e) => setLastVisitFrom(e.target.value)}
                        max={today}
                        required
                        aria-required="true"
                      />
                    </div>
                    <div>
                      <FieldLabel required>Last visit to</FieldLabel>
                      <Input
                        type="date"
                        value={lastVisitTo}
                        onChange={(e) => setLastVisitTo(e.target.value)}
                        max={today}
                        required
                        aria-required="true"
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2 md:p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">Select customers</div>
                    {billingRowsLoading ? (
                      <div className="text-xs text-slate-500">Loading visits…</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" className="h-8" onClick={selectAllVisible} disabled={visibleCustomers.length === 0}>
                      <ListChecks className="mr-2 h-4 w-4" />
                      Select all
                    </Button>
                    <Button type="button" variant="outline" className="h-8" onClick={clearSelection} disabled={selectedCustomerIds.length === 0}>
                      <X className="mr-2 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="mt-2">
                  <Input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name or mobile…"
                    className="h-8"
                  />
                </div>

                <div className="mt-2 max-h-[240px] overflow-auto rounded-md border border-slate-200">
                  {sortedCustomers.length === 0 ? (
                    <div className="p-3 text-sm text-slate-600">No customers found for current filters.</div>
                  ) : (
                    <div className="divide-y">
                      {pagedCustomers.map((c) => {
                        const checked = selectedCustomerIds.includes(c.id);
                        const bill = billingStatsByCustomerId.get(String(c.id));
                        const lastVisit = bill?.lastVisitDate || (c.last_visit ? String(c.last_visit).slice(0, 10) : "");
                        const lastAmt = bill?.lastInvoiceAmount;
                        const visitCount = (c as any)?.visit_count;
                        const membershipCard = (c as any)?.membership_cardno;
                        const creditPending = (c as any)?.credit_pending;
                          const membershipValue = String(membershipCard ?? "").trim();
                          const showMembership = membershipValue !== "" && membershipValue !== "0";
                        return (
                          <label
                            key={c.id}
                              className={cn(
                                "flex items-start gap-3 px-3 py-1.5 cursor-pointer",
                                showMembership
                                  ? "bg-[#FFF8E1] hover:bg-[#FFECB3] border-l-4 border-[#D4AF37]"
                                  : "hover:bg-slate-50"
                              )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => toggleCustomer(c.id, v === true)}
                              className="mt-1"
                            />
                            <span className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    "block text-sm font-medium truncate",
                                    showMembership ? "text-[#8A6A00]" : "text-slate-900"
                                  )}
                                >
                                  {c.name}
                                </span>
                              <span className="block text-xs text-slate-500">
                                {c.phone ? String(c.phone) : "—"}
                                {lastVisit ? ` • Last visit: ${lastVisit}` : ""}
                                {lastAmt !== undefined ? ` • Last bill: ₹${Number(lastAmt || 0).toFixed(2)}` : ""}
                              </span>
                              {(showMembership || visitCount !== undefined || creditPending !== undefined) && (
                                <span className="mt-0.5 block text-[11px] text-slate-500">
                                  {showMembership ? (
                                    <span className="font-medium text-[#8A6A00]">Membership: {membershipValue}</span>
                                  ) : (
                                    ""
                                  )}
                                  {showMembership && visitCount !== undefined ? " • " : ""}
                                  {visitCount !== undefined ? `Visits: ${String(visitCount)}` : ""}
                                  {(showMembership || visitCount !== undefined) && creditPending !== undefined ? " • " : ""}
                                  {creditPending !== undefined ? `Credit pending: ₹${Number(creditPending || 0).toFixed(2)}` : ""}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-slate-500">Showing {customerRangeLabel}</div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Select value={customerSortKey} onValueChange={(v) => setCustomerSortKey(v as any)}>
                      <SelectTrigger className="h-8 w-[170px]"><SelectValue placeholder="Sort by" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Sort: Name</SelectItem>
                        <SelectItem value="lastVisit">Sort: Last visit</SelectItem>
                        <SelectItem value="lastBill">Sort: Last bill</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="outline"
                      className="h-8"
                      onClick={() => setCustomerSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                      title={customerSortDir === "asc" ? "Ascending" : "Descending"}
                    >
                      <ArrowUpDown className="mr-2 h-4 w-4" />
                      {customerSortDir === "asc" ? "Asc" : "Desc"}
                    </Button>

                    <Select value={String(customerPageSize)} onValueChange={(v) => setCustomerPageSize(Number(v) || 25)}>
                      <SelectTrigger className="h-8 w-[120px]"><SelectValue placeholder="Rows" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 rows</SelectItem>
                        <SelectItem value="25">25 rows</SelectItem>
                        <SelectItem value="50">50 rows</SelectItem>
                        <SelectItem value="100">100 rows</SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="inline-flex items-center gap-2 rounded-md border bg-muted/10 px-2 py-1 text-xs text-slate-600">
                      <span>{customerRangeLabel}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setCustomerPage((p) => Math.max(1, p - 1))}
                        disabled={customerPage <= 1}
                        title="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setCustomerPage((p) => Math.min(totalCustomerPages, p + 1))}
                        disabled={customerPage >= totalCustomerPages}
                        title="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Message Composition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  {templatesLoading ? (
                    <div className="text-sm text-muted-foreground">Loading templates…</div>
                  ) : templates.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No templates found for this campaign type</div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {templates.map((t, idx) => {
                        const id = String(t.id ?? "");
                        const isActive = id && id === String(activeTemplateId || "");
                        const title = String(t.template_name || "Template");
                        const body = String(t.message_content || "");
                        const mediaRequiredForThis = String(t.media_required ?? "N").trim().toUpperCase() === "Y";
                        const mediaForThis = id ? (mediaByTemplateId[id] || null) : null;
                        const mediaModeForThis = mediaForThis?.mode === "url" ? "url" : "upload";
                        const mediaValueLabel = mediaModeForThis === "url"
                          ? String(mediaForThis?.url || "").trim()
                          : String(mediaForThis?.filename || mediaForThis?.file_url || "").trim();

                        const mediaPreviewUrlForThis = String(mediaForThis?.preview_url || mediaForThis?.url || mediaForThis?.file_url || "").trim();

                        return (
                          <div
                            key={id || title}
                            className={cn(
                              "w-full text-left rounded-lg border p-3 transition",
                              isActive ? "border-emerald-600 border-2 ring-2 ring-emerald-500/30" : "hover:border-slate-300"
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTemplateId(id);
                                setMessage(body);
                              }}
                              className="w-full text-left"
                            >
                              <div className="text-sm font-semibold truncate">
                                <span className="mr-2 text-slate-500">{idx + 1}.</span>
                                {title}
                              </div>
                              <Textarea
                                value={body}
                                readOnly
                                className="mt-2 min-h-[110px] bg-muted/10"
                              />
                            </button>

                            {isActive && activeVarKeys.length > 0 ? (
                              <div className="mt-3 space-y-3">
                                {activeVarKeys.length > 0 ? (
                                  <div className="border-t border-slate-200 pt-3">
                                    <div className="mb-2 flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-900">Template variables</div>
                                        <div className="text-xs text-muted-foreground">
                                          Fill values for {activeVarKeys.map((k) => `{${k}}`).join(", ")}
                                        </div>
                                      </div>
                                      <div className="shrink-0 rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                        {activeVarKeys.length} vars
                                      </div>
                                    </div>

                                    <div className="grid gap-2">
                                      {activeVarKeys.map((key) => {
                                        const tid = String(activeTemplateId || "");
                                        const v = String(activeVarValues[key] ?? "");
                                        const isCustomerNameVar = (() => {
                                          const lower = String(key).toLowerCase();
                                          return lower === "customer_name" || lower === "customername";
                                        })();
                                        const displayValue = isCustomerNameVar ? "{customer_name}" : v;
                                        const isEmpty = !String(displayValue ?? "").trim();
                                        return (
                                          <div key={key} className="space-y-1">
                                            <FieldLabel required>{key}</FieldLabel>
                                            <Input
                                              value={displayValue}
                                              readOnly={isCustomerNameVar}
                                              disabled={isCustomerNameVar}
                                              className={cn(
                                                isEmpty && !isCustomerNameVar
                                                  ? "border-rose-500 bg-rose-50 focus-visible:ring-rose-500"
                                                  : ""
                                              )}
                                              onChange={(e) => {
                                                if (isCustomerNameVar) return;
                                                const nextVal = e.target.value;
                                                setTemplateVarValuesByTemplateId((prev) => {
                                                  const cur = tid && prev[tid] ? prev[tid] : {};
                                                  return {
                                                    ...prev,
                                                    [tid]: {
                                                      ...cur,
                                                      [key]: nextVal,
                                                    },
                                                  };
                                                });
                                              }}
                                              placeholder={`Enter value for {${key}}`}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {mediaRequiredForThis ? (
                              <div className={cn("mt-3 border-t border-slate-200 pt-3", isActive ? "" : "opacity-95")}>
                                <div className="mb-2 flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                      <FieldLabel required>Media URL</FieldLabel>
                                      <div className="text-xs text-muted-foreground">Upload an image to auto-fill the URL (you can edit it after).</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant={mediaModeForThis === "upload" ? "default" : "outline"}
                                      className="h-8"
                                      onClick={() => setTemplateMediaMode(id, "upload")}
                                      disabled={mediaUploading}
                                    >
                                      Upload
                                    </Button>
                                    {mediaValueLabel ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8"
                                        onClick={() => clearTemplateMedia(id)}
                                        disabled={mediaUploading}
                                      >
                                        Clear
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                {mediaValueLabel && mediaModeForThis !== "url" ? (
                                  <div className="rounded-md border bg-muted/10 px-3 py-2 text-xs text-slate-700">
                                    <div className="font-medium">Uploaded</div>
                                    <div className="truncate">{mediaValueLabel}</div>
                                  </div>
                                ) : null}

                                {mediaPreviewUrlForThis ? (
                                  <div className="mt-2 flex items-center gap-3">
                                    <img
                                      src={mediaPreviewUrlForThis}
                                      alt="Media preview"
                                      className="h-16 w-16 rounded-md border object-cover bg-white"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                    <div className="min-w-0">
                                      <div className="text-[11px] text-muted-foreground">Preview</div>
                                      <div className="text-xs text-slate-700 truncate max-w-[220px]">{mediaPreviewUrlForThis}</div>
                                    </div>
                                  </div>
                                ) : null}

                                <div className="space-y-2">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    disabled={mediaUploading}
                                    onChange={(e) => {
                                      const f = e.target.files && e.target.files[0];
                                      // allow re-uploading the same file
                                      e.currentTarget.value = "";
                                      if (!f) return;

                                      // Make this template active so the rest of the wizard stays consistent.
                                      if (!isActive) {
                                        setActiveTemplateId(id);
                                        setMessage(body);
                                      }

                                      void uploadTemplateMedia(id, f);
                                    }}
                                    className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-slate-50 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-100"
                                  />

                                  <div className="space-y-1">
                                    <Input
                                      value={String(mediaForThis?.url || "")}
                                      disabled={mediaUploading}
                                      placeholder="https://example.com/media.jpg"
                                      onChange={(e) => setTemplateMediaUrl(id, e.target.value)}
                                    />
                                    <div className="text-[11px] text-muted-foreground">Auto-filled after upload; editable.</div>
                                  </div>
                                </div>

                                {mediaUploading ? <div className="text-xs text-muted-foreground mt-1">Uploading…</div> : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {campaignType === "wallet" && (
                    <div className="space-y-2">
                      <FieldLabel>Wallet amount</FieldLabel>
                      <Input value={walletAmount} onChange={(e)=>setWalletAmount(e.target.value)} placeholder="₹0.00" />
                    </div>
                  )}

                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="w-full max-w-[360px] space-y-1 ml-auto">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">Campaign type</span>
                      {campaignTypesLoading ? (
                        <span className="text-[11px] text-muted-foreground">Loading…</span>
                      ) : null}
                    </div>
                    <CampaignTypeCombobox buttonClassName="h-9 bg-white" />
                  </div>

                  <div className="w-full max-w-[360px] flex items-start justify-end ml-auto">
                    <div className="relative mx-auto w-[260px] sm:w-[280px] rounded-[32px] border border-slate-300 bg-slate-900/95 p-3 text-xs text-slate-50 shadow-xl">
                      <div className="absolute inset-x-16 top-1 mx-auto h-1.5 rounded-full bg-slate-700" />
                      <div className="mt-3 rounded-2xl bg-gradient-to-b from-emerald-900/70 via-slate-900 to-slate-950 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white text-[11px] font-medium">WA</div>
                          <div className="flex-1 min-w-0"><p className="text-[11px] font-semibold truncate">{`{customer_name}`}</p><p className="text-[10px] text-emerald-100/80">online</p></div>
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-100">
                            <WhatsAppLogoIcon className="h-4.5 w-4.5" />
                          </div>
                        </div>
                        <div className="mt-2 flex justify-start">
                          <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-emerald-500 px-3 py-2 text-[11px] leading-snug shadow-sm">
                            {activePreviewMediaUrl ? (
                              <img
                                src={activePreviewMediaUrl}
                                alt="Campaign media"
                                className="mb-2 w-full max-w-[210px] rounded-lg border border-emerald-200/30 object-cover bg-white"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : null}
                            <div className="whitespace-pre-line">{previewMessage || ""}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Delivery & Scheduling</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium"><Calendar className="h-4 w-4 text-emerald-600" />Scheduling</div>
              </div>
              <div className="flex flex-col gap-2 md:items-end">
                <div className="inline-flex rounded-full border bg-muted/30 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={()=>setScheduleMode("now")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium",
                      scheduleMode==="now"?"bg-emerald-600 text-white":"text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Send now</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toast({ title: "Coming soon", description: "Scheduling will be available soon." })}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium text-muted-foreground opacity-70 cursor-not-allowed"
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>Schedule</span>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Review & Confirm</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <SummaryItem label="Campaign" value={`${campaignName || "—"} (${campaignType})`} />
                <SummaryItem label="Recipients" value={`${recipientCount}`} />
                <SummaryItem label="Estimated messages" value={estimatedCost} />
                <SummaryItem label="Delivery" value={scheduleMode === "now" ? "Send now" : `${scheduleDate || "—"} ${scheduleTime || "—"}`} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-700">Chosen Template</p>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm whitespace-pre-line">{previewMessage}</div>
              </div>
            </CardContent>
          </Card>
        )}

        <AlertDialog
          open={startConfirmOpen}
          onOpenChange={(open) => {
            if (!sending) setStartConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Start Campaign?</AlertDialogTitle>
              <AlertDialogDescription>
                This will send the WhatsApp messages now.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Recipients</span>
                <span className="font-semibold text-slate-900">{recipientCount}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Estimated messages</span>
                <span className="font-semibold text-slate-900">{estimatedCost}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm mt-2 pt-2 border-t border-slate-100">
                <span className="text-slate-600">Available credits</span>
                <span className={cn("font-semibold", (balance || 0) < recipientCount ? "text-rose-600" : "text-emerald-600")}>
                  {balance !== null ? balance.toLocaleString("en-IN") : "Loading..."}
                </span>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirmStartCampaign} disabled={sending}>
                {sending ? "Starting…" : "Yes, Start"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={clearConfirmOpen}
          onOpenChange={(open) => {
            if (!sending) setClearConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear campaign data?</AlertDialogTitle>
              <AlertDialogDescription>
                This will clear all entered values and reset the wizard to Step 1.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirmClearWizard} disabled={sending}>
                Clear
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: {label: string; value: string;}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2.5 shadow-xs">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
