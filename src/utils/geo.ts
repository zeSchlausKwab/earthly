import { type CustomFeature } from "~/store/edit-collection-store"
// import Geohash from "latlon-geohash/latlon-geohash"
// import { center } from "@turf/turf"

export const geohashFromFeatures = (
  feature: CustomFeature | CustomFeature[],
) => {
  console.log("feature", feature)
  // const centerOfFeature = center(feature)
  // return Geohash.encode(
  //   centerOfFeature.geometry.coordinates[0],
  //   centerOfFeature.geometry.coordinates[1],
  //   10,
  // )
  return
}
