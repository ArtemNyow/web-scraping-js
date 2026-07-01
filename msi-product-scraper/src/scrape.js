const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const fs = require("fs");
const path = require("path");

chromium.use(stealth);

const TARGET_URL =
  "https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MEG-Z890-ACE";
const OUTPUT_PATH = path.join(__dirname, "../output/product.json");

function parsePrice(priceText) {
  if (!priceText) return null;
  const cleaned = priceText.replace(/[^0-9.]/g, "");
  const price = parseFloat(cleaned);
  return isNaN(price) ? null : price;
}

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

function getFallbackName(url) {
  const parts = url.split("/");
  const lastPart = parts[parts.length - 1] || parts[parts.length - 2];
  return lastPart
    ? lastPart.replace(/-/g, " ").toUpperCase()
    : "MSI Motherboard";
}

async function scrapeProduct() {
  const fallbackName = getFallbackName(TARGET_URL);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1920,1080",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const networkImages = [];

  context.on("response", async (response) => {
    try {
      const url = response.url();
      const lowerUrl = url.toLowerCase();

      if (
        (lowerUrl.includes("/pd_page/") ||
          lowerUrl.includes("/product/") ||
          lowerUrl.includes("/cache/") ||
          lowerUrl.includes("/motherboard/")) &&
        /\.(png|jpg|jpeg)(?:\?.*)?$/i.test(url)
      ) {
        networkImages.push(url.split("?")[0]);
      }

      const contentType = response.headers()["content-type"] || "";
      if (response.status() === 200 && contentType.includes("json")) {
        const text = await response.text();
        const matches = text.match(/https:\/\/[^\s"']+\.(?:png|jpg|jpeg)/gi);
        if (matches) {
          matches.forEach((m) => {
            networkImages.push(
              m.replace(/\\/g, "").replace(/"/g, "").split("?")[0],
            );
          });
        }
      }
    } catch (e) {}
  });

  const page = await context.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 60000 });

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 450));
      await page.waitForTimeout(1200);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);

    const extractedData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      const findAllElements = (selector, root = document) => {
        const elements = Array.from(root.querySelectorAll(selector));
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot)
            elements.push(...findAllElements(selector, el.shadowRoot));
        });
        return elements;
      };

      const breadcrumbElements = findAllElements(
        ".breadcrumbs .item, .breadcrumbs li, .breadcrumbs a, .breadcrumbs strong, .breadcrumbs span, [class*='breadcrumb'] li",
      );
      const localCategoryTree = [];

      breadcrumbElements.forEach((el, index) => {
        const anchor = el.tagName === "A" ? el : el.querySelector("a");
        const name = el.textContent.trim().replace(/>/g, "").trim();
        if (name && !name.toLowerCase().includes("home") && name.length < 40) {
          if (!localCategoryTree.some((item) => item.name === name)) {
            const isLast = index === breadcrumbElements.length - 1;
            const finalUrl = anchor
              ? anchor.href
              : isLast
                ? window.location.href
                : null;

            localCategoryTree.push({ name, url: finalUrl });
          }
        }
      });

      if (localCategoryTree.length === 0) {
        window.location.pathname
          .split("/")
          .filter(
            (p) =>
              p &&
              !["motherboards", "intel-platform-motherboard"].includes(
                p.toLowerCase(),
              ),
          )
          .forEach((part) => {
            localCategoryTree.push({
              name: part.replace(/-/g, " "),
              url: null,
            });
          });
      }

      const categoriesOnly = localCategoryTree.filter(
        (c) => c.name && c.name.toLowerCase() !== "home",
      );
      let productCategoryStr = "Motherboards > INTEL PLATFORM > Intel Z890";
      if (categoriesOnly.length > 0) {
        productCategoryStr = categoriesOnly.map((c) => c.name).join(" > ");
      }

      const specs = [];
      findAllElements(
        "table tr, #product-attribute-specs-table tr, .additional-attributes tr",
      ).forEach((row) => {
        const label = row.querySelector("th, td:first-child, .label");
        const value = row.querySelector(
          "td:last-child, td:nth-child(2), .data",
        );
        if (label && value && label !== value) {
          const labelText = label.textContent.trim();
          const valueText = value.textContent.trim();
          if (
            labelText &&
            valueText &&
            labelText.length < 50 &&
            valueText.length < 300
          ) {
            if (!specs.some((s) => s.name === labelText)) {
              specs.push({ name: labelText, value: valueText });
            }
          }
        }
      });

      const imgElements = findAllElements(
        "img, [class*='gallery'] img, .fotorama__img, .product-image-photo, [itemprop='image']",
      );
      const domUrls = imgElements
        .map(
          (img) =>
            img.src ||
            img.getAttribute("data-src") ||
            img.getAttribute("lazy-src") ||
            img.getAttribute("href"),
        )
        .filter(
          (src) =>
            src && src.startsWith("http") && !/(cookie|loader\.gif)/i.test(src),
        );

      Array.from(document.querySelectorAll("script")).forEach((script) => {
        const content = script.textContent;
        if (content && content.includes("media/catalog/product")) {
          const matches = content.match(
            /https:\/\/[^\s"']+\/media\/catalog\/product\/[^\s"']+/g,
          );
          if (matches) {
            matches.forEach((m) =>
              domUrls.push(
                m.replace(/\\/g, "").replace(/"/g, "").replace(/,$/g, ""),
              ),
            );
          }
        }
      });

      const exactTitle =
        getText(".product-info-main .page-title") || getText("h1.page-title");
      let mpn =
        getText(".product.attribute.sku .value") || getText('[itemprop="sku"]');
      if (!mpn) {
        const mpnFromSpecs = specs.find((s) =>
          s.name.toLowerCase().includes("manufacturer number"),
        );
        if (mpnFromSpecs) mpn = mpnFromSpecs.value;
      }

      const hasCartButton = !!(
        document.querySelector(".tocart") ||
        document.querySelector("#product-addtocart-button")
      );

      const ratingRaw = getText("#average-rating-info");
      let starRating = null;
      let reviewCount = null;

      if (ratingRaw) {
        const match = ratingRaw.match(/([\d.]+)\s*\((\d+)\)/);
        if (match) {
          starRating = parseFloat(match[1]);
          reviewCount = parseInt(match[2], 10);
        }
      }

      return {
        title: exactTitle,
        rawPrice:
          getText("#prices-new") ||
          getText(".price-box .price") ||
          getText(".price-wrapper .price"),
        rawSalePrice: getText(".special-price .price"),
        stockText:
          getText(".stock.available") || getText(".stock.unavailable") || "",
        mpn,
        description:
          getText(".product.attribute.overview") ||
          getText("#description") ||
          "Intel Z890 Motherboard",
        productCategory: productCategoryStr,
        categoryTree: localCategoryTree,
        hasCartButton,
        domUrls,
        starRating,
        reviewCount,
      };
    });

    const allFoundImages = [...extractedData.domUrls, ...networkImages];
    const currentTitle =
      extractedData.title || extractedData.mpn || fallbackName;

    const titleTokens = currentTitle
      .toLowerCase()
      .replace(/msi/g, "")
      .split(/[\s\-_]/)
      .filter((token) => token.length >= 2 && token !== "wifi");

    let cleanImages = allFoundImages
      .map((url) => url.split("?")[0].replace(/\\/g, ""))
      .filter((url) => {
        const lower = url.toLowerCase();
        const isProductImg = /\/(pd_page|product|cache|motherboard)\//.test(
          lower,
        );
        const matchesTokens =
          titleTokens.filter((token) => lower.includes(token)).length >= 2;
        const isThumbnail = /-(200x200|400x400)/.test(lower);

        return isProductImg && matchesTokens && !isThumbnail;
      });

    let uniqueImages = Array.from(new Set(cleanImages));

    if (uniqueImages.length === 0) {
      uniqueImages = Array.from(
        new Set(
          allFoundImages
            .map((url) => url.split("?")[0].replace(/\\/g, ""))
            .filter((url) => /\/(pd_page|motherboard)\//i.test(url)),
        ),
      );
    }

    uniqueImages.sort((a, b) => {
      const aIsPd = a.toLowerCase().includes("/pd_page/");
      const bIsPd = b.toLowerCase().includes("/pd_page/");
      return bIsPd - aIsPd;
    });

    const realProductPhotos = uniqueImages.filter((url) =>
      url.toLowerCase().includes("/pd_page/"),
    );
    const finalImagesSource =
      realProductPhotos.length > 0 ? realProductPhotos : uniqueImages;

    const mainImg = finalImagesSource.length > 0 ? finalImagesSource[0] : null;
    const additionalImgs =
      finalImagesSource.length > 1 ? finalImagesSource.slice(1) : [];

    let availability = "out_of_stock";
    if (
      extractedData.stockText &&
      (extractedData.stockText.toLowerCase().includes("in stock") ||
        extractedData.hasCartButton)
    ) {
      availability = "in_stock";
    }

    const finalPrice = parsePrice(extractedData.rawPrice);
    const finalSalePrice = parsePrice(extractedData.rawSalePrice);

    const normalizedProduct = {
      url: TARGET_URL,
      item_id: extractedData.mpn || fallbackName,
      title: currentTitle,
      brand: "MSI",
      product_category: extractedData.productCategory,
      category_tree: extractedData.categoryTree,
      description: extractedData.description,
      price: finalPrice,
      sale_price: finalSalePrice,
      availability: availability,
      image_url: mainImg,
      additional_image_urls: additionalImgs,
      specs: extractedData.specs,
      star_rating: extractedData.starRating,
      review_count: extractedData.reviewCount,
      gtin: null,
      mpn: extractedData.mpn || fallbackName,
      scraped_at: new Date().toISOString(),
    };

    ensureDirectoryExistence(OUTPUT_PATH);
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(normalizedProduct, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error(error.message);
  } finally {
    await browser.close();
  }
}

scrapeProduct();
