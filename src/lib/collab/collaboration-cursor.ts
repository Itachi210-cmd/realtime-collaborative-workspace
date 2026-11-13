/**
 * Collaborative Cursor Extension for TipTap using @tiptap/y-tiptap
 *
 * Resolves the TipTap 3 breaking change where @tiptap/extension-collaboration
 * uses @tiptap/y-tiptap's ySyncPluginKey rather than legacy y-prosemirror's key,
 * preventing "Cannot read properties of undefined (reading 'doc')" errors.
 */

import { Extension } from "@tiptap/core";
import { defaultSelectionBuilder, yCursorPlugin } from "@tiptap/y-tiptap";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const awarenessStatesToArray = (states: Map<number, Record<string, any>>) => {
  return Array.from(states.entries()).map(([key, value]) => ({
    clientId: key,
    ...value.user,
  }));
};

export interface CollabCursorUser {
  id?: string | null;
  name?: string | null;
  color?: string | null;
  email?: string | null;
  role?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface CollabCursorOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: { awareness: any } | null;
  user: CollabCursorUser;
  render?: (user: CollabCursorUser) => HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectionRender?: any;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    collaborationCursor: {
      updateUser: (attributes: CollabCursorUser) => ReturnType;
    };
  }
}

interface AwarenessLike {
  on: (event: string, cb: () => void) => void;
  off: (event: string, cb: () => void) => void;
}

const awarenessCleanupMap = new WeakMap<object, { awareness: AwarenessLike; handler: () => void }>();

export const CollaborationCursor = Extension.create<CollabCursorOptions>({
  name: "collaborationCursor",

  addOptions() {
    return {
      provider: null,
      user: {
        name: null,
        color: null,
      },
      render: (user: CollabCursorUser) => {
        const cursor = document.createElement("span");
        cursor.classList.add("collaboration-cursor__caret");
        if (user.color) {
          cursor.setAttribute("style", `border-color: ${user.color}`);
        }
        const label = document.createElement("div");
        label.classList.add("collaboration-cursor__label");
        if (user.color) {
          label.setAttribute("style", `background-color: ${user.color}`);
        }
        label.insertBefore(document.createTextNode(user.name || "Anonymous"), null);

        const nonBreakingSpace1 = document.createTextNode("\u2060");
        const nonBreakingSpace2 = document.createTextNode("\u2060");

        cursor.insertBefore(nonBreakingSpace1, null);
        cursor.insertBefore(label, null);
        cursor.insertBefore(nonBreakingSpace2, null);
        return cursor;
      },
      selectionRender: defaultSelectionBuilder,
    };
  },

  addStorage() {
    return {
      users: [],
    };
  },

  addCommands() {
    return {
      updateUser: (attributes: CollabCursorUser) => () => {
        this.options.user = attributes;
        if (this.options.provider?.awareness) {
          const currentLocalUser = this.options.provider.awareness.getLocalState()?.user;
          this.options.provider.awareness.setLocalStateField("user", {
            ...(typeof currentLocalUser === "object" ? currentLocalUser : {}),
            ...this.options.user,
          });
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const awareness = this.options.provider?.awareness;
    if (!awareness) return [];

    return [
      yCursorPlugin(
        (() => {
          const prev = this.editor ? awarenessCleanupMap.get(this.editor) : null;
          if (prev) {
            prev.awareness.off("update", prev.handler);
            awarenessCleanupMap.delete(this.editor);
          }

          const currentLocalUser = awareness.getLocalState()?.user;
          awareness.setLocalStateField("user", {
            ...(typeof currentLocalUser === "object" ? currentLocalUser : {}),
            ...this.options.user,
          });
          const updateUsers = () => {
            this.storage.users = awarenessStatesToArray(awareness.states);
          };
          updateUsers();
          awareness.on("update", updateUsers);
          if (this.editor) {
            awarenessCleanupMap.set(this.editor, { awareness, handler: updateUsers });
          }
          return awareness;
        })(),
        {
          cursorBuilder: this.options.render,
          selectionBuilder: this.options.selectionRender,
        }
      ),
    ];
  },

  onDestroy() {
    if (!this.editor) return;
    const entry = awarenessCleanupMap.get(this.editor);
    if (entry) {
      entry.awareness.off("update", entry.handler);
      awarenessCleanupMap.delete(this.editor);
    }
  },
});
