{
	"translatorID": "b1c2d3e4-f5a6-7890-bcde-f12345678901",
	"label": "Illinois Commerce Commission",
	"creator": "Custom Translator",
	"target": "https?://(www\\.)?icc\\.illinois\\.gov/docket/P\\d{4}-\\d+/documents/\\d+",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-04 21:02:09"
}

/*
 * Illinois Commerce Commission - Zotero Web Translator
 *
 * Triggers on individual document detail pages:
 *   https://www.icc.illinois.gov/docket/P{YYYY}-{NNNN}/documents/{id}
 *
 * For each PDF linked from the page, creates one Zotero "case" item with:
 *   Title        — document link text + " – " + filing Description
 *   Docket No    — case number from URL (e.g. 26-0047)
 *   Court        — ICC
 *   Date Decided — Date Filed
 *   URL          — document detail page
 *   Creator      — Filed For (institutional author), fetched from parent list page
 *   Extra        — Type, Means Received, Filed By
 *   Attachment   — PDF file
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The ICC document detail page renders metadata as plain text:
 *   Type\nTestimony\nFiled By\n\nDate Filed\nJanuary 16, 2026\n...
 *
 * Parses body.innerText (or textContent in Scaffold) into a label→value map
 * by matching known field labels and taking the following non-label line as
 * the value. Empty values (e.g. blank Filed By) produce an empty string.
 */
function parseInnerTextFields(doc) {
	var map = {};
	var raw = "";
	if (doc.body) {
		raw = doc.body.innerText || doc.body.textContent || "";
	}
	if (!raw && doc.documentElement) {
		raw = doc.documentElement.innerText || doc.documentElement.textContent || "";
	}
	Zotero.debug("ICC detail page raw length: " + raw.length + " first200: " + raw.slice(0, 200));
	if (!raw) return map;

	var knownLabels = [
		"Type", "Filed By", "Filed For", "Date Filed", "Means Received", "Description"
	];

	// Pre-insert newlines before and after each label so textContent
	// (which omits element boundaries) splits correctly
	knownLabels.forEach(function (lbl) {
		var escaped = lbl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		raw = raw.replace(new RegExp("([^\n])(" + escaped + ")", "g"), "$1\n$2");
		raw = raw.replace(new RegExp("(" + escaped + ")([^\n])", "g"), "$1\n$2");
	});

	var lines = raw.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);

	function isKnownLabel(s) {
		return knownLabels.some(function (lbl) { return s === lbl; });
	}

	for (var i = 0; i < lines.length; i++) {
		if (!isKnownLabel(lines[i])) continue;
		var label = lines[i];
		var j = i + 1;
		// Value is the next line — may be empty string if field is blank
		if (j < lines.length) {
			map[label] = isKnownLabel(lines[j]) ? "" : lines[j].trim();
		}
	}

	return map;
}

/**
 * Given the document detail page doc and its URL, plus filedBy/filedFor
 * obtained from the parent list page, creates one Zotero "case" item
 * per PDF link on the page.
 */
function scrapeDocumentPage(doc, url, filedBy, filedFor) {
	// Case number from URL: /docket/P2026-0047/… → "26-0047"
	var caseMatch = url.match(/\/docket\/P(\d{4})-(\d+)/i);
	var caseNumber = caseMatch ? caseMatch[1].slice(-2) + "-" + caseMatch[2] : "";

	// Metadata from <code> blocks on the detail page
	var meta        = parseInnerTextFields(doc);
	Zotero.debug("ICC meta: " + JSON.stringify(meta));
	var docType     = ZU.trimInternal(meta["Type"]           || "");
	var dateField   = ZU.trimInternal(meta["Date Filed"]     || "");
	var meansRcvd   = ZU.trimInternal(meta["Means Received"] || "");
	var description = ZU.trimInternal(meta["Description"]    || "");

	// Strip placeholder values
	if (filedFor === "(Unknown)") filedFor = "";
	if (filedBy  === "(Unknown)") filedBy  = "";

	// Normalize date: "January 16, 2026" → "2026-01-16"
	var normalizedDate = dateField;
	if (dateField) {
		var d = new Date(dateField);
		if (!isNaN(d)) {
			var mm  = String(d.getMonth() + 1).padStart(2, "0");
			var dd2 = String(d.getDate()).padStart(2, "0");
			normalizedDate = d.getFullYear() + "-" + mm + "-" + dd2;
		}
	}

	// Build Extra field
	var extraParts = [];
	if (docType)   extraParts.push("Type: "           + docType);
	if (meansRcvd) extraParts.push("Means Received: " + meansRcvd);
	if (filedBy)   extraParts.push("Filed By: "       + filedBy);
	var extraStr = extraParts.join("\n");

	// Collect all PDF links from the numbered list
	var pdfLinks = doc.querySelectorAll("ol li a[href*='/files/']");
	if (!pdfLinks.length) pdfLinks = doc.querySelectorAll("a[href$='.pdf']");

	for (var i = 0; i < pdfLinks.length; i++) {
		var link    = pdfLinks[i];
		var docName = ZU.trimInternal(link.textContent);
		var pdfHref = link.getAttribute("href");
		var pdfUrl  = pdfHref.startsWith("http")
			? pdfHref
			: "https://www.icc.illinois.gov" + pdfHref;

		// Title: "Document Name – Filing Description"
		var title = description ? docName + " \u2013 " + description : docName;

		var item = new Zotero.Item("case");
		item.title          = title;
		item.docketNumber   = caseNumber;
		item.court          = "ICC";
		item.dateDecided    = normalizedDate;
		item.url            = url;  // document detail page, not PDF
		item.place          = "Springfield, IL";
		item.extra          = extraStr;
		item.libraryCatalog = "Illinois Commerce Commission";

		if (filedFor) {
			item.creators.push({ lastName: filedFor, creatorType: "author", fieldMode: 1 });
		}

		item.attachments.push({
			title:    docName,
			url:      pdfUrl,
			mimeType: "application/pdf"
		});

		item.complete();
	}
}

