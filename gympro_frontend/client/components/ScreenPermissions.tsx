import React, { useState, useEffect } from 'react';
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Minus } from "lucide-react";

interface Module {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  route?: string;
  display_order: number;
  is_active: number;
  parent_id?: number | null;
  created_at: string;
  updated_at: string;
}

interface ScreenPermissionsProps {
  modules: Module[];
  permissions: { [key: string]: { view: boolean; edit: boolean } };
  onPermissionChange: (moduleId: string, permission: "view" | "edit", checked: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}



const ScreenPermissions: React.FC<ScreenPermissionsProps> = ({
  modules,
  permissions,
  onPermissionChange,
  onSelectAll,
  onDeselectAll,
}) => {
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());

  // Use only the modules provided from the parent component
  const displayModules = modules;

  // Group modules hierarchically: parent modules with their children
  const hierarchicalModules = displayModules.reduce((acc, module) => {
    if (module.parent_id === null) {
      // This is a parent module
      const children = displayModules.filter(child => child.parent_id === module.id);
      acc.push({
        parent: module,
        children: children.sort((a, b) => a.display_order - b.display_order)
      });
    }
    return acc;
  }, [] as Array<{ parent: Module; children: Module[] }>)
    .sort((a, b) => a.parent.display_order - b.parent.display_order);

  const toggleExpanded = (moduleId: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setExpandedModules(prev => {
      const newSet = new Set(prev);
      if (newSet.has(moduleId)) {
        newSet.delete(moduleId);
      } else {
        newSet.add(moduleId);
      }
      return newSet;
    });
  };

  const handleParentPermissionChange = (parent: Module, children: Module[], checked: boolean) => {
    // Update parent permissions
    onPermissionChange(parent.id.toString(), "view", checked);
    if (!checked) {
      onPermissionChange(parent.id.toString(), "edit", false);
    }
    
    // Update all children permissions
    children.forEach(child => {
      onPermissionChange(child.id.toString(), "view", checked);
      if (!checked) {
        onPermissionChange(child.id.toString(), "edit", false);
      }
    });
  };

  const isParentChecked = (parent: Module, children: Module[]) => {
    const parentPermissions = permissions[parent.id.toString()];
    const hasParentPermissions = parentPermissions?.view || parentPermissions?.edit;
    
    if (hasParentPermissions) return true;
    
    // Check if any children are selected
    return children.some(child => {
      const childPermissions = permissions[child.id.toString()];
      return childPermissions?.view || childPermissions?.edit;
    });
  };

  const isParentIndeterminate = (parent: Module, children: Module[]) => {
    const parentPermissions = permissions[parent.id.toString()];
    const hasParentPermissions = parentPermissions?.view || parentPermissions?.edit;
    
    if (hasParentPermissions) return false;
    
    // Check if some but not all children are selected
    const selectedChildren = children.filter(child => {
      const childPermissions = permissions[child.id.toString()];
      return childPermissions?.view || childPermissions?.edit;
    });
    
    return selectedChildren.length > 0 && selectedChildren.length < children.length;
  };

  // No imperative indeterminate toggling; handled via controlled "checked" below

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-3 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Screen Permissions</h3>
        <button 
          type="button"
          className="text-gray-300 hover:text-white"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="bg-green-50 p-4 min-h-[400px]">
        {displayModules.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-gray-500 mb-2">No modules available</p>
              <p className="text-sm text-gray-400">Please contact your administrator to configure screen permissions.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Action Buttons */}
            <div className="flex space-x-3 mb-6">
          <Button
            type="button"
            onClick={onSelectAll}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Select All
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDeselectAll}
            className="border-green-600 text-green-600 hover:bg-green-50 px-4 py-2 rounded text-sm font-medium"
          >
            Deselect All
          </Button>
        </div>

        {/* Permissions List */}
        <div className="space-y-3">
          {hierarchicalModules.map(({ parent, children }) => {
            const parentId = parent.id.toString();
            const parentPermissions = permissions[parentId] || { view: false, edit: false };
            const hasChildren = children.length > 0;
            const isExpanded = expandedModules.has(parent.id);
            const isChecked = isParentChecked(parent, children);
            const isIndeterminate = isParentIndeterminate(parent, children);

            return (
              <div key={parent.id} className="space-y-2">
                {/* Parent Module */}
                <div className="flex items-center justify-between py-2 px-2">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id={`parent-${parent.id}`}
                      checked={isChecked}
                      onCheckedChange={(checked) => 
                        handleParentPermissionChange(parent, children, !!checked)
                      }
                      className="border-gray-300"
                    />
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-green-800 text-sm">{parent.name}</span>
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={(e) => toggleExpanded(parent.id, e)}
                          className="text-green-600 hover:text-green-800"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Parent Permission Options */}
                  <div className="flex space-x-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`parent-${parent.id}-view`}
                        checked={parentPermissions.view}
                        onCheckedChange={(checked) => 
                          onPermissionChange(parentId, "view", !!checked)
                        }
                        className="border-gray-300"
                      />
                      <span className="text-sm text-gray-600">View</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`parent-${parent.id}-edit`}
                        checked={parentPermissions.edit}
                        onCheckedChange={(checked) => 
                          onPermissionChange(parentId, "edit", !!checked)
                        }
                        className="border-gray-300"
                      />
                      <span className="text-sm text-gray-600">Edit</span>
                    </div>
                  </div>
                </div>

                {/* Child Modules */}
                {hasChildren && isExpanded && (
                  <div className="ml-6 space-y-2 relative">
                    <div className="absolute left-2 top-0 bottom-0 w-px bg-green-300"></div>
                    {children.map((child) => {
                      const childId = child.id.toString();
                      const childPermissions = permissions[childId] || { view: false, edit: false };
                      
                      return (
                        <div key={child.id} className="flex items-center justify-between py-2 px-2 relative">
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id={`child-${child.id}`}
                              checked={childPermissions.view || childPermissions.edit}
                              onCheckedChange={(checked) => {
                                onPermissionChange(childId, "view", !!checked);
                                if (!checked) {
                                  onPermissionChange(childId, "edit", false);
                                }
                              }}
                              className="border-gray-300"
                            />
                            <span className="text-gray-700 text-sm">{child.name}</span>
                          </div>
                          
                          {/* Child Permission Options */}
                          <div className="flex space-x-6">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`child-${child.id}-view`}
                                checked={childPermissions.view}
                                onCheckedChange={(checked) => 
                                  onPermissionChange(childId, "view", !!checked)
                                }
                                className="border-gray-300"
                              />
                              <span className="text-sm text-gray-600">View</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`child-${child.id}-edit`}
                                checked={childPermissions.edit}
                                onCheckedChange={(checked) => 
                                  onPermissionChange(childId, "edit", !!checked)
                                }
                                className="border-gray-300"
                              />
                              <span className="text-sm text-gray-600">Edit</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
                      })}
          </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ScreenPermissions;
