import { PrismaClient } from "@prisma/client"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { CustomFeature } from "~/store/edit-collection-store"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const prisma = new PrismaClient()

async function main() {
  await Promise.all([
    await prisma.curatedFeatureCategory.deleteMany(),
    await prisma.curatedFeature.deleteMany(),
  ])

  const curatedFeatureCategory = await prisma.curatedFeatureCategory.create({
    data: {
      name: "countries",
      description: "iso a3 counties",
    },
  })

  const geoJsonData = fs.readFileSync(
    path.join(__dirname, "./curation-seed/countries.geojson"),
    "utf8",
  )
  const geoJsonObject = JSON.parse(geoJsonData)

  const curatedFeatures = await Promise.all(
    geoJsonObject.features.map(
      async (
        feature: CustomFeature & {
          properties: { ADMIN: string; ISO_A3: string }
        },
      ) => {
        return await prisma.curatedFeature.create({
          data: {
            admin: feature.properties.ADMIN,
            isoA3: feature.properties.ISO_A3,
            geometry: feature.geometry as any,
            geometryType: feature.geometry.type,
            name: feature.properties.ADMIN.toLowerCase(),
            category: {
              connect: {
                id: curatedFeatureCategory.id,
              },
            },
          },
        })
      },
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
