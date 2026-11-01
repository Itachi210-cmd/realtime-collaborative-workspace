"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Edit2,
  Trash2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export interface PageNode {
  id: string;
  title: string;
  icon?: string;
  children?: PageNode[];
}

const INITIAL_PAGE_TREE: PageNode[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: "🚀",
    children: [
      { id: "quickstart", title: "Quickstart Guide", icon: "⚡" },
      { id: "architecture-overview", title: "Architecture Blueprint", icon: "📐" },
    ],
  },
  {
    id: "project-spec",
    title: "Project Blueprint",
    icon: "📚",
    children: [
      { id: "crdt-spec", title: "CRDT & Yjs Synchronization", icon: "🔄" },
      { id: "schema-spec", title: "PostgreSQL Data Models", icon: "🗄️" },
    ],
  },
  {
    id: "meeting-notes",
    title: "Engineering Sync",
    icon: "📝",
  },
  {
    id: "sprint-roadmap",
    title: "Sprint Goals & Milestones",
    icon: "🎯",
  },
];

interface PageTreeProps {
  workspaceId: string;
}

function collectPageIds(nodes: PageNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.children && node.children.length > 0) {
      ids.push(...collectPageIds(node.children));
    }
  }
  return ids;
}

function PageTreeInner({ workspaceId }: PageTreeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPageId = searchParams.get("page") || "";
  const { addToast } = useToast();

  const [pages, setPages] = useState<PageNode[]>(INITIAL_PAGE_TREE);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    "getting-started": true,
    "project-spec": false,
  });

  // Action dialog state
  const [activeActionNode, setActiveActionNode] = useState<PageNode | null>(null);
  const [actionType, setActionType] = useState<"rename" | "delete" | "create" | null>(null);
  const [parentNodeId, setParentNodeId] = useState<string | null>(null);
  const [inputVal, setInputVal] = useState("");

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedNodes((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleOpenRename = (node: PageNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveActionNode(node);
    setInputVal(node.title);
    setActionType("rename");
  };

  const handleOpenDelete = (node: PageNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveActionNode(node);
    setActionType("delete");
  };

  const handleOpenCreate = (parentId: string | null = null, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setParentNodeId(parentId);
    setInputVal("");
    setActionType("create");
  };

  const handleExecuteAction = () => {
    if (actionType === "rename" && activeActionNode) {
      const updateTitle = (nodes: PageNode[]): PageNode[] =>
        nodes.map((node) => {
          if (node.id === activeActionNode.id) {
            return { ...node, title: inputVal.trim() || node.title };
          }
          if (node.children) {
            return { ...node, children: updateTitle(node.children) };
          }
          return node;
        });

      setPages(updateTitle(pages));
      addToast({
        message: "Page renamed",
        description: `Renamed to "${inputVal.trim()}"`,
        variant: "success",
      });
    } else if (actionType === "delete" && activeActionNode) {
      const removeNode = (nodes: PageNode[]): PageNode[] =>
        nodes
          .filter((node) => node.id !== activeActionNode.id)
          .map((node) => {
            if (node.children) {
              return { ...node, children: removeNode(node.children) };
            }
            return node;
          });

      const updatedPages = removeNode(pages);
      setPages(updatedPages);

      // Check if the deleted page was currently active in the view
      const wasActivePage = activeActionNode.id === currentPageId;
      if (wasActivePage) {
        const remainingIds = collectPageIds(updatedPages);
        if (remainingIds.length > 0) {
          // Navigate cleanly to the next available page
          router.push(`/workspace/${workspaceId}?page=${remainingIds[0]}`);
          addToast({
            message: "Active page deleted",
            description: `Navigated to remaining page.`,
            variant: "info",
          });
        } else {
          // No pages remain in workspace
          router.push(`/workspace/${workspaceId}`);
          addToast({
            message: "Page deleted",
            description: "No remaining pages in this workspace.",
            variant: "info",
          });
        }
      } else {
        addToast({
          message: "Page deleted",
          description: `Removed "${activeActionNode.title}"`,
          variant: "info",
        });
      }
    } else if (actionType === "create") {
      const newPageId = `page-${Date.now().toString().slice(-4)}`;
      const newPage: PageNode = {
        id: newPageId,
        title: inputVal.trim() || "Untitled Document",
        icon: "📄",
      };

      if (!parentNodeId) {
        setPages((prev) => [...prev, newPage]);
      } else {
        const insertChild = (nodes: PageNode[]): PageNode[] =>
          nodes.map((node) => {
            if (node.id === parentNodeId) {
              return {
                ...node,
                children: [...(node.children || []), newPage],
              };
            }
            if (node.children) {
              return { ...node, children: insertChild(node.children) };
            }
            return node;
          });

        setPages(insertChild(pages));
        setExpandedNodes((prev) => ({ ...prev, [parentNodeId]: true }));
      }

      // Navigate immediately to the newly created page
      router.push(`/workspace/${workspaceId}?page=${newPageId}`);

      addToast({
        message: "Page created",
        description: `Created and opened "${newPage.title}"`,
        variant: "success",
      });
    }

    setActionType(null);
    setActiveActionNode(null);
  };

  const renderNode = (node: PageNode, depth = 0) => {
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isExpanded = Boolean(expandedNodes[node.id]);
    const isActive =
      pathname.startsWith(`/workspace/${workspaceId}`) &&
      currentPageId === node.id;

    return (
      <div key={node.id} className="w-full">
        <div
          className={cn(
            "group flex items-center justify-between py-1 px-2 rounded-md text-xs transition-colors cursor-pointer select-none",
            isActive
              ? "bg-[#efefed] text-[#37352f] font-medium"
              : "text-neutral-600 hover:bg-[#efefed] hover:text-[#37352f]"
          )}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {/* Main click link */}
          <Link
            href={`/workspace/${workspaceId}?page=${node.id}`}
            className="flex items-center gap-1.5 min-w-0 flex-1 py-0.5"
          >
            {hasChildren ? (
              <button
                onClick={(e) => toggleExpand(node.id, e)}
                className="p-0.5 -ml-1 text-neutral-400 hover:text-neutral-700 rounded transition-transform"
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5 -ml-1 inline-block" />
            )}

            <span className="text-sm shrink-0">{node.icon || "📄"}</span>
            <span className="truncate flex-1">{node.title}</span>
          </Link>

          {/* Context Actions (Rename / Delete / Add Subpage) */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0 ml-1">
            <button
              onClick={(e) => handleOpenCreate(node.id, e)}
              className="p-1 rounded text-neutral-400 hover:text-neutral-800 hover:bg-neutral-200/60"
              title="Add nested subpage"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => handleOpenRename(node, e)}
              className="p-1 rounded text-neutral-400 hover:text-neutral-800 hover:bg-neutral-200/60"
              title="Rename page"
            >
              <Edit2 className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => handleOpenDelete(node, e)}
              className="p-1 rounded text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
              title="Delete page"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Children Render */}
        {hasChildren && isExpanded && (
          <div className="space-y-0.5">
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full space-y-1">
      {/* Pages Header */}
      <div className="flex items-center justify-between px-2 pt-2 pb-1 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
        <span>Pages Tree</span>
        <button
          onClick={(e) => handleOpenCreate(null, e)}
          className="p-1 rounded hover:bg-[#efefed] text-neutral-400 hover:text-neutral-700 transition-colors"
          title="Create top-level page"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Pages List or Empty State */}
      {pages.length === 0 ? (
        <div className="px-2 py-4 text-center space-y-1.5 bg-neutral-50/60 rounded-md border border-dashed border-neutral-200">
          <FileText className="w-4 h-4 text-neutral-400 mx-auto" />
          <p className="text-[11px] text-neutral-500">No pages yet</p>
          <button
            onClick={(e) => handleOpenCreate(null, e)}
            className="text-[11px] font-medium text-[#2383e2] hover:underline"
          >
            + Add a page
          </button>
        </div>
      ) : (
        <nav className="space-y-0.5">{pages.map((node) => renderNode(node, 0))}</nav>
      )}

      {/* Action Dialog (Rename / Delete / Create) */}
      <Dialog
        isOpen={actionType !== null}
        onClose={() => setActionType(null)}
        title={
          actionType === "rename"
            ? "Rename Page"
            : actionType === "delete"
            ? "Delete Page"
            : parentNodeId
            ? "Create Subpage"
            : "Create Page"
        }
        description={
          actionType === "delete"
            ? `Are you sure you want to delete "${activeActionNode?.title}"? This cannot be undone.`
            : "Enter a title for this page."
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActionType(null)}
            >
              Cancel
            </Button>
            <Button
              variant={actionType === "delete" ? "danger" : "primary"}
              size="sm"
              onClick={handleExecuteAction}
            >
              {actionType === "rename"
                ? "Rename"
                : actionType === "delete"
                ? "Confirm Delete"
                : "Create Page"}
            </Button>
          </>
        }
      >
        {actionType === "delete" ? (
          <p className="text-xs text-neutral-600">
            Deleting this page will remove it from the workspace page tree navigation. If it is currently open, you will be redirected to the next available page.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleExecuteAction();
            }}
            className="space-y-3"
          >
            <Input
              id="page-title-input"
              label="Page Title"
              placeholder="e.g. Sprint Planning, Project Specs"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              autoFocus
            />
          </form>
        )}
      </Dialog>
    </div>
  );
}

export function PageTree(props: PageTreeProps) {
  return (
    <Suspense
      fallback={
        <div className="px-2 py-3 space-y-1">
          <div className="h-3 w-16 bg-[#efefed] rounded animate-pulse" />
          <div className="h-5 w-full bg-[#efefed] rounded animate-pulse" />
          <div className="h-5 w-full bg-[#efefed] rounded animate-pulse" />
        </div>
      }
    >
      <PageTreeInner {...props} />
    </Suspense>
  );
}
