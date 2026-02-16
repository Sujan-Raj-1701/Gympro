import { useState, createContext, useContext, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import Sidebar from "@/components/Sidebar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// Removed sidebar search input as requested
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
// Notification bell removed from header as requested
import AIChatbotModal from "@/components/AIChatbotModal";
// Dropdown menu and separator imports removed with notifications
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  LayoutDashboard,
  BarChart3,
  Menu,
  ChevronDown,
  Archive,
  ArrowLeft,
  ArrowRight,
  LogOut,
  CalendarDays,
  UserCog,
  Clock,
  Maximize2,
  Minimize2,
  RefreshCw,
  Camera,
  Bot,
  Settings,
  Bell,
  AlertCircle,
  Receipt,
  MoreVertical,
  Scissors,
  MessageSquareText,
  DollarSign,
  Search,
} from "lucide-react";
import { saveAs } from "file-saver";
import { useAuth } from "@/contexts/AuthContext";
import { HeaderContext } from '@/contexts/HeaderContext';
import { LicenseService } from "@/services/licenseService";

type UserModule = {
  name?: string;
  route?: string;
  can_view?: boolean;
  children?: UserModule[];
};

type ModuleSuggestion = {
  title: string;
  href: string;
};

interface MenuItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: MenuItem[];
  permission?: string;
}

const menuItems: MenuItem[] = [
  {
    title: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    permission: "dashboard",
  },
  {
    title: "Master Modules",
    icon: Archive,
    href: "/masters",
    permission: "masters",
  },
  {
    title: "Hall Booking",
    icon: CalendarDays,
    href: "/hall-booking",
    permission: "hall-booking",
  },
  {
    title: "Enquiry",
    icon: MessageSquareText,
    href: "/enquiry",
    permission: "enquiry",
  },
  {
    title: "Billing",
    icon: Receipt,
    href: "/billing",
    permission: "billing",
  },
  {
    title: "Settlement",
    icon: DollarSign,
    href: "/settlement",
    permission: "settlement",
  },
  {
    title: "User Management",
    icon: UserCog,
    href: "/user-management",
    permission: "user-management",
  },
  {
    title: "Reports",
    icon: BarChart3,
    permission: "reports",
    children: [
      { title: "General Reports", icon: BarChart3, href: "/reports" },
    ],
  },
  {
    title: "Settings",
    icon: Settings,
    href: "/settings",
    permission: "settings",
  },
];

