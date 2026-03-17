{
	"translatorID": "b5b6e5a2-3c4d-4e8f-9a1b-2c3d4e5f6a7b",
	"label": "Industry Dive",
	"creator": "Claude (Anthropic)",
	"target": "^https?://www\\.[a-z]+dive\\.com/(news|opinion|deep-dive)/",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-16 17:03:43"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Industry Dive Zotero Translator
	Covers all Informa TechTarget / Industry Dive publications, e.g.:
	  utilitydive.com, retaildive.com, supplychaindive.com, hrdive.com,
	  biopharmadive.com, constructiondive.com, etc.

	This translator scrapes newspaper-article metadata from article pages.

	***** END LICENSE BLOCK *****
*/

function detectWeb(doc, url) {
	// Match single article pages under /news/, /opinion/, or /deep-dive/
	if (/\/(news|opinion|deep-dive)\/[^/]+\/\d+\/?$/.test(url)) {
		return "newspaperArticle";
	}
	return false;
}

function doWeb(doc, url) {
	scrape(doc, url);
}

function scrape(doc, url) {
	var item = new Zotero.Item("newspaperArticle");

	// --- Parse informaData ---
	// Every Industry Dive article page includes an inline <script> that assigns
	// a plain JS object to informaData. It contains canonical author, title,
	// date, URL, and topic terms — all editorial, not UI chrome.
	// Example:
	//   informaData = {"contentAuthor": "Brian Martucci",
	//                  "contentPubDate": "2026-03-11 14:50:08",
	//                  "pageTitle": "EPB of Chattanooga...",
	//                  "canonicalUrl": "https://...",
	//                  "primaryTerm": "Load Management..., Energy Storage",
	//                  "secondaryTerm": "DER, Energy Storage", ...};
	var informa = {};
	var scripts = doc.querySelectorAll("script:not([src])");
	for (var i = 0; i < scripts.length; i++) {
		var src = scripts[i].textContent;
		var m = src.match(/informaData\s*=\s*(\{[\s\S]*?\});/);
		if (m) {
			try { informa = JSON.parse(m[1]); } catch (e) {}
			break;
		}
	}

	// --- Title ---
	item.title = informa.pageTitle
		|| attr(doc, 'meta[property="og:title"]', "content").replace(/\s*\|\s*[^|]+$/, "").trim()
		|| text(doc, "h1");

	// --- Publication name ---
	// Derive from the hostname: "utilitydive.com" → "Utility Dive"
	var hostMatch = url.match(/^https?:\/\/(?:www\.)?([a-z]+dive)\.com/i);
	if (hostMatch) {
		item.publicationTitle = hostMatch[1]
			.replace(/dive$/i, " Dive")
			.replace(/^(.)/, function(m) { return m.toUpperCase(); });
	} else {
		item.publicationTitle = attr(doc, 'meta[property="og:site_name"]', "content") || "Industry Dive";
	}

	// --- Abstract ---
	// og:description holds the article deck; not affected by body-rendering order.
	item.abstractNote = attr(doc, 'meta[property="og:description"]', "content")
		|| attr(doc, 'meta[name="description"]', "content");

	// --- Date ---
	// informaData.contentPubDate: "YYYY-MM-DD HH:MM:SS"
	if (informa.contentPubDate) {
		item.date = informa.contentPubDate.split(" ")[0];
	} else {
		var pubTime = attr(doc, 'meta[property="article:published_time"]', "content");
		if (pubTime) item.date = pubTime.split("T")[0];
	}

	// --- Authors ---
	// informaData.contentAuthor is a single string; may be "Author One and Author Two"
	// for multi-author articles.
	if (informa.contentAuthor) {
		informa.contentAuthor.split(/\s+and\s+/i).forEach(function(name) {
			name = name.trim();
			if (name) item.creators.push(ZU.cleanAuthor(name, "author"));
		});
	} else {
		// Fallback: JSON-LD NewsArticle author field
		var ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
		for (var j = 0; j < ldScripts.length; j++) {
			try {
				var ld = JSON.parse(ldScripts[j].textContent);
				var authors = ld.author || ld.creator;
				if (authors) {
					if (!Array.isArray(authors)) authors = [authors];
					authors.forEach(function(a) {
						var name = (typeof a === "string") ? a : (a.name || "");
						name = name.trim();
						if (name) item.creators.push(ZU.cleanAuthor(name, "author"));
					});
					if (item.creators.length > 0) break;
				}
			} catch (e) {}
		}
	}

	// --- URL ---
	item.url = informa.canonicalUrl || url;

	// --- Language ---
	item.language = "en";

	// --- Tags: union of primaryTerm and secondaryTerm ---
	var tagsSeen = {};
	[informa.primaryTerm, informa.secondaryTerm].forEach(function(termList) {
		if (!termList) return;
		termList.split(",").forEach(function(tag) {
			tag = tag.trim();
			if (tag && !tagsSeen[tag]) {
				tagsSeen[tag] = true;
				item.tags.push(tag);
			}
		});
	});

	// Fallback: article:tag Open Graph meta elements
	if (item.tags.length === 0) {
		doc.querySelectorAll('meta[property="article:tag"]').forEach(function(el) {
			var tag = el.getAttribute("content");
			if (tag) item.tags.push(tag.trim());
		});
	}

	// --- Extra ---
	// Store informaData fields that have no dedicated Zotero field.
	var extraLines = [];
	if (informa.pageID !== undefined)          extraLines.push("pageID: " + informa.pageID);
	if (informa.pageType !== undefined)        extraLines.push("pageType: " + informa.pageType);
	if (informa.pageIsSponsored !== undefined) extraLines.push("pageIsSponsored: " + informa.pageIsSponsored);
	if (informa.pageSponsor !== undefined)     extraLines.push("pageSponsor: " + informa.pageSponsor);
	if (extraLines.length > 0) item.extra = extraLines.join("\n");

	// --- Access date ---
	item.accessDate = "CURRENT_TIMESTAMP";

	// --- Snapshot ---
	item.attachments.push({
		document: doc,
		title: "Snapshot",
		mimeType: "text/html"
	});

	item.complete();
}

/** Utility: get text content of first matching element */
function text(doc, selector) {
	var el = doc.querySelector(selector);
	return el ? el.textContent.trim() : "";
}

/** Utility: get attribute value of first matching element */
function attr(doc, selector, attribute) {
	var el = doc.querySelector(selector);
	return el ? el.getAttribute(attribute) : "";
}

var testCases = [
	{
		"type": "web",
		"url": "https://www.utilitydive.com/news/epb-of-chattanooga-deploys-battery-based-microgrids-for-savings-resilience/814476/",
		"items": [
			{
				"itemType": "newspaperArticle",
				"title": "EPB of Chattanooga deploys battery-based microgrids for savings, resilience",
				"publicationTitle": "Utility Dive",
				"language": "en",
				"url": "https://www.utilitydive.com/news/epb-of-chattanooga-deploys-battery-based-microgrids-for-savings-resilience/814476/",
				"creators": [
					{
						"firstName": "Brian",
						"lastName": "Martucci",
						"creatorType": "author"
					}
				],
				"tags": [
					"Load Management, Efficiency & Demand Response",
					"Energy Storage"
				]
			}
		]
	}
];

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
