import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  LayoutDashboard,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { getLucideIcon } from "@/components/LucideIcon";
import LicenseInfoModal from "@/components/LicenseInfoModal";
import { LicenseService, type LicenseInfo } from "@/services/licenseService";

interface MenuItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: MenuItem[];
  permission?: string;
}


export type SidebarProps = {
  collapsed: boolean;
  minimized: boolean;
  setCollapsed: (v: boolean) => void;
  setMinimized: (v: boolean) => void;
  isActiveRoute: (href: string) => boolean;
  user?: any;
};

export default function Sidebar({ collapsed, minimized, setCollapsed, setMinimized, isActiveRoute, user }: SidebarProps) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [openSections, setOpenSections] = useState<string[]>(["Master Modules"]);
  const [retailName, setRetailName] = useState<string>("");
  const [isSidebarScrolling, setIsSidebarScrolling] = useState(false);
  const sidebarScrollStopTimerRef = useRef<number | null>(null);
  const [isLicenseModalOpen, setLicenseModalOpen] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [isLicenseLoading, setLicenseLoading] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const location = useLocation();
  const licenseId = user?.retail_code || "";
  const toggleSection = (title: string) => {
    setOpenSections((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
  };

  // Load parent modules from session storage => MenuItem[]
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('user_modules');
      if (!raw) { setMenuItems([]); return; }
      const parsed = JSON.parse(raw);
      const parents: any[] = Array.isArray(parsed) ? parsed : [];
      const mapped: MenuItem[] = parents
        .filter((p) => (p?.can_view ?? 0) === 1)
        .map((p) => {
          const IconComp = getLucideIcon(String(p?.icon || 'LayoutDashboard'));
          
          // Children are ignored in the sidebar
          
          const item: MenuItem = {
            title: String(p?.name ?? ''),
            icon: IconComp,
            href: String(p?.route ?? '#'),
          };

          return item;
        });
      
      // Add Asset Management as a static menu item
      const staticItems: MenuItem[] = [
      ];
      
      setMenuItems([...staticItems, ...(mapped || [])]);
    } catch (e) {
  // Keep empty menu on parse or mapping errors
  console.warn('Failed to parse user_modules from sessionStorage:', e);
  setMenuItems([]);
    }
  }, []);

  // Load retail name from session (retail_master) or from user context
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("retail_master");
      let name = "";
      if (raw) {
        const obj = JSON.parse(raw);
        name =
          obj?.RetailName ||
          obj?.retail_name ||
          obj?.CompanyName ||
          obj?.company_name ||
          obj?.OrgName ||
          obj?.org_name ||
          "";
      }
      if (!name) {
        name = (user as any)?.company_name || (user as any)?.org_name || (user as any)?.retail_name || "";
      }
      setRetailName(name || "");
    } catch (e) {
      // ignore parse errors; leave default empty
      setRetailName((user as any)?.company_name || (user as any)?.org_name || "");
    }
  }, [user]);

  const roleFilteredItems = menuItems; // currently allow all
  const filteredMenuItems = roleFilteredItems;

  // Determine whether a parent menu item should be considered active
  const isParentActive = useCallback(
    (item: MenuItem) => {
      const selfActive = item.href ? isActiveRoute(item.href) : false;
      const anyChildActive = Array.isArray(item.children)
        ? item.children.some((c) => !!c?.href && isActiveRoute(c.href!))
        : false;
      return selfActive || anyChildActive;
    },
    [isActiveRoute]
  );

  // Keep the section containing the active route opened
  useEffect(() => {
    try {
      const activeTitles = filteredMenuItems
        .filter((it) => isParentActive(it))
        .map((it) => it.title);
      if (activeTitles.length === 0) return;
      setOpenSections((prev) => Array.from(new Set([...prev, ...activeTitles])));
    } catch {}
  }, [location.pathname, filteredMenuItems, isParentActive]);

  const fetchLicenseInfo = useCallback(async () => {
    if (!licenseId) return;
    setLicenseLoading(true);
    setLicenseError(null);
    try {
      const info = await LicenseService.getLicenseInfo(licenseId);
      setLicenseInfo(info);
    } catch (error) {
      console.error("Failed to load license info", error);
      setLicenseError("Unable to fetch license details. Please try again.");
    } finally {
      setLicenseLoading(false);
    }
  }, [licenseId]);

  const handleLicenseDetailsClick = () => {
    if (!licenseId) return;
    setLicenseModalOpen(true);
    fetchLicenseInfo();
  };

  // Listen for global event to open the license modal from other components (e.g., header banner)
  useEffect(() => {
    const openHandler = () => {
      if (!licenseId) return;
      setLicenseModalOpen(true);
      fetchLicenseInfo();
    };
    // Using 'any' event type to avoid TS typing for custom events
    window.addEventListener('open-license-modal' as any, openHandler as any);
    return () => {
      window.removeEventListener('open-license-modal' as any, openHandler as any);
    };
  }, [licenseId, fetchLicenseInfo]);

  useEffect(() => {
    return () => {
      if (sidebarScrollStopTimerRef.current) {
        window.clearTimeout(sidebarScrollStopTimerRef.current);
      }
    };
  }, []);

  const handleSidebarScroll = () => {
    setIsSidebarScrolling(true);
    if (sidebarScrollStopTimerRef.current) {
      window.clearTimeout(sidebarScrollStopTimerRef.current);
    }
    sidebarScrollStopTimerRef.current = window.setTimeout(() => {
      setIsSidebarScrolling(false);
    }, 700);
  };

  return (
    <>
      <aside
      className={cn(
        "fixed left-0 top-14 bottom-0 z-40 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-r border-slate-800/60 shadow-2xl backdrop-blur-md transition-all duration-300 ease-in-out",
        collapsed ? "-translate-x-full" : "translate-x-0",
        minimized ? "w-16" : "w-52",
      )}
    >
      <div className="flex flex-col h-full">
        {/* Sidebar Header */}
        <div className="px-3 py-1.5 border-b border-slate-800/60 bg-gradient-to-br from-slate-950/85 via-slate-900/90 to-slate-950/85 backdrop-blur-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            {!minimized && (
              <div className="flex-1 min-w-0">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-semibold text-slate-200/80">Welcome!</span>
                  <span className="text-sm font-bold text-white drop-shadow-sm truncate">
                    {user?.username || "User"}
                  </span>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                console.log('Sidebar: Toggle clicked, current minimized:', minimized);
                const newMinimized = !minimized;
                console.log('Sidebar: Setting minimized to:', newMinimized);
                setMinimized(newMinimized);
              }}
              className="flex flex-shrink-0 text-slate-200 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-300 p-2 z-10 relative border border-slate-800/50 hover:border-slate-700/60 backdrop-blur-sm shadow-lg"
              title={minimized ? "Expand Sidebar" : "Minimize Sidebar"}
            >
              {minimized ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            </Button>
          </div>
          {/* Search removed as requested */}
        </div>

        {/* Navigation */}
        <div
          className={cn(
            "flex-1 px-1 py-0.5 overflow-y-auto overflow-x-hidden sidebar-scrollbar",
            isSidebarScrolling && "is-scrolling",
          )}
          onScroll={handleSidebarScroll}
        >
          <nav className="space-y-0 pr-0.5 mt-3">
            {filteredMenuItems.map((item, index) => (
              <div key={index}>{/* Removed margin for tighter spacing */}
                {item.children ? (
                  item.title === "Reports" ? (
                    <Link to={item.children[0]?.href || "/reports"}>
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full h-10 px-3 font-medium rounded-lg transition-colors duration-200 group",
                          minimized ? "justify-center p-1.5" : "justify-start p-2",
                          // Mark active if any report child is active
                          (Array.isArray(item.children) && item.children.some(ch => ch.href && isActiveRoute(ch.href)))
                            ? "bg-slate-700/40 text-white border border-slate-600/50 shadow-xl"
                            : "text-slate-200 hover:bg-slate-700/25 hover:text-white hover:shadow-lg",
                        )}
                        title={minimized ? item.title : undefined}
                      >
                        {minimized ? (
                          <item.icon className="h-4 w-4" />
                        ) : (
                          <>
                            <div className="p-1 bg-slate-700/30 rounded-lg mr-1">
                              <item.icon className="h-3.5 w-3.5" />
                            </div>
                            <span className="font-medium tracking-wide text-sm">{item.title}</span>
                          </>
                        )}
                      </Button>
                    </Link>
                  ) : minimized ? (
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full h-9 justify-center p-1.5 rounded-lg transition-all duration-300 group hover:shadow-lg",
                        isParentActive(item)
                          ? "bg-slate-700/40 text-white border border-slate-600/50"
                          : "text-slate-200 hover:text-white hover:bg-slate-700/25"
                      )}
                      title={item.title}
                    >
                      <item.icon className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Collapsible
                      open={openSections.includes(item.title) || isParentActive(item)}
                      onOpenChange={() => toggleSection(item.title)}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full h-10 px-3 justify-between font-medium text-left rounded-lg transition-all duration-300 p-2 group hover:shadow-lg",
                            isParentActive(item)
                              ? "bg-slate-700/40 text-white border border-slate-600/50"
                              : "text-slate-200 hover:text-white hover:bg-slate-700/25"
                          )}
                        >
                          <div className="flex items-center">
                            <div className="p-1 bg-slate-700/30 rounded-lg mr-1">
                              <item.icon className="h-3.5 w-3.5" />
                            </div>
                            <span className="font-medium tracking-wide text-sm">{item.title}</span>
                          </div>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-0 ml-1.5 mt-0.5">
                        {item.children.map((child, childIndex) => (
                          <Link key={childIndex} to={child.href!}>
                            <Button
                              variant="ghost"
                              className={cn(
                                "w-full h-9 px-3 py-2 justify-start text-sm rounded-lg transition-colors duration-200 group",
                                isActiveRoute(child.href!)
                                  ? "bg-slate-700/40 text-white border border-slate-600/50 shadow-xl"
                                  : "text-slate-200 hover:bg-slate-700/25 hover:text-white hover:shadow-lg",
                              )}
                            >
                              <div className="p-0.5 bg-slate-600/20 rounded-lg mr-1">
                                <child.icon className="h-3.5 w-3.5" />
                              </div>
                              <span className="font-medium text-sm">{child.title}</span>
                            </Button>
                          </Link>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )
                ) : (
                  <Link to={item.href!}>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full h-10 px-3 font-medium rounded-lg transition-colors duration-200 group",
                        minimized ? "justify-center p-1.5" : "justify-start p-2",
                        isActiveRoute(item.href!)
                          ? "bg-slate-700/40 text-white border border-slate-600/50 shadow-xl"
                          : "text-slate-200 hover:bg-slate-700/25 hover:text-white hover:shadow-lg",
                      )}
                      title={minimized ? item.title : undefined}
                    >
                      {minimized ? (
                        <item.icon className="h-4 w-4" />
                      ) : (
                        <>
                          <div className="p-1 bg-slate-700/30 rounded-lg mr-1">
                            <item.icon className="h-3.5 w-3.5" />
                          </div>
                          <span className="font-medium tracking-wide text-sm">{item.title}</span>
                        </>
                      )}
                    </Button>
                  </Link>
                )}
              </div>
            ))}
          </nav>
        </div>

        {!minimized && (
          <div className="px-2 py-1.5 border-t border-slate-800/60 bg-gradient-to-r from-slate-950/60 to-slate-900/60">
            <button
              type="button"
              onClick={handleLicenseDetailsClick}
              disabled={!licenseId}
              className={cn(
                "w-full rounded-lg border border-slate-800/60 bg-gradient-to-r from-slate-950/40 to-slate-900/40 px-2 py-1.5 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/60 shadow-lg",
                licenseId
                  ? "hover:border-slate-700/70 hover:from-slate-950/50 hover:to-slate-900/50 hover:shadow-xl"
                  : "cursor-not-allowed opacity-60"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 shadow-md">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-200" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] uppercase tracking-wide text-slate-200/90">Licence ID</p>
                  <p className="text-[11px] font-semibold text-white truncate">{licenseId || "-"}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-200/80 flex-shrink-0" />
              </div>
            </button>
          </div>
        )}

        {!minimized ? (
          <div className="p-2 border-t border-slate-800/60 bg-gradient-to-r from-slate-950/60 to-slate-900/60">
            <p className="text-[10px] leading-snug text-slate-200/80">© 2025 Techies Magnifier Technologies.</p>
          </div>
        ) : (
          <div className="p-1 border-t border-slate-800/60 bg-gradient-to-r from-slate-950/60 to-slate-900/60 text-center">
            <p className="text-[9px] text-slate-200/80 leading-tight">Powered by</p>
            <p className="text-[9px] text-slate-200 font-medium">TMT</p>
          </div>
        )}
      </div>
      </aside>
      <LicenseInfoModal
        open={isLicenseModalOpen}
        onOpenChange={(open) => {
          setLicenseModalOpen(open);
          if (!open) {
            setLicenseError(null);
          }
        }}
        licenseInfo={licenseInfo}
        isLoading={isLicenseLoading}
        error={licenseError}
        onRetry={fetchLicenseInfo}
      />
    </>
  );
}
