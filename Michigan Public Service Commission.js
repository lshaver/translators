{
	"translatorID": "c2d3e4f5-a6b7-8901-cdef-123456789012",
	"label": "Michigan Public Service Commission",
	"creator": "Custom Translator",
	"target": "https?://mi-psc\\.my\\.site\\.com/s/",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-04 21:05:13"
}

/*
 * Michigan Public Service Commission - Zotero Web Translator
 *
 * Triggers on MPSC E-Dockets filing pages:
 *   https://mi-psc.my.site.com/s/filing/{SalesforceId}/{slug}
 *   e.g. /s/filing/a00cs00001ZU0CSAA1/u219860050
 *
 * The portal is a fully client-side Salesforce LWC app. All content is
 * injected after page load — detectWeb gates on rendered content being
 * present in body.innerText before allowing doWeb to fire.
 *
 * Creates one Zotero "case" item with:
 *   Title        — Filing Description field
 *   Docket No    — Case Number field (falls back to slug parsing)
 *   Court        — MPSC
 *   Date Decided — File Date field
 *   URL          — filing page URL
 *   Creator      — On Behalf of Company (institutional author)
 *   Extra        — Document Type (Filing Type), Filed By
 *   Attachment   — PDF fetched via Salesforce Aura API
 */

// ─── Field parsing ────────────────────────────────────────────────────────────

/**
 * Parse the page's body text into a label→value map.
 *
 * The MPSC portal renders inside Salesforce shadow DOM — querySelector
 * cannot reach the field elements. document.body.innerText contains all
 * visible text in reading order and is used instead.
 *
 * The portal emits fields in two patterns:
 *   Simple:       Label\nValue
 *   With tooltip: Label\nHelp Label\nValue
 *
 * textContent (used by Scaffold) doesn't insert newlines between elements
 * the way innerText does in a live browser, so we pre-insert newlines
 * around each known label before splitting.
 */
function parseInnerTextFields(doc) {
	var map = {};
	var raw = doc.body ? (doc.body.innerText || doc.body.textContent || "") : "";
	if (!raw) return map;

	// Strip "Open <anything> Preview" assistive text injected by Salesforce
	// lookup fields (e.g. "U-21986 Open U-21986 Preview" → "U-21986")
	raw = raw.replace(/\s*Open [^\n]+? Preview\s*/g, "").replace(/[ \t]+/g, " ");

	// Known labels, sorted longest-first to avoid prefix collisions
	// (e.g. "On Behalf of Company" must match before shorter labels)
	var knownLabels = [
		"On Behalf of Company", "Filing Description", "Filing Type",
		"File Date", "File Name", "Filed By",
		"Case Number", "Filing #", "# Pages", "Filer"
	];

	// Pre-insert newlines before and after each label so that textContent
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
	function isHelpEcho(s, label) {
		return s === "Help " + label;
	}

	for (var i = 0; i < lines.length; i++) {
		if (!isKnownLabel(lines[i])) continue;
		var label = lines[i];
		var j = i + 1;
		// Skip any "Help <Label>" echo lines Salesforce emits for tooltip fields
		while (j < lines.length && isHelpEcho(lines[j], label)) j++;
		// Next non-label line is the value
		if (j < lines.length && !isKnownLabel(lines[j])) {
			map[label] = lines[j].trim();
		}
	}

	return map;
}

// ─── Docket number ────────────────────────────────────────────────────────────

/**
 * Parse docket number from the URL slug.
 *   "u219860050" → "U-21986-0050"
 *   "u180500001" → "U-18050-0001"
 *
 * The last 4 digits are the filing/item number; the rest is the case number.
 */
function parseDocketFromSlug(slug) {
	var m = slug.match(/^[a-z]+(\d+)$/i);
	if (!m) return "";
	var digits = m[1];
	if (digits.length < 5) return "U-" + digits;
	return "U-" + digits.slice(0, digits.length - 4) + "-" + digits.slice(-4);
}

// ─── PDF fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch the PDF download URL via the Salesforce Aura API.
 *
 * Step 1: Extract the ContentDocument ID (069…) from the page HTML.
 * Step 2: POST to the Aura endpoint to exchange it for a ContentVersion ID.
 * Step 3: Return the shepherd download URL to the callback.
 *
 * The translator runs inside the browser via the Zotero Connector, so it
 * inherits the page's session cookies automatically — no auth needed.
 *
 * @param {Document} doc
 * @param {string}   url  — current page URL (used for aura.pageURI)
 * @param {Function} cb   — callback(downloadUrl or null)
 */
