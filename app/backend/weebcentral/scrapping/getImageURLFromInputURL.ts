import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
} from "playwright";

const TITLE_PATTERN = /\/manga\/([^/]+)\//i;

export interface ScrapeResult {
  imageUrls: string[];
  title: string;
}

function extractTitleFromImageUrls(imageUrls: string[]): string {
  for (const url of imageUrls) {
    const match = url.match(TITLE_PATTERN);
    if (match) return match[1];
  }
  return "Unknown_Title";
}

const LAUNCH_ORDER: [string, BrowserType][] = [
  ["webkit", webkit],
  ["firefox", firefox],
  ["chromium", chromium],
];

async function launchAnyBrowser(): Promise<{ browser: Browser; name: string }> {
  for (const [name, engine] of LAUNCH_ORDER) {
    try {
      // console.log(`Trying ${name} browser...`);
      const browser = await engine.launch({ headless: true });
      // console.log(`Using ${name} browser`);
      return { browser, name };
    } catch (e) {
      // console.log(`${name} failed: ${e}`);
    }
  }
  throw new Error("Failed to launch any Playwright browser");
}

export async function fetchManualImages(url: string): Promise<ScrapeResult> {
  const { browser } = await launchAnyBrowser();

  try {
    const page = await browser.newPage();

    //  console.log("Loading page... please wait...");
    let response;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    } catch (e) {
      // console.log(`Page load warning: ${e}`);
      return { imageUrls: [], title: "Unknown_Title" };
    }

    if (!response || response.status() !== 200) {
      // // console.log(`Failed to load page (status ${response?.status() ?? 0})`);
      return { imageUrls: [], title: "Unknown_Title" };
    }

    // console.log("Scrolling for lazy-loaded images...");
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(700);
    }

    await page.waitForTimeout(4000);

    const imgElements = await page.$$("img");
    const imageUrls: string[] = [];

    for (const img of imgElements) {
      const src = await img.getAttribute("src");
      if (src && src.includes("/manga/") && src.endsWith(".png")) {
        imageUrls.push(new URL(src, url).toString());
      }
    }

    const title = extractTitleFromImageUrls(imageUrls);

    // console.log(`Title: ${title}`);
    // console.log(`Images found: ${imageUrls.length}`);

    return { imageUrls, title };
  } finally {
    await browser.close();
  }
}
