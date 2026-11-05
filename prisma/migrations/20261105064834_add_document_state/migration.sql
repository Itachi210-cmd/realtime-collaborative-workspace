-- CreateTable
CREATE TABLE "document_states" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "yjsState" BYTEA NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_states_pageId_key" ON "document_states"("pageId");

-- AddForeignKey
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
