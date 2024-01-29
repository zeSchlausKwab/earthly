/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `CuratedFeatureCategory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "CuratedFeatureCategory_name_key" ON "CuratedFeatureCategory"("name");
