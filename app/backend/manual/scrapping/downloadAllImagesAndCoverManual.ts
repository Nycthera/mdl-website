import { gatherAllUrlsFromSample } from "@/app/backend/manual/scrapping/getAllImagesFromManual";
import { findCoverImageURL } from "@/app/backend/manual/scrapping/getCoverImageURLFromManualURL";

export async function main() {
  const urls = await gatherAllUrlsFromSample(
    "https://scans.lastation.us/manga/Otonari-no-Tenshi-sama-ni-Itsu-no-Ma-ni-ka-Dame-Ningen-ni-Sareteita-Ken/0027-001.png"
  );

  const coverUrl = await findCoverImageURL(
    "https://scans.lastation.us/manga/Otonari-no-Tenshi-sama-ni-Itsu-no-Ma-ni-ka-Dame-Ningen-ni-Sareteita-Ken"
  );

  console.log(urls);
  console.log(coverUrl);
}
