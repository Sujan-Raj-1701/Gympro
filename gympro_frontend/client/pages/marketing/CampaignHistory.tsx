import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HeaderContext } from "@/contexts/HeaderContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, History, MessageSquare } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import WhatsAppService from "@/services/whatsappService";

export default function CampaignHistory() {
  const { setHeaderTitle } = useContext(HeaderContext);
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setHeaderTitle("Campaign History");
    return () => setHeaderTitle("");
  }, [setHeaderTitle]);

  useEffect(() => {
    const accountCode = (user as any)?.account_code;
    const retailCode = (user as any)?.retail_code;
    if (!accountCode || !retailCode) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await WhatsAppService.getCampaignHistory({
          accountCode: String(accountCode),
          retailCode: String(retailCode),
          limit: 50,
        });
        if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
      } catch (e: any) {
        if (!cancelled) {
          setItems([]);
          setError(e?.message || "Failed to load history");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-slate-50/30">
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/75 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/campaign"))}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                aria-label="Back"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-3 min-w-0">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <History className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-base md:text-lg font-semibold text-slate-900">Campaign History</h1>
                  <p className="truncate text-xs md:text-sm text-slate-600">Recently sent or scheduled WhatsApp campaigns</p>
                </div>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-2">
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{loading ? "Loading" : `${items.length} campaigns`}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 py-6 space-y-4">
        <Card className="border-slate-200/70 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Recent Campaigns</CardTitle>
              <div className="sm:hidden">
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{loading ? "Loading" : `${items.length}`}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="divide-y">
            {loading ? (
              <div className="py-8 text-sm text-slate-600">Loading…</div>
            ) : error ? (
              <div className="py-8 text-sm text-rose-700">{error}</div>
            ) : items.length === 0 ? (
              <div className="py-10">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <MessageSquare className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">No campaigns yet</div>
                  <div className="mt-1 text-xs text-slate-600">Create and start a campaign to see it here.</div>
                </div>
              </div>
            ) : (
              items.map((it: any) => (
                <div
                  key={String(it?.id)}
                  className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{String(it?.campaign_name || "—")}</div>
                      <div className="text-xs text-slate-600">
                        Sent to {Number(it?.recipients_count || 0)} recipients • Used {Math.trunc(Number(it?.credits_debited || 0))} messages
                      </div>
                      {it?.created_at ? <div className="text-[11px] text-slate-500">{String(it.created_at)}</div> : null}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Badge
                      variant="secondary"
                      className="border border-emerald-200 bg-emerald-50 text-emerald-700"
                    >
                      {String(it?.status || "sent")}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
