import { main } from "./manual/scrapping/downloadAllImagesAndCoverManual";
async function run() {
  await main();
}

run().catch(console.error);