function fetchPdfUrl(doc, url, cb) {
	// Step 1: find ContentDocument ID in page HTML
	var htmlMatch = doc.body.innerHTML.match(/069[a-zA-Z0-9]{12,15}/);
	if (!htmlMatch) {
		Zotero.debug("MPSC fetchPdfUrl: no ContentDocument ID found in HTML");
		cb(null);
		return;
	}
	var cdocumentId = htmlMatch[0];
	Zotero.debug("MPSC fetchPdfUrl: cdocumentId = " + cdocumentId);

	// Step 2: call Aura to get ContentVersion ID
	var pageURI = url.replace(/^https?:\/\/[^/]+/, "");

	var message = JSON.stringify({
		actions: [{
			id: "210;a",
			descriptor: "apex://FileUploadRelatedListCompCtrl/ACTION$getCVId",
			callingDescriptor: "markup://c:FileUploadRelatedListCompV2",
			params: { cdocumentId: cdocumentId }
		}]
	});

	var auraContext = JSON.stringify({
		mode: "PROD",
		app: "siteforce:communityApp",
		dn: [],
		globals: { srcdoc: true },
		uad: true
	});

	var body =
		"message="       + encodeURIComponent(message) +
		"&aura.context=" + encodeURIComponent(auraContext) +
		"&aura.pageURI=" + encodeURIComponent(pageURI) +
		"&aura.token=null";

	var auraUrl = "https://mi-psc.my.site.com/s/sfsites/aura" +
		"?r=21&other.FileUploadRelatedListCompCtrl.getCVId=1";

	ZU.doPost(auraUrl, body, function (responseText) {
		Zotero.debug("MPSC fetchPdfUrl Aura response: " + responseText.substring(0, 500));
		try {
			var data    = JSON.parse(responseText);
			var actions = data && data.actions;
			var rv      = actions && actions[0] && actions[0].returnValue;
			if (rv) {
				var downloadUrl = "https://mi-psc.my.site.com/sfc/servlet.shepherd/version/download/" + rv;
				Zotero.debug("MPSC fetchPdfUrl: download URL = " + downloadUrl);
				cb(downloadUrl);
			} else {
				Zotero.debug("MPSC fetchPdfUrl: no returnValue in response");
				cb(null);
			}
		} catch (e) {
			Zotero.debug("MPSC fetchPdfUrl: JSON parse error: " + e);
			cb(null);
		}
	}, "application/x-www-form-urlencoded");
}

// ─── Zotero entry points ──────────────────────────────────────────────────────

function detectWeb(doc, url) {
	var isFiling = /\/s\/filing\//.test(url);
	var isCase   = /\/s\/case\//.test(url);
	if (!isFiling && !isCase) return false;

	// Gate on rendered content — the page is a Salesforce LWC app that
	// injects all content after load. Return false until innerText contains
	// a known field label, and watch for DOM changes to re-run detection.
	var bodyText = doc.body ? (doc.body.innerText || "") : "";
	if (bodyText.indexOf("File Date") === -1) {
		Zotero.monitorDOMChanges(doc.body, { childList: true, subtree: true });
		return false;
	}

	return "case";
}

function doWeb(doc, url) {
	Zotero.debug("MPSC scrape called: " + url);

	var fields = parseInnerTextFields(doc);
	Zotero.debug("MPSC parsed fields: " + JSON.stringify(fields));

	// ── Docket number ──────────────────────────────────────────────────────
	var docketNumber = fields["Case Number"] || fields["Docket Number"] || "";

	// Slug fallback: strip trailing -NNNN item suffix to get case number only
	// e.g. u219860050 → U-21986-0050 → U-21986
	if (!docketNumber) {
		var slugMatch = url.match(/\/s\/(?:filing|case)\/[^/]+\/([^/?#]+)/);
		if (slugMatch) {
			docketNumber = parseDocketFromSlug(slugMatch[1]).replace(/-\d{4}$/, "");
		}
	}

	// ── Populate item ──────────────────────────────────────────────────────
	var item = new Zotero.Item("case");

	item.title        = fields["Filing Description"] || (docketNumber ? "MPSC " + docketNumber : "MPSC Filing");
	item.docketNumber = docketNumber;
	item.court        = "MPSC";
	item.dateDecided  = fields["File Date"] || fields["Date Filed"] || "";
	item.url          = url;
	item.place        = "Lansing, MI";
	item.libraryCatalog = "Michigan Public Service Commission";

	// ── Author — On Behalf of Company ─────────────────────────────────────
	var onBehalf = fields["On Behalf of Company"] || "";
	if (onBehalf) {
		item.creators.push({ lastName: onBehalf, creatorType: "author", fieldMode: 1 });
	}

	// ── Extra ──────────────────────────────────────────────────────────────
	var docType = fields["Filing Type"] || fields["Document Type"] || "";
	var filer   = fields["Filed By"]    || fields["Filer"]         || "";
	if (docType) item.extra = (item.extra ? item.extra + "\n" : "") + "Document Type: " + docType;
	if (filer)   item.extra = (item.extra ? item.extra + "\n" : "") + "Filed By: " + filer;

	// ── PDF attachment (async) ─────────────────────────────────────────────
	// item.complete() is called inside the callback because fetchPdfUrl is
	// asynchronous — completing before it finishes would drop the attachment.
	fetchPdfUrl(doc, url, function (downloadUrl) {
		if (downloadUrl) {
			item.attachments.push({
				title:    "Filing Document (PDF)",
				url:      downloadUrl,
				mimeType: "application/pdf"
			});
		} else {
			item.attachments.push({
				title:    "MPSC Filing Page",
				document: doc,
				mimeType: "text/html"
			});
		}
		item.complete();
	});
}

var testCases = [
	{
		"type": "web",
		"url": "https://mi-psc.my.site.com/s/filing/a00cs00001ZU0CSAA1/u219860050",
		"items": [
			{
				"itemType": "case",
				"title": "Rebuttal Testimony and Exhibit of Lee Shaver on behalf of The Ecology Center, The Environmental Law & Policy Center, Union of Concerned Scientists, and Vote Solar",
				"docketNumber": "U-21986",
				"court": "MPSC",
				"place": "Lansing, MI",
				"libraryCatalog": "Michigan Public Service Commission",
				"url": "https://mi-psc.my.site.com/s/filing/a00cs00001ZU0CSAA1/u219860050"
			}
		]
	}
];

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
