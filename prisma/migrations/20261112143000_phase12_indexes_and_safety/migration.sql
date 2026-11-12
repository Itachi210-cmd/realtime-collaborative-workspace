-- Phase 12 Step 4: Safe Page author cascade (preserve shared pages) & composite query indexes

-- Preserve shared workspace pages if an author's user account is removed
ALTER TABLE "pages" DROP CONSTRAINT "pages_createdById_fkey";
ALTER TABLE "pages" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "pages" ADD CONSTRAINT "pages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Composite indexes aligned with sidebar hierarchy and chronological comment listing queries
CREATE INDEX IF NOT EXISTS "pages_workspaceId_createdAt_idx" ON "pages"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "pages_workspaceId_parentPageId_createdAt_idx" ON "pages"("workspaceId", "parentPageId", "createdAt");
CREATE INDEX IF NOT EXISTS "comments_pageId_createdAt_idx" ON "comments"("pageId", "createdAt");

