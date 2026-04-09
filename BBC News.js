{
	"translatorID": "4e7073c1-a820-4b2f-ad4e-bbc81b642aa5",
	"label": "BBC News",
	"creator": "Custom",
	"target": "^https?://(www\\.)?bbc\\.(com|co\\.uk)/",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 99,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-30 19:18:06"
}

/*
	***** BEGIN LICENSE BLOCK *****

	BBC News Zotero Translator
	Copyright © 2026

	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	***** END LICENSE BLOCK *****
*/

function detectWeb(doc, url) {
	var cleanUrl = url.replace(/[?#].*/, "");
	if (/\/(news|sport|culture|future|travel|worklife|reel|food)\/articles\/[a-z0-9]+/.test(cleanUrl)) {
		return "newspaperArticle";
	}
	if (/\d{7,8}$/.test(cleanUrl)) {
		return "newspaperArticle";
	}
	if (/\d{7}\.stm$/.test(cleanUrl)) {
		return "newspaperArticle";
	}
	if (cleanUrl.includes("/newsbeat/article")) {
		return "blogPost";
	}
	if (getSearchResults(doc, true)) {
		return "multiple";
	}
	return false;
}

function getSearchResults(doc, checkOnly) {
	var items = {};
	var found = false;
	var rows = ZU.xpath(doc, '//a[.//h3]');
	if (!rows.length) {
		rows = ZU.xpath(doc, '//article/div/h1[@itemprop="headline"]/a');
	}
	for (var i = 0; i < rows.length; i++) {
		var href = rows[i].href;
		var title = ZU.trimInternal(rows[i].textContent);
		if (!href || !title) continue;
		if (checkOnly) return true;
		found = true;
		items[href] = title;
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

function getMeta(doc, name) {
	var el = doc.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
	return el ? el.getAttribute("content") : null;
}

// Find the article object across all JSON-LD blocks on the page
function getJsonLd(doc) {
	var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
	for (var i = 0; i < scripts.length; i++) {
		try {
			var data = JSON.parse(scripts[i].textContent);
			var candidates = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
			for (var j = 0; j < candidates.length; j++) {
				var t = candidates[j]["@type"] || "";
				if (/NewsArticle|ReportageNewsArticle|Article|BlogPosting/.test(t)) {
					return candidates[j];
				}
			}
		}
		catch (e) {}
	}
	return null;
}

function scrape(doc, url) {
	var cleanUrl = url.replace(/[?#].*/, "");
	var item = new Zotero.Item(detectWeb(doc, cleanUrl));

	var ld = getJsonLd(doc);

	// ── Title ─────────────────────────────────────────────────────────────────
	item.title = (ld && ld.headline)
		|| getMeta(doc, "og:title")
		|| doc.title.replace(/\s*[-|].*$/, "").trim();

	// ── Date published ────────────────────────────────────────────────────────
	var datePublished = (ld && ld.datePublished) || getMeta(doc, "cXenseParse:publishtime");
	if (datePublished) item.date = ZU.strToISO(datePublished);
	if (!item.date) {
		var timeEl = doc.querySelector("time[datetime]");
		if (timeEl) item.date = ZU.strToISO(timeEl.getAttribute("datetime"));
	}

	// ── Authors ───────────────────────────────────────────────────────────────
	// JSON-LD: author is [{@type:Person, name:...}, ...]
	if (ld && ld.author) {
		var authors = Array.isArray(ld.author) ? ld.author : [ld.author];
		for (var a = 0; a < authors.length; a++) {
			var name = (typeof authors[a] === "object") ? authors[a].name : authors[a];
			if (name) item.creators.push(ZU.cleanAuthor(name, "author"));
		}
	}
	// Fallback: cXenseParse:author meta (also reliable on BBC pages)
	if (!item.creators.length) {
		var cxAuthor = getMeta(doc, "cXenseParse:author");
		if (cxAuthor) item.creators.push(ZU.cleanAuthor(cxAuthor, "author"));
	}
	// Fallback: DOM byline
	if (!item.creators.length) {
		doc.querySelectorAll('[data-testid="byline-name"], .byline__name').forEach(function (el) {
			var name = ZU.trimInternal(el.textContent).replace(/^By\s+/i, "");
			if (name) item.creators.push(ZU.cleanAuthor(name, "author"));
		});
	}

	// ── Abstract ──────────────────────────────────────────────────────────────
	item.abstractNote = (ld && ld.description)
		|| getMeta(doc, "og:description")
		|| getMeta(doc, "description")
		|| "";

	// ── Publication ───────────────────────────────────────────────────────────
	// ld.publisher.name is "BBC News", "BBC Sport", etc.
	item.publicationTitle = (ld && ld.publisher && ld.publisher.name)
		|| getMeta(doc, "og:site_name")
		|| "BBC News";

	// ── Section / subsection ──────────────────────────────────────────────────
	// page.section = "News", page.subsection = "Europe"
	// Use subsection as section (more specific); fall back to page.section or JSON-LD
	var subsection = getMeta(doc, "page.subsection");
	var pageSection = getMeta(doc, "page.section");
	var ldSection = ld && ld.articleSection
		? (Array.isArray(ld.articleSection) ? ld.articleSection[0] : ld.articleSection)
		: null;
	item.section = subsection || ldSection || pageSection || "";

	// ── Extra: modified date and broad section ────────────────────────────────
	var extra = [];
	var dateModified = (ld && ld.dateModified) || getMeta(doc, "article:modified_time");
	if (dateModified) extra.push("Updated: " + ZU.strToISO(dateModified));
	// Store the broad section (e.g. "News") in extra when subsection is used as section
	if (subsection && pageSection && pageSection !== subsection) {
		extra.push("BBC section: " + pageSection);
	}
	if (extra.length) item.extra = extra.join("\n");

	// ── Language ──────────────────────────────────────────────────────────────
	var lang = getMeta(doc, "og:locale") || doc.documentElement.lang || "en-GB";
	item.language = (lang === "en") ? "en-GB" : lang;

	// ── Fixed fields ──────────────────────────────────────────────────────────
	item.url = cleanUrl;
	item.libraryCatalog = "BBC News";
	item.accessDate = ZU.strToISO(new Date().toISOString());

	// ── Snapshot (no PDF) ─────────────────────────────────────────────────────
	item.attachments.push({
		document: doc,
		title: "BBC News Snapshot",
		mimeType: "text/html",
		snapshot: true
	});

	item.complete();
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://www.bbc.com/news/articles/cvg0r3z3lvqo",
		"items": [
			{
				"itemType": "newspaperArticle",
				"title": "Spain and Portugal 2025 blackout caused by 'multiple factors' - report",
				"creators": [
					{
						"firstName": "Guy",
						"lastName": "Hedgecoe",
						"creatorType": "author"
					}
				],
				"date": "2026-03-20",
				"abstractNote": "A new report has determined the causes of the unprecedented blackout which left the two countries without power for several hours last year.",
				"publicationTitle": "BBC News",
				"section": "Europe",
				"language": "en-GB",
				"libraryCatalog": "BBC News",
				"url": "https://www.bbc.com/news/articles/cvg0r3z3lvqo",
				"attachments": [
					{
						"title": "BBC News Snapshot",
						"mimeType": "text/html",
						"snapshot": true
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