// ─── Zotero entry points ──────────────────────────────────────────────────────

function detectWeb(doc, url) {
	// Only trigger on individual document detail pages, not the list page
	if (/\/docket\/P\d{4}-\d+\/documents\/\d+/.test(url)) return "multiple";
	return false;
}

function doWeb(doc, url) {
	// Derive parent docket list URL to fetch Filed By / Filed For
	// e.g. /docket/P2026-0047/documents/375126 → /docket/P2026-0047/documents
	var docIdMatch = url.match(/\/documents\/(\d+)/);
	if (!docIdMatch) {
		scrapeDocumentPage(doc, url, "", "");
		return;
	}

	var listUrl  = url.replace(/\/documents\/\d+.*$/, "/documents");
	var docIdStr = docIdMatch[1];

	Zotero.debug("ICC list page fetched: " + listUrl);
	ZU.processDocuments([listUrl], function (listDoc) {
		var filedBy  = "";
		var filedFor = "";

		// Each entry on the list page:
		//   <li>
		//     Mon - YYYY\n  DD\n
		//     <h4><a href="/docket/P####-####/documents/{id}">Type</a></h4>
		//     Description text  Filed-By-Name  Filed-For-Company
		//   </li>
		var entryLinks = listDoc.querySelectorAll("h4 a[href*='/documents/']");
		for (var i = 0; i < entryLinks.length; i++) {
			if (entryLinks[i].href.indexOf("/documents/" + docIdStr) === -1) continue;

			// Walk up to the enclosing <li>
			var li = entryLinks[i];
			while (li && li.tagName && li.tagName.toLowerCase() !== "li") {
				li = li.parentElement;
			}
			if (!li) break;

			// The list item has no "Filed By:" / "Filed For:" labels.
			// Format: "... Description\nDescription   Monique Woody   Commonwealth Edison Company"
			// Split on 2+ spaces or newlines, take the last two non-empty chunks.
			var liText = li.innerText || li.textContent || "";
			Zotero.debug("ICC list item text: " + JSON.stringify(liText));

			var chunks = liText.split(/[ \t]{2,}|\n/).map(function (s) {
				return s.trim();
			}).filter(Boolean);

			if (chunks.length >= 2) {
				filedBy  = chunks[chunks.length - 2];
				filedFor = chunks[chunks.length - 1];
			} else if (chunks.length === 1) {
				filedFor = chunks[0];
			}
			break;
		}

		scrapeDocumentPage(doc, url, filedBy, filedFor);
	});
}

var testCases = [
	{
		"type": "web",
		"url": "https://www.icc.illinois.gov/docket/P2026-0047/documents/375126",
		"items": [
			{
				"itemType": "case",
				"docketNumber": "26-0047",
				"court": "ICC",
				"dateDecided": "2026-01-16",
				"place": "Springfield, IL",
				"libraryCatalog": "Illinois Commerce Commission"
			}
		]
	}
];

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://www.icc.illinois.gov/docket/P2026-0047/documents/376974",
		"detectedItemType": "multiple",
		"items": [
			{
				"itemType": "case",
				"caseName": "Service List Additions – Correspondence",
				"creators": [
					{
						"lastName": "Commonwealth Edison Company",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateDecided": "2026-03-04",
				"court": "ICC",
				"docketNumber": "26-0047",
				"extra": "Type: Correspondence\nMeans Received: Electronic\nFiled By: Monique Woody",
				"url": "https://www.icc.illinois.gov/docket/P2026-0047/documents/376974",
				"attachments": [
					{
						"title": "Service List Additions",
						"mimeType": "application/pdf"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			},
			{
				"itemType": "case",
				"caseName": "Notice of Filing - Certificate of Service – Correspondence",
				"creators": [
					{
						"lastName": "Commonwealth Edison Company",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"dateDecided": "2026-03-04",
				"court": "ICC",
				"docketNumber": "26-0047",
				"extra": "Type: Correspondence\nMeans Received: Electronic\nFiled By: Monique Woody",
				"url": "https://www.icc.illinois.gov/docket/P2026-0047/documents/376974",
				"attachments": [
					{
						"title": "Notice of Filing - Certificate of Service",
						"mimeType": "application/pdf"
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
