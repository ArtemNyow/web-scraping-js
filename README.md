# web-scraping-js

## MSI Product Scraper

This workspace contains a small Playwright-based scraper for an MSI product detail page.

### What it does

- Opens the target MSI product page in headless Chromium.
- Extracts product metadata such as title, brand, category, price, availability, image URLs, and specifications.
- Writes the result to output/product.json.

### Requirements

- Node.js 18+
- npm

### Install

```bash
cd msi-product-scraper
npm install
npx playwright install chromium
```

### Run

```bash
npm run scrape
```

The script will overwrite the JSON file at:

```text
msi-product-scraper/output/product.json
```

### Notes

- The scraper uses Playwright and keeps the implementation simple and readable.
- If a field is not available on the page, it is normalized to null or an empty array where appropriate.
