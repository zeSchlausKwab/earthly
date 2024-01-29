-- CreateTable
CREATE TABLE "CuratedFeature" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "geometry" JSONB NOT NULL,
    "geometryType" TEXT NOT NULL,
    "admin1" TEXT NOT NULL,
    "isoA3" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CuratedFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuratedFeatureCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuratedFeatureCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CuratedFeature_name_idx" ON "CuratedFeature"("name");

-- CreateIndex
CREATE INDEX "CuratedFeatureCategory_name_idx" ON "CuratedFeatureCategory"("name");

-- AddForeignKey
ALTER TABLE "CuratedFeature" ADD CONSTRAINT "CuratedFeature_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CuratedFeatureCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
