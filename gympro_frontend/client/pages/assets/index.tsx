import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from 'lucide-react';
import { getLucideIcon } from '@/components/LucideIcon';

type AssetModule = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  link: string;
  description?: string;
};

// Dynamic lucide icon resolver; supports any icon name coming from backend

export default function AssetIndex() {
  const navigate = useNavigate();
  const [assetModules, setAssetModules] = useState<AssetModule[]>([]);

  // Colored icon accents per module title
  const pickColors = (title: string) => {
    const t = String(title || '').toLowerCase();
    if (t.includes('income') || t.includes('cash') || t.includes('expense')) {
      return { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-200/60' };
    }
    if (t.includes('purchase')) {
      return { bg: 'bg-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-200/60' };
    }
    if (t.includes('transfer')) {
      return { bg: 'bg-sky-100', text: 'text-sky-700', ring: 'ring-sky-200/60' };
    }
    if (t.includes('disposal') || t.includes('dispose')) {
      return { bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-200/60' };
    }
    if (t.includes('report')) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-200/60' };
    }
    return { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200/60' };
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('user_modules');
      if (!raw) { setAssetModules([]); return; }
      const modules = JSON.parse(raw);
      const parents: any[] = Array.isArray(modules) ? modules : [];
      // Find the Asset parent by name or route (supports both 'asset' and 'assets')
      const assetParent = parents.find((p: any) => {
        const name = String(p?.name || '').toLowerCase();
        const route = String(p?.route || '');
        return name === 'asset' || name === 'assets' || route.startsWith('/asset') || route.startsWith('/assets');
      });
      if (!assetParent || !Array.isArray(assetParent.children)) { setAssetModules([]); return; }
      const children = assetParent.children as any[];
      const mapped: AssetModule[] = children
        .filter(c => (c?.can_view ?? 0) === 1)
        .map(c => ({
          title: String(c?.name ?? ''),
          icon: getLucideIcon(String(c?.icon || 'FileText'), FileText),
          link: String(c?.route ?? '#'),
          description: undefined,
        }));
      setAssetModules(mapped);
    } catch (e) {
      console.warn('Failed to parse user_modules for assets:', e);
      setAssetModules([]);
    }
  }, []);

  const handleModuleClick = (link: string) => {
    navigate(link);
  };

  return (
    <div>
      <div className="space-y-4">
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-3">
          {assetModules.map((module, index) => (
            <div
              key={index}
              onClick={() => handleModuleClick(module.link)}
              role="button"
              tabIndex={0}
              className="group block p-3 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
            >
              <div className="flex items-center space-x-2.5">
                <div className="flex-shrink-0">
                  {(() => { const c = pickColors(module.title); return (
                    <div className={[
                      'p-1.5 rounded-md transition-colors duration-200 ring-1 ring-inset',
                      c.bg, c.ring, 'group-hover:brightness-110'
                    ].join(' ')}>
                      <module.icon className={[ 'h-4 w-4', c.text ].join(' ')} />
                    </div>
                  ); })()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-slate-900 transition-colors duration-200">
                    {module.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                    {module.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
