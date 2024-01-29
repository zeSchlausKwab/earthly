/*
  Warnings:

  - You are about to drop the column `admin1` on the `CuratedFeature` table. All the data in the column will be lost.
  - Added the required column `admin` to the `CuratedFeature` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CuratedFeature" DROP COLUMN "admin1",
ADD COLUMN     "admin" TEXT NOT NULL;
