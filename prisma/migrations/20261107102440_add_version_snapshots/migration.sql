-- CreateTable
CREATE TABLE "version_snapshots" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdById" TEXT,
    "label" TEXT,
    "description" TEXT,
    "yjsState" BYTEA NOT NULL,
    "content" JSONB,
    "wordCount" INTEGER,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "version_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "version_snapshots_pageId_idx" ON "version_snapshots"("pageId");

-- CreateIndex
CREATE INDEX "version_snapshots_createdById_idx" ON "version_snapshots"("createdById");

-- CreateIndex
CREATE INDEX "version_snapshots_pageId_createdAt_idx" ON "version_snapshots"("pageId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "version_snapshots" ADD CONSTRAINT "version_snapshots_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_snapshots" ADD CONSTRAINT "version_snapshots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
