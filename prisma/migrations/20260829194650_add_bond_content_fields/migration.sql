-- AlterTable
ALTER TABLE "bonds" ADD COLUMN     "cover_image_path" TEXT,
ADD COLUMN     "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "location" TEXT,
ADD COLUMN     "overview" TEXT,
ADD COLUMN     "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "summary" TEXT;
