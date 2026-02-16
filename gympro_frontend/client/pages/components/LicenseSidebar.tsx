import { PlusCircle, List, AlertTriangle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface LicenseSidebarProps {
    activeView: string;
    onNavigate: (view: string) => void;
}

export function LicenseSidebar({ activeView, onNavigate }: LicenseSidebarProps) {
    const menuItems = [
        { id: "creation", label: "License Creation", icon: PlusCircle },
        { id: "management", label: "Management", icon: List },
        { id: "expire", label: "License Expire", icon: AlertTriangle },
        { id: "invoice", label: "Invoice Generator", icon: FileText },
    ];

    return (
        <aside className="w-64 bg-white/50 backdrop-blur-sm border-r border-gray-200 flex-shrink-0 h-full">
            <div className="p-4 h-full flex flex-col">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">Menu</h2>
                <nav className="space-y-1 flex-1">
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            className={cn(
                                "w-full flex items-center space-x-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200",
                                activeView === item.id
                                    ? "bg-blue-100 text-blue-700 font-semibold"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <item.icon className={cn("h-4 w-4", activeView === item.id ? "text-blue-600" : "text-gray-500")} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>
            </div>
        </aside>
    );
}
