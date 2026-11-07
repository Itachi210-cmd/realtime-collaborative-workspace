import { NextResponse } from "next/server";
import { checkWorkspaceAccess } from "@/lib/auth/workspace-auth";
import {
  workspaceEvents,
  type WorkspacePageEvent,
} from "@/lib/events/workspace-events";

interface RouteParams {
  params: Promise<{
    workspaceId: string;
  }>;
}

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/[workspaceId]/pages/events
 * Real-time Server-Sent Events (SSE) stream for workspace page hierarchy changes.
 * Scoped strictly to authorized workspace members.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;

    // 1. Authorize: verify user is authenticated and is a valid workspace member
    const authCheck = await checkWorkspaceAccess(workspaceId);
    if (!authCheck.success) {
      return NextResponse.json(
        { error: authCheck.error },
        {
          status: authCheck.status,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    const encoder = new TextEncoder();

    // 2. Setup SSE ReadableStream
    let isClosed = false;
    let pingTimer: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection confirmation
        const connectMsg = `data: ${JSON.stringify({ type: "CONNECTED", workspaceId })}\n\n`;
        controller.enqueue(encoder.encode(connectMsg));

        // Handler for workspace page events
        const eventHandler = (event: WorkspacePageEvent) => {
          if (isClosed) return;
          try {
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          } catch {
            // Stream closed or broken
          }
        };

        workspaceEvents.onWorkspaceEvent(workspaceId, eventHandler);

        // Keep-alive heartbeat ping every 15 seconds to prevent network timeouts
        pingTimer = setInterval(() => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // Stream closed
          }
        }, 15000);

        // Cleanup handler on client disconnect or abort
        const cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
          }
          workspaceEvents.offWorkspaceEvent(workspaceId, eventHandler);
          try {
            controller.close();
          } catch {}
        };

        request.signal.addEventListener("abort", cleanup);
      },
      cancel() {
        isClosed = true;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform, must-revalidate",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[WORKSPACE_PAGES_EVENTS_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