export const SidebarContext = createContext<{ setSidebarCollapsed: (collapsed: boolean) => void } | undefined>(undefined);

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarContext");
  return ctx;
}

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMinimized, setSidebarMinimized] = useState(false);
  const location = useLocation();
  const scrollActivityTimersRef = useRef<Map<HTMLElement, number>>(new Map());
  // Determine embed mode from query string (iframe usage)
  // Must be synchronous to avoid initial sidebar/header flash in iframes.
  const embed = (() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      return qs.get('embed') === '1';
    } catch {
      return false;
    }
  })();
  // Ref to capture only the main content (exclude header & sidebar)
  const contentRef = useRef<HTMLDivElement | null>(null);
  // License warning state
  const [daysToExpiry, setDaysToExpiry] = useState<number | null>(null);
  const [expiryIso, setExpiryIso] = useState<string | null>(null);
  const [expiredPopupShown, setExpiredPopupShown] = useState(false);

  // Debug logging for sidebar state changes
  useEffect(() => {
    
  }, [sidebarCollapsed, sidebarMinimized]);

  // Sidebar search removed
  const [openSections, setOpenSections] = useState<string[]>([
    "Master Modules",
  ]);
  // Date/time for sidebar header
  const [currentTime, setCurrentTime] = useState(new Date());
  // Removed notifications UI/states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  // Notifications removed
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [headerTitle, setHeaderTitle] = useState<string>('');
  
  // Notification state
  const [notifications, setNotifications] = useState([
    { id: 1, type: 'info', title: 'New Booking Request', message: 'Hall booking for tomorrow needs approval', time: '5 min ago', read: false },
    { id: 2, type: 'warning', title: 'Payment Reminder', message: 'Advance payment pending for booking #1234', time: '1 hour ago', read: false },
    { id: 3, type: 'success', title: 'Booking Confirmed', message: 'Event booking #5678 has been confirmed', time: '2 hours ago', read: true },
  ]);
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;
  const [aiOpen, setAiOpen] = useState(false);

  const [moduleSearchOpen, setModuleSearchOpen] = useState(false);
  const [moduleSearchQuery, setModuleSearchQuery] = useState("");
  const [moduleSuggestions, setModuleSuggestions] = useState<ModuleSuggestion[]>([]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const handleScrollCapture = (event: Event) => {
      const target = event.target;
      let el: HTMLElement | null = null;

      if (target === document || target === document.documentElement || target === document.body) {
        el = document.documentElement;
      } else if (target instanceof Document) {
        el = document.documentElement;
      } else if (target instanceof HTMLElement) {
        el = target;
      }

      if (!el) return;

      el.classList.add("is-scrolling");
      const timers = scrollActivityTimersRef.current;
      const prev = timers.get(el);
      if (prev) window.clearTimeout(prev);
      const timeoutId = window.setTimeout(() => {
        el.classList.remove("is-scrolling");
        timers.delete(el);
      }, 700);
      timers.set(el, timeoutId);
    };

    document.addEventListener("scroll", handleScrollCapture, true);
    return () => {
      document.removeEventListener("scroll", handleScrollCapture, true);
      scrollActivityTimersRef.current.forEach((timeoutId, el) => {
        window.clearTimeout(timeoutId);
        el.classList.remove("is-scrolling");
      });
      scrollActivityTimersRef.current.clear();
    };
  }, []);

  // If license already expired, auto-open the License Information modal
  useEffect(() => {
    if (typeof daysToExpiry === 'number' && daysToExpiry <= 0 && !expiredPopupShown) {
      // Defer to ensure Sidebar mounts and registers the event listener
      const t = setTimeout(() => {
        try { window.dispatchEvent(new Event('open-license-modal')); } catch {}
        setExpiredPopupShown(true);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [daysToExpiry, expiredPopupShown]);

  // ESC key functionality for going back (disabled on parent/root pages)
  useEffect(() => {
    // Build a set of parent routes where ESC should not trigger back navigation
    const baseParentRoutes = new Set<string>([
      "/",
      "/masters",
      "/hall-booking",
      "/user-management",
      "/reports",
      "/settings",
    ]);

    try {
      const raw = sessionStorage.getItem("user_modules");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const p of arr) {
            const r = (p && typeof p === "object" && (p.route || p.href)) ? String(p.route || p.href).trim() : "";
            if (r) baseParentRoutes.add(r);
          }
        }
      }
    } catch {}

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // Ignore Esc in form fields to avoid disrupting typing
      const target = event.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (target as any)?.isContentEditable;
      if (isEditable) return;

      // Do not navigate back on parent/root pages
      const path = location.pathname.replace(/\/$/, "");
      if (baseParentRoutes.has(path || "/")) {
        // Explicitly do nothing
        return;
      }

      event.preventDefault();
      navigate(-1);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate, location.pathname]);

  // Update time every minute for sidebar clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    setCurrentTime(new Date());
    return () => clearInterval(timer);
  }, []);

  // Compute license expiry and days left (show warning when <= 10 days and > 0)
  useEffect(() => {
    try {
      // 1) Try expiry from retail_master in session storage
      let expiry: string | undefined;
      try {
        const retailMasterRaw = sessionStorage.getItem('retail_master');
        if (retailMasterRaw) {
          const rm = JSON.parse(retailMasterRaw);
          expiry = rm?.expiry_date || rm?.expiryDate || rm?.license_expiry || undefined;
          if (!expiry) {
            // If no explicit expiry, try derive from license in retail master
            const keyFromRM = rm?.license_key || rm?.licenseKey || rm?.licencekey || undefined;
            const d = LicenseService.deriveExpiryFromLicenceKey(keyFromRM);
            if (d) expiry = d;
          }
        }
      } catch {}

      // 2) Fallback to deriving from localStorage licence key
      if (!expiry) {
        try {
          const localKey = localStorage.getItem('licencekey') || undefined;
          const derived = LicenseService.deriveExpiryFromLicenceKey(localKey || undefined);
          if (derived) expiry = derived;
        } catch {}
      }

      // 3) Fallback to license_info in session
      if (!expiry) {
        try {
          const licInfoRaw = sessionStorage.getItem('license_info');
          if (licInfoRaw) {
            const li = JSON.parse(licInfoRaw);
            expiry = li?.expiry_date || li?.expiryDate || undefined;
            if (!expiry) {
              const key = li?.license_key || li?.licenseKey || undefined;
              const d = LicenseService.deriveExpiryFromLicenceKey(key);
              if (d) expiry = d;
            }
          }
        } catch {}
      }

      if (!expiry) {
        setDaysToExpiry(null);
        setExpiryIso(null);
        return;
      }

      // Normalize to Date at midday to avoid timezone issues
      const parsed = (() => {
        // If looks like YYYYMMDD without separators
        const m = /^\d{8}$/.exec(String(expiry));
        if (m) {
          const y = Number(String(expiry).slice(0, 4));
          const mo = Number(String(expiry).slice(4, 6));
          const d = Number(String(expiry).slice(6, 8));
          const dt = new Date(y, mo - 1, d);
          dt.setHours(12, 0, 0, 0);
          return dt;
        }
        const dt = new Date(expiry);
        if (isNaN(dt.getTime())) return null;
        dt.setHours(12, 0, 0, 0);
        return dt;
      })();

      if (!parsed) {
        setDaysToExpiry(null);
        setExpiryIso(null);
        return;
      }

      const now = new Date();
      now.setHours(12, 0, 0, 0);
      const msInDay = 24 * 60 * 60 * 1000;
      const days = Math.ceil((parsed.getTime() - now.getTime()) / msInDay);

      setDaysToExpiry(days);
      setExpiryIso(parsed.toISOString());
    } catch (e) {
      console.warn('Failed to compute license expiry', e);
      setDaysToExpiry(null);
      setExpiryIso(null);
    }
  }, [location.pathname]);

  // Fullscreen toggle functionality
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Quick actions
  const handleQuickBilling = () => navigate("/pos-billing");
  const handleRefresh = () => window.location.reload();
  const handleCalculator = () => {
    // Open calculator once per click without duplicate attempts
    const ua = window.navigator.userAgent || '';
    const isWindows = /Windows/i.test(ua);
    const isMac = /Macintosh|Mac OS X/i.test(ua);

    if (isWindows) {
      // Use the Windows protocol handler (single attempt)
      try {
        const a = document.createElement('a');
        a.href = 'ms-calculator:';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        // Fallback: open a web calculator
        window.open('https://calculator.net/', '_blank');
      }
      return;
    }

    if (isMac) {
      // Browsers generally cannot launch macOS Calculator via scheme reliably; use web fallback
      window.open('https://calculator.net/', '_blank');
      return;
    }

    // Other platforms: open web calculator
    window.open('https://calculator.net/', '_blank');
  };

  // Capture only main content (exclude header & sidebar) and save as PNG
  const handleCaptureScreenshot = async () => {
    try {
      const { default: html2canvas } = await import("html2canvas");
      // Capture the visible viewport of the whole app so the screenshot matches what the user sees.
      const appRoot = (document.getElementById('root') as HTMLElement | null) || document.body;
      if (!appRoot) throw new Error("App root not found");

      const root = document.documentElement;
      const getEffectiveBg = (el: Element | null): string | null => {
        if (!el) return null;
        const bg = getComputedStyle(el as Element).backgroundColor;
        if (!bg) return null;
        const v = bg.toLowerCase();
        if (v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return null;
        return bg;
      };

      const bgColor =
        getEffectiveBg(appRoot as Element) ||
        getEffectiveBg(document.body) ||
        getEffectiveBg(root) ||
        (root.classList.contains('dark') ? '#0b1220' : '#f8fafc');

      const canvas = await html2canvas(appRoot as HTMLElement, {
        useCORS: true,
        logging: false,
        scale: 2,
        backgroundColor: bgColor,
        // Crop to the current viewport (prevents huge images / extra blank space)
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        removeContainer: true,
      });

      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const filename = `screenshot_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

      canvas.toBlob((blob) => {
        if (blob) {
          saveAs(blob, filename);
        }
      }, "image/png");
    } catch (err) {
      console.error("Failed to capture screenshot", err);
      try { alert("Failed to capture screenshot. Please try again."); } catch {}
    }
  };

  const loadModuleSuggestions = (): ModuleSuggestion[] => {
    const raw = sessionStorage.getItem("user_modules");
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as UserModule[];
      if (!Array.isArray(parsed)) return [];

      const out: ModuleSuggestion[] = [];
      const visit = (mods: UserModule[], parentTitle?: string) => {
        for (const mod of mods) {
          if (mod?.can_view === false) continue;
          const title = String(mod?.name || "").trim();
          const href = String(mod?.route || "").trim();
          const combinedTitle = parentTitle && title ? `${parentTitle} / ${title}` : title;

          if (href && href.startsWith("/") && combinedTitle) {
            out.push({ title: combinedTitle, href });
          }

          if (Array.isArray(mod?.children) && mod.children.length > 0) {
            visit(mod.children, title || parentTitle);
          }
        }
      };

      visit(parsed);

      const seen = new Set<string>();
      return out.filter((x) => {
        if (seen.has(x.href)) return false;
        seen.add(x.href);
        return true;
      });
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (!moduleSearchOpen) return;
    setModuleSearchQuery("");
    setModuleSuggestions(loadModuleSuggestions());
  }, [moduleSearchOpen]);

  // Notification helpers removed

  const toggleSection = (title: string) => {
    setOpenSections((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title],
    );
  };

  // Sidebar search removed: show all items
  const filterMenuItems = (items: MenuItem[]): MenuItem[] => items;

  const filterMenuItemsByRole = (items: MenuItem[]): MenuItem[] => {
    // Allow all menu items for all authenticated users
    return items;
  };

  const roleFilteredItems = filterMenuItemsByRole(menuItems);
  const filteredMenuItems = filterMenuItems(roleFilteredItems);

  const isActiveRoute = (href: string) => {
    if (href === "/") return location.pathname === "/";
    // Appointments: treat singular/plural and legacy variants as the same section
    if (href === "/appointments" || href === "/appointment") {
      const p = location.pathname;
      if (
        p.startsWith("/appointments") ||
        p.startsWith("/appointment") ||
        p.startsWith("/create-appointment")
      ) {
        return true;
      }
    }
    // Legacy: Some menus still use /hall-booking label/link for Appointments
    if (href === "/hall-booking") {
      const p = location.pathname;
      if (
        p.startsWith("/appointments") ||
        p.startsWith("/appointment") ||
        p.startsWith("/create-appointment") ||
        p.startsWith("/create-booking")
      ) {
        return true;
      }
    }
    // Treat create-booking as part of hall-booking section
    if (href === "/hall-booking" && location.pathname.startsWith("/create-booking")) return true;
    // Treat add/edit user pages as part of User Management
    if (href === "/user-management" && (location.pathname.startsWith("/add-user") || location.pathname.startsWith("/edit-user"))) return true;
    // Treat outdoor-booking as part of Event Booking
    if (href === "/event-booking" && location.pathname.startsWith("/outdoor-booking")) return true;
    // Treat all /assets routes as part of Asset Management
    if (href === "/asset-management" && location.pathname.startsWith("/assets")) return true;
    return location.pathname.startsWith(href);
  };

  // License banner visibility and severity
  const showLicenseBanner = typeof daysToExpiry === 'number' && daysToExpiry > 0 && daysToExpiry <= 10;
  const isCritical = typeof daysToExpiry === 'number' && daysToExpiry > 0 && daysToExpiry <= 5;

  return (
    <SidebarContext.Provider value={{ setSidebarCollapsed }}>
      <HeaderContext.Provider value={{ headerTitle, setHeaderTitle }}>
      <div className="relative min-h-screen flex flex-col bg-gradient-to-b from-slate-100 via-slate-50 to-white dark:from-slate-900 dark:via-slate-950 dark:to-black transition-colors">
        {/* Soft radial overlay to increase fade */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,_rgba(2,6,23,0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top_left,_rgba(148,163,184,0.10),transparent_55%)]"
        />
        {/* Header */}
        {!embed && (
        <header className="border-b bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 sticky top-0 z-50 shadow-sm overflow-hidden pt-[env(safe-area-inset-top)] print:hidden">
          <div className="flex h-[56px] items-center px-2 gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex-1 flex justify-center h-[56px] lg:justify-start min-w-0">
              <div className="flex items-center brand-container min-w-0">
                {/* Brand: GYM Pro */}
                <Link
                  to="/"
                  aria-label="GYM Pro home"
                  className="mr-3 inline-flex items-center select-none"
                >
                   <Bot className="h-5 w-5 mr-1.5 text-blue-600" />
                  <span className="hidden sm:inline text-xl font-normal tracking-wide">
                    <span className="text-red-600">Gym</span>
                    <span className="text-blue-600">Pro</span>
                  </span>
                  <span className="sm:hidden text-lg font-normal">
                    <span className="text-red-600">Gym</span>
                    <span className="text-blue-600">Pro</span>
                  </span>
                </Link>
                {/* License expiry message */}
                {showLicenseBanner && (
                  <>
                    {/* Compact version for small screens */}
                    <div
                      className={cn(
                        "md:hidden inline-flex items-center rounded px-2 py-0.5 border text-[11px] font-medium",
                        isCritical ? "bg-red-100 text-red-900 border-red-200" : "bg-amber-100 text-amber-900 border-amber-200",
                      )}
                    >
                      <AlertCircle className={cn("h-3 w-3 mr-1", isCritical ? "text-red-600" : "text-amber-600")} />
                      Expires in {daysToExpiry}d
                    </div>
                    {/* Responsive, multi-line version for md+ screens */}
                    <div
                      className={cn(
                        "hidden md:flex flex-wrap items-center gap-2 rounded-md px-3 py-1 border text-xs font-medium max-w-full",
                        isCritical ? "bg-red-100 text-red-900 border-red-200" : "bg-amber-100 text-amber-900 border-amber-200",
                      )}
                      style={{lineHeight: 1.25}}
                    >
                      <AlertCircle className={cn("h-3.5 w-3.5 shrink-0", isCritical ? "text-red-600" : "text-amber-600")} />
                      <span className="whitespace-normal break-words leading-snug">
                        License expiring soon: {`in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'}`}
                        {expiryIso ? ` (on ${format(new Date(expiryIso), 'dd MMM yyyy')})` : ''}. Contact 7397288500 or admin@techiesmagnifier.com to renew.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          try { window.dispatchEvent(new Event('open-license-modal')); } catch {}
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded border text-xs font-semibold shrink-0",
                          isCritical ? "bg-red-200/60 border-red-300 text-red-900 hover:bg-red-200" : "bg-amber-200/60 border-amber-300 text-amber-900 hover:bg-amber-200"
                        )}
                      >
                        Click now
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Header title slot (center area) */}
            {/* <div className="flex-1 flex justify-center lg:justify-start">
              <div className="w-full flex justify-center lg:justify-start">
                <div className="hidden lg:block ml-6">
                  <div className="text-lg font-semibold text-slate-800">{headerTitle}</div>
                </div>
              </div>
            </div> */}

            {/* Header Actions */}
            <div className="flex items-center space-x-2 shrink-0 pr-1">
              {/* Quick Actions */}
              <div className="hidden sm:flex items-center space-x-1">
                {/* AI Assistant */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setAiOpen(true)}
                  title="Open AI Assistant"
                  className="h-9 w-9 hover:bg-blue-50 hover:text-blue-600"
                >
                  <Bot className="h-4 w-4" />
                </Button>
                
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCaptureScreenshot}
                  title="Capture Screenshot"
                  className="h-9 w-9 hover:bg-green-50 hover:text-green-600"
                >
                  <Camera className="h-4 w-4" />
                </Button>
                
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRefresh}
                  title="Refresh"
                  className="h-9 w-9 hover:bg-orange-50 hover:text-orange-600"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {/* Module Search */}
              <Popover open={moduleSearchOpen} onOpenChange={setModuleSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Search modules"
                    className="h-9 w-9 hover:bg-slate-50 hover:text-slate-700"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-0">
                  <Command>
                    <CommandInput
                      placeholder="Search modules..."
                      value={moduleSearchQuery}
                      onValueChange={setModuleSearchQuery}
                      autoFocus
                    />
                    <CommandList>
                      <CommandEmpty>No modules found.</CommandEmpty>
                      <CommandGroup heading="Modules">
                        {moduleSuggestions.map((m) => (
                          <CommandItem
                            key={m.href}
                            value={`${m.title} ${m.href}`}
                            onSelect={() => {
                              setModuleSearchOpen(false);
                              setModuleSearchQuery("");
                              navigate(m.href);
                            }}
                          >
                            <div className="flex flex-col">
                              <span>{m.title}</span>
                              <span className="text-xs text-muted-foreground">{m.href}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Notification icon hidden in header */}
              <div className="hidden">
                {/* NotificationBell removed */}
              </div>

              {/* Fullscreen Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                className="h-9 w-9 hover:bg-slate-50 hover:text-slate-600 hidden sm:inline-flex"
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>

              {/* Mobile: condensed actions menu */}
              <div className="sm:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => setAiOpen(true)}>
                      <Bot className="mr-2 h-4 w-4" /> AI Assistant
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleCaptureScreenshot}>
                      <Camera className="mr-2 h-4 w-4" /> Screenshot
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleRefresh}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={toggleFullscreen}>
                      {isFullscreen ? (
                        <Minimize2 className="mr-2 h-4 w-4" />
                      ) : (
                        <Maximize2 className="mr-2 h-4 w-4" />
                      )}
                      {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* User Menu */}
              <div className="flex items-center border-l pl-3 ml-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center gap-2 rounded-full hover:bg-slate-100 transition-colors p-1"
                      aria-label="User menu"
                    >
                      <Avatar className="h-9 w-9 ring-1 ring-slate-200">
                        {/* Provide an AvatarImage src if available later */}
                        <AvatarImage src="" alt="User" />
                        <AvatarFallback className="bg-slate-200 text-slate-700 text-sm font-semibold">
                          {(user?.username || 'A').slice(0,1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
                      <div className="text-xs text-slate-500">Signed in as</div>
                      <div className="text-sm font-semibold text-slate-800 truncate">{user?.username || 'Admin'}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 focus:bg-red-100 focus:text-red-700">
                      <LogOut className="mr-2 h-4 w-4" /> Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

  </header>
  )}

        <div className="flex flex-1">
          {/* Sidebar (extracted) */}
          {!embed && (
            <div className="print:hidden">
              <Sidebar
                collapsed={sidebarCollapsed}
                minimized={sidebarMinimized}
                setCollapsed={setSidebarCollapsed}
                setMinimized={setSidebarMinimized}
                isActiveRoute={isActiveRoute}
                user={user}
              />
            </div>
          )}

          {/* Main Content */}
          <main
            className={cn(
              "flex-1 min-h-screen transition-all print:pl-0",
              embed ? "pl-0" : (sidebarCollapsed ? "pl-0" : sidebarMinimized ? "pl-16" : "pl-52"),
            )}
          >
            <div
              ref={contentRef}
              className={cn(
                "min-h-full print:p-0",
                embed ? "p-0" : "px-1 pt-3 pb-4",
              )}
            >
              <Outlet />
            </div>
          </main>
        </div>

        {/* Mobile Sidebar Overlay */}
        {!embed && !sidebarCollapsed && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarCollapsed(true)}
          />
        )}
      {/* AI Chatbot Modal */}
      {!embed && <AIChatbotModal open={aiOpen} onOpenChange={setAiOpen} />}
      </div>
      </HeaderContext.Provider>
    </SidebarContext.Provider>
  );
}
