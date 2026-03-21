{
	"translatorID": "a45e1426-c6e5-4e2e-9f1a-6b9ef8e3d2c1",
	"label": "EPRI",
	"creator": "Your Name",
	"target": "^https?://www\\.epri\\.com/research/products/\\d+",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-19 19:10:26"
}

function detectWeb(doc, url) {
	if (/\/research\/products\/\d+$/.test(url)) {
		return "report";
	}
	return false;
}

function doWeb(doc, url) {
	scrape(doc, url);
}

function scrape(doc, url) {
	var item = new Zotero.Item("report");

	// Title
	var titleEl = doc.querySelector("h2.title");
	if (titleEl) {
		item.title = titleEl.textContent.trim();
	}

	// Abstract
	var abstractEl = doc.querySelector("div.abstract");
	if (abstractEl) {
		item.abstractNote = abstractEl.textContent.trim();
	}

	// Product ID / Report Number
	// Find the label div, then get the adjacent value div
	var productIdLabel = getDescriptionValue(doc, "Product ID");
	if (productIdLabel) {
		item.reportNumber = productIdLabel;
	}

	// Report Type (Document Type)
	var docType = getDescriptionValue(doc, "Document Type");
	if (docType) {
		item.reportType = toTitleCase(docType);
	}

	// Date Published
	var datePub = getDescriptionValue(doc, "Date Published");
	if (datePub) {
		item.date = datePub;
	}

	// Institutional author
	item.creators.push({
		lastName: "EPRI",
		creatorType: "author",
		fieldMode: 1  // institutional author — renders as single field
	});

	// Publisher
	item.publisher = "Electric Power Research Institute (EPRI)";

	// URL
	item.url = url;

	// Keywords → tags
	var keywordLinks = doc.querySelectorAll("div.keywordsList div.item a");
	keywordLinks.forEach(function(a) {
		item.tags.push(a.textContent.trim());
	});

	// PDF attachment
	// EPRI exposes a public download endpoint at restservice.epri.com.
	// The product ID is zero-padded to 18 digits in the URL but the
	// REST service accepts the raw numeric ID as well.
	var productIdMatch = url.match(/\/research\/products\/(\d+)/);
	if (productIdMatch) {
		var pdfUrl = "https://restservice.epri.com/publicdownload/"
			+ productIdMatch[1] + "/0/Product";
		item.attachments.push({
			title: "EPRI Full Text PDF",
			url: pdfUrl,
			mimeType: "application/pdf"
		});
	}

	item.complete();
}

/**
 * Given a "description" label string, find the paired "value" div.
 * The markup pattern is:
 *   <div class="description">Label</div>
 *   <div class="value">Content</div>
 */
function getDescriptionValue(doc, label) {
	var descriptions = doc.querySelectorAll("div.description");
	for (var i = 0; i < descriptions.length; i++) {
		if (descriptions[i].textContent.trim() === label) {
			var sibling = descriptions[i].nextElementSibling;
			if (sibling && sibling.classList.contains("value")) {
				return sibling.textContent.trim();
			}
		}
	}
	return null;
}

/** Convert ALL CAPS string to Title Case */
function toTitleCase(str) {
	return str.toLowerCase().replace(/\b\w/g, function(c) {
		return c.toUpperCase();
	});
}

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
