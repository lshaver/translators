{
	"translatorID": "d83a1e42-c6f9-4b2d-a7e5-8f0c3d9b1e6f",
	"label": "Generic PDF Links",
	"creator": "Your Name",
	"target": "",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 400,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-19 21:39:41"
}

function detectWeb(doc, url) {
	if (getPDFLinks(doc).length > 0) {
		return "multiple";
	}
	return false;
}

function doWeb(doc, url) {
	var links = getPDFLinks(doc);

	// Build items object for Zotero.selectItems picker
	// key = PDF URL, value = display title
	var items = {};
	links.forEach(function(link) {
		items[link.url] = link.title;
	});

	Zotero.selectItems(items, function(selected) {
		if (!selected) return;

		// Extract domain (no www., no TLD) for creator
		var domainMatch = url.match(/^https?:\/\/(?:www\.)?([^.\/]+)/i);
		var domain = domainMatch ? domainMatch[1].toUpperCase() : "";

		for (var pdfUrl in selected) {
			var item = new Zotero.Item("document");

			item.title = selected[pdfUrl];
			item.url = pdfUrl;

			if (domain) {
				item.creators.push({
					lastName: domain,
					creatorType: "author",
					fieldMode: 1
				});
			}

			item.attachments.push({
				title: "Full Text PDF",
				url: pdfUrl,
				mimeType: "application/pdf"
			});

			item.complete();
		}
	});
}

/**
 * Find all <a href="...pdf"> links on the page.
 * Returns array of {url, title} objects.
 * Title comes from the link's text content, falling back to the filename.
 */
function getPDFLinks(doc) {
	var links = [];
	var seen = {};

	var anchors = doc.querySelectorAll("a[href]");
	anchors.forEach(function(a) {
		var href = a.href;
		if (!href || !/\.pdf(\?.*)?$/i.test(href)) return;
		if (seen[href]) return;
		seen[href] = true;

		// Prefer link text; fall back to filename-derived title
		var text = a.textContent.trim().replace(/\s+/g, " ");
		if (!text) {
			text = href.split("/").pop().replace(/\.pdf(\?.*)?$/i, "")
				.replace(/[-_]+/g, " ").trim();
		}

		links.push({ url: href, title: text || href });
	});

	return links;
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://www.nerc.com/initiatives/large-loads-action-plan",
		"items": "multiple"
	}
]
/** END TEST CASES **/
