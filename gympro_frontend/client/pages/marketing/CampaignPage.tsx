import { useContext, useEffect } from "react";
import { HeaderContext } from "@/contexts/HeaderContext";
import WhatsAppCampaignWizard from "@/components/campaign/WhatsAppCampaignWizard";
import CampaignHistoryButton from "@/components/marketing/CampaignHistoryButton";
import AddCreditsButton from "@/components/marketing/AddCreditsButton";
import { FaFacebookF, FaWhatsapp } from "react-icons/fa";
import { SiMeta } from "react-icons/si";

export default function CampaignPage() {
  const { setHeaderTitle } = useContext(HeaderContext);

  useEffect(() => {
    setHeaderTitle("Campaign");
    return () => setHeaderTitle("");
  }, [setHeaderTitle]);

  return (
    <div className="min-h-screen bg-slate-50/30">
      {/* Top header */}
      <div className="sticky top-0 z-30 bg-slate-50/30">
        <div className="container mx-auto px-4 md:px-6 pt-3 md:pt-4 pb-0">
          <div className="rounded-t-2xl border border-slate-200 border-b-0 bg-white shadow-sm">
            <div className="px-4 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-center">
            {/* Promo badges (left on desktop) */}
            <div className="order-1 flex items-center justify-start">
              <div
                className="inline-flex h-10 items-stretch overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm"
                role="group"
                aria-label="Promotions"
              >
                <div
                  className="inline-flex items-center gap-2 px-4 text-xs font-semibold text-blue-700 bg-blue-50"
                  title="Facebook promotion"
                >
                  <FaFacebookF className="h-4 w-4" aria-hidden="true" />
                  <span>Facebook</span>
                </div>

                <div className="w-px bg-slate-200" aria-hidden="true" />

                <div
                  className="inline-flex items-center gap-2 px-4 text-xs font-semibold text-emerald-700 bg-emerald-50"
                  title="WhatsApp promotion"
                >
                  <FaWhatsapp className="h-4 w-4" aria-hidden="true" />
                  <span>WhatsApp</span>
                </div>

                <div className="w-px bg-slate-200" aria-hidden="true" />

                <div
                  className="inline-flex items-center gap-2 px-4 text-xs font-semibold text-blue-600 bg-blue-50"
                  title="Meta promotion"
                >
                  <SiMeta className="h-4 w-4" aria-hidden="true" />
                  <span>Meta</span>
                </div>
              </div>
            </div>

            <div className="order-2 flex flex-row items-center justify-end gap-2">
              <AddCreditsButton />
              <CampaignHistoryButton />
            </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 pt-0 pb-6">
        <div className="animate-in fade-in-0 slide-in-from-right-2 duration-300">
          <WhatsAppCampaignWizard />
        </div>
      </div>
    </div>
  );
}
