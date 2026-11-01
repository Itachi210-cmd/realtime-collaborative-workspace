"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Edit2,
  Trash2,
  FileText,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  PageItem,
  getWorkspacePages,
  createPage,
  renamePage,
  deletePage,
} from "@/lib/api/workspaces";

export interface PageNode {
  id: string;
  title: string;
  icon?: string;
  parentPageId?: string | null;
  children?: PageNode[];
}

function buildPageTree(items: PageItem[]): PageNode[] {
  const itemMap = new Map<string, PageNode>();
  const rootNodes: PageNode[] = [];

  for (const item of items) {
    itemMap.set(item.id, {
      id: item.id,
      title: item.title,
      icon: "📄",
      parentPageId: item.parentPageId,
      children: [],
    });
  }

  for (const item of items) {
    const node = itemMap.get(item.id)!;
    if (item.parentPageId && itemMap.has(item.parentPageId)) {
      itemMap.get(item.parentPageId)!.children!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  return rootNodes;
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

interface PageTreeProps {
  workspaceId: string;
}

function PageTreeInner({ workspaceId }: PageTreeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPageId = searchParams.get("page") || "";
  const { addToast } = useToast();

  const [rawPages, setRawPages] = useState<PageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Action dialog state
  const [activeActionNode, setActiveActionNode] = useState<PageNode | null>(null);
  const [actionType, setActionType] = useState<"rename" | "delete" | "create" | null>(null);
  const [parentNodeId, setParentNodeId] = useState<string | null>(null);
  const [inputVal, setInputVal] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let isMounted = true;
    getWorkspacePages(workspaceId)
      .then((data) => {
        if (isMounted) {
          setRawPages(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  const treeNodes = buildPageTree(rawPages);

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

  const handleExecuteAction = async () => {
    if (isSubmitting) return;

    if (actionType === "rename" && activeActionNode) {
      const trimmed = inputVal.trim();
      if (!trimmed) return;
      setIsSubmitting(true);
      try {
        const updated = await renamePage(workspaceId, activeActionNode.id, trimmed);
        setRawPages((prev) =>
          prev.map((p) => (p.id === updated.id ? { ...p, title: updated.title } : p))
        );
        addToast({
          message: "Page renamed",
          description: `Renamed to "${updated.title}"`,
          variant: "success",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to rename page";
        addToast({
          message: "Error renaming page",
          description: msg,
          variant: "error",
        });
      } finally {
        setIsSubmitting(false);
        setActionType(null);
        setActiveActionNode(null);
      }
    } else if (actionType === "delete" && activeActionNode) {
      setIsSubmitting(true);
      try {
        await deletePage(workspaceId, activeActionNode.id);
        const updatedRaw = rawPages.filter(
          (p) => p.id !== activeActionNode.id && p.parentPageId !== activeActionNode.id
        );
        setRawPages(updatedRaw);

        // Check if the deleted page was currently active in the view
        const wasActivePage = activeActionNode.id === currentPageId;
        if (wasActivePage) {
          const remainingTree = buildPageTree(updatedRaw);
          const remainingIds = collectPageIds(remainingTree);
          if (remainingIds.length > 0) {
            router.push(`/workspace/${workspaceId}?page=${remainingIds[0]}`);
            addToast({
              message: "Active page deleted",
              description: "Navigated to remaining page.",
              variant: "info",
            });
          } else {
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to delete page";
        addToast({
          message: "Error deleting page",
          description: msg,
          variant: "error",
        });
      } finally {
        setIsSubmitting(false);
        setActionType(null);
        setActiveActionNode(null);
      }
    } else if (actionType === "create") {
      const title = inputVal.trim() || "Untitled Document";
      setIsSubmitting(true);
      try {
        const created = await createPage(workspaceId, title, parentNodeId);
        setRawPages((prev) => [...prev, created]);

        if (parentNodeId) {
          setExpandedNodes((prev) => ({ ...prev, [parentNodeId]: true }));
        }

        router.push(`/workspace/${workspaceId}?page=${created.id}`);

        addToast({
          message: "Page created",
          description: `Created and opened "${created.title}"`,
          variant: "success",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to create page";
        addToast({
          message: "Error creating page",
          description: msg,
          variant: "error",
        });
      } finally {
        setIsSubmitting(false);
        setActionType(null);
        setActiveActionNode(null);
      }
    }
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

      {/* Pages List or Empty / Loading State */}
      {isLoading ? (
        <div className="px-2 py-3 space-y-1">
          <div className="h-4 w-28 bg-[#efefed] rounded animate-pulse" />
          <div className="h-6 w-full bg-[#efefed] rounded animate-pulse" />
          <div className="h-6 w-full bg-[#efefed] rounded animate-pulse" />
        </div>
      ) : treeNodes.length === 0 ? (
        <div className="px-2 py-4 text-center space-y-1.5 bg-neutral-50/60 rounded-md border border-dashed border-neutral-200">
          <FileText className="w-4 h-4 text-neutral-400 mx-auto" />
          <p className="text-[11px] text-neutral-500">No pages yet</p>
          <button
            onClick={(e) => handleOpenCreate(null, e)}
            className="text-[11px] font-medium text-[#2383e2] hover:underline cursor-pointer"
          >
            + Add a page
          </button>
        </div>
      ) : (
        <nav className="space-y-0.5">{treeNodes.map((node) => renderNode(node, 0))}</nav>
      )}

      {/* Action Dialog (Rename / Delete / Create) */}
      <Dialog
        isOpen={actionType !== null}
        onClose={() => {
          if (!isSubmitting) {
            setActionType(null);
            setActiveActionNode(null);
          }
        }}
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
              onClick={() => {
                setActionType(null);
                setActiveActionNode(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant={actionType === "delete" ? "danger" : "primary"}
              size="sm"
              onClick={handleExecuteAction}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : actionType === "rename" ? (
                "Rename"
              ) : actionType === "delete" ? (
                "Confirm Delete"
              ) : (
                "Create Page"
              )}
            </Button>
          </>
        }
      >
        {actionType === "delete" ? (
          <p className="text-xs text-neutral-600">
            Deleting this page will remove it and any nested subpages from the database.
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
              disabled={isSubmitting}
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
