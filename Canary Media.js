{
	"translatorID": "3a2c8d5e-4f1b-4a2c-9b3e-7d6f8e9a0b1c",
	"label": "Canary Media",
	"creator": "Your Name",
	"target": "^https?://www\\.canarymedia\\.com/articles/",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-04-21 15:12:39"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2026

	This file is part of Zotero.

	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero. If not, see <http://www.gnu.org/licenses/>.

	***** END LICENSE BLOCK *****
*/

function detectWeb(doc, url) {
	// Match individual article pages: /articles/{topic}/{slug}
	// Exclude section/index pages like /articles/solar or /articles/solar/p2
	if (/\/articles\/[^/]+\/[^/]+/.test(url) && !url.match(/\/p\d+$/)) {
		return "newspaperArticle";
	}
	// Detect listing pages for a multiples save
	if (/\/articles(\/[^/]+)?(\/p\d+)?$/.test(url)) {
		return getSearchResults(doc, true) ? "multiple" : false;
	}
	return false;
}

function getSearchResults(doc, checkOnly) {
	var items = {};
	var found = false;
	// Article cards on listing pages link to /articles/{topic}/{slug}
	var links = doc.querySelectorAll('a[href*="/articles/"]');
	for (var link of links) {
		var href = link.href;
		// Only individual article URLs (two path segments after /articles/)
		if (!/\/articles\/[^/]+\/[^/]+/.test(href)) continue;
		if (/\/p\d+$/.test(href)) continue;
		var title = ZU.trimInternal(link.textContent);
		if (!title) continue;
		if (checkOnly) return true;
		if (!items[href]) {
			items[href] = title;
			found = true;
		}
	}
	return found ? items : false;
}

function doWeb(doc, url) {
	if (detectWeb(doc, url) === "multiple") {
		Zotero.selectItems(getSearchResults(doc, false), function (items) {
			if (!items) return;
			ZU.processDocuments(Object.keys(items), scrape);
		});
	}
	else {
		scrape(doc, url);
	}
}

function scrape(doc, url) {
	var item = new Zotero.Item("newspaperArticle");

	// ── 1. Try JSON-LD (schema.org NewsArticle / Article) ──────────────────
	var jsonLd = null;
	var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
	for (var script of scripts) {
		try {
			var data = JSON.parse(script.textContent);
			// Handle @graph arrays
			var candidates = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
			for (var candidate of candidates) {
				if (candidate["@type"] && /NewsArticle|Article/.test(candidate["@type"])) {
					jsonLd = candidate;
					break;
				}
			}
		}
		catch (e) {}
		if (jsonLd) break;
	}

	if (jsonLd) {
		// Title
		item.title = jsonLd.headline || jsonLd.name || "";

		// Authors
		var authors = jsonLd.author || jsonLd.creator;
		if (authors) {
			if (!Array.isArray(authors)) authors = [authors];
			for (var author of authors) {
				var name = (typeof author === "string") ? author : (author.name || "");
				if (name) {
					item.creators.push(ZU.cleanAuthor(name, "author"));
				}
			}
		}

		// Dates
		item.date = jsonLd.datePublished || jsonLd.dateCreated || "";
		if (item.date) {
			// Trim to YYYY-MM-DD if ISO datetime
			item.date = item.date.replace(/T.*$/, "");
		}

		// Abstract / description
		item.abstractNote = jsonLd.description || "";

		// Section (articleSection maps to Zotero's "section")
		if (jsonLd.articleSection) {
			item.section = Array.isArray(jsonLd.articleSection)
				? jsonLd.articleSection[0]
				: jsonLd.articleSection;
		}

		// Tags / keywords
		if (jsonLd.keywords) {
			var keywords = Array.isArray(jsonLd.keywords)
				? jsonLd.keywords
				: jsonLd.keywords.split(",");
			for (var kw of keywords) {
				item.tags.push(ZU.trimInternal(kw));
			}
		}
	}

	// ── 2. Fallback / supplement with Open Graph / meta tags ───────────────
	if (!item.title) {
		item.title = attr(doc, 'meta[property="og:title"]', "content")
			|| attr(doc, 'meta[name="title"]', "content")
			|| doc.title.replace(/\s*[|\-–—].*$/, "").trim();
	}

	if (!item.abstractNote) {
		item.abstractNote = attr(doc, 'meta[property="og:description"]', "content")
			|| attr(doc, 'meta[name="description"]', "content")
			|| "";
	}

	if (!item.date) {
		item.date = attr(doc, 'meta[property="article:published_time"]', "content")
			|| attr(doc, 'meta[name="date"]', "content")
			|| "";
		if (item.date) item.date = item.date.replace(/T.*$/, "");
	}

	// Author from byline if JSON-LD didn't supply any
	if (!item.creators.length) {
		// Common byline selectors
		var bylineSelectors = [
			'[data-testid="byline"]',
			'.byline',
			'[class*="byline"]',
			'[class*="author"]',
			'[rel="author"]',
			'[itemprop="author"]',
			'meta[name="author"]',
		];
		for (var sel of bylineSelectors) {
			var bylineEl = doc.querySelector(sel);
			if (!bylineEl) continue;
			var bylineText = (sel.startsWith("meta"))
				? bylineEl.getAttribute("content")
				: ZU.trimInternal(bylineEl.textContent);
			if (!bylineText) continue;
			// Strip leading "By " prefix
			bylineText = bylineText.replace(/^[Bb]y\s+/, "");
			// Split on " and " or " & " or ","
			var names = bylineText.split(/\s+(?:and|&)\s+|,\s*/);
			for (var n of names) {
				n = ZU.trimInternal(n);
				if (n) item.creators.push(ZU.cleanAuthor(n, "author"));
			}
			if (item.creators.length) break;
		}
	}

	// ── 3. Extract section from URL path if not already set ────────────────
	// URL pattern: /articles/{topic}/{slug}
	if (!item.section) {
		var urlMatch = url.match(/\/articles\/([^/]+)\//);
		if (urlMatch) {
			// Convert slug to title case: "solar-energy" → "Solar Energy"
			item.section = urlMatch[1]
				.replace(/-/g, " ")
				.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
		}
	}

	// ── 4. Fixed fields ─────────────────────────────────────────────────────
	item.publicationTitle = "Canary Media";
	item.url = url;
	item.language = "en";
	item.ISSN = "";  // Canary Media is online-only; no print ISSN

	// ── 5. Snapshot attachment ──────────────────────────────────────────────
	item.attachments.push({
		document: doc,
		title: "Canary Media Snapshot",
		mimeType: "text/html",
	});

	item.complete();
}

/** Convenience wrapper around document.querySelector + getAttribute */
function attr(doc, selector, attribute) {
	var el = doc.querySelector(selector);
	return el ? el.getAttribute(attribute) : "";
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://www.canarymedia.com/articles/solar/what-to-know-balcony-solar",
		"items": [
			{
				"itemType": "newspaperArticle",
				"title": "What to know about balcony solar",
				"publicationTitle": "Canary Media",
				"language": "en",
				"section": "Solar",
				"url": "https://www.canarymedia.com/articles/solar/what-to-know-balcony-solar",
				"attachments": [
					{
						"title": "Canary Media Snapshot",
						"mimeType": "text/html"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	}
]
/** END TEST CASES **/
