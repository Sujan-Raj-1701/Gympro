import React from "react";
import { cn } from "@/lib/utils";
import { MessageCircle } from "lucide-react";

export type CampaignChannel = "whatsapp" | "sms" | "email" | "voice";

interface CampaignTab {
  id: CampaignChannel;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
}

const CAMPAIGN_TABS: CampaignTab[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    available: true,
  },
];

interface CampaignTabsProps {
  activeChannel: CampaignChannel;
  onChannelChange: (channel: CampaignChannel) => void;
}

export function CampaignTabs({ activeChannel, onChannelChange }: CampaignTabsProps) {
  const activeIndex = Math.max(
    0,
    CAMPAIGN_TABS.findIndex((tab) => tab.id === activeChannel)
  );

  return (
    <div className="relative bg-white/95 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-20 shadow-sm">
      {/* Tab Container */}
      <div className="flex items-center justify-start px-4 md:px-6">
        <div className="relative flex items-center">
          {/* Sliding Indicator */}
          <div
            className="absolute bottom-0 h-0.5 bg-emerald-500 transition-all duration-500 ease-out rounded-full"
            style={{
              left: `${activeIndex * 120}px`,
              width: "120px",
            }}
          />
          
          {/* Tab Buttons */}
          {CAMPAIGN_TABS.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeChannel;
            const isAvailable = tab.available;

            return (
              <button
                key={tab.id}
                onClick={() => isAvailable && onChannelChange(tab.id)}
                disabled={!isAvailable}
                className={cn(
                  "relative flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all duration-300",
                  "border-b-2 border-transparent",
                  isAvailable
                    ? isActive
                      ? "text-emerald-600 bg-emerald-50/50 transform scale-105"
                      : "text-slate-600 hover:text-emerald-600 hover:bg-emerald-50/30 hover:scale-102"
                    : "text-slate-400 cursor-not-allowed opacity-60",
                  "min-w-[120px] justify-center",
                  isActive && "shadow-sm"
                )}
                style={{ width: "120px" }}
              >
                <Icon className={cn(
                  "h-4 w-4 transition-colors duration-300",
                  isActive && isAvailable ? "text-emerald-600" : ""
                )} />
                <span className="relative">
                  {tab.label}
                  {!isAvailable && (
                    <span className="absolute -top-1 -right-2 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto" />
      </div>

      {/* Subtle gradient border */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </div>
  );
}

export { CAMPAIGN_TABS };
export type { CampaignTab };