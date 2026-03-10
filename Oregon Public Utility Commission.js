{
	"translatorID": "e7a7b5e0-4b1a-4c2e-9f3d-8a6c5d2e1f0b",
	"label": "Oregon Public Utility Commission",
	"creator": "Claude",
	"target": "https://apps\\.puc\\.state\\.or\\.us/edockets/docket\\.asp\\?DocketID=",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-05 17:39:32"
}

/*
	Oregon Public Utility Commission Translator

	Triggers on docket pages of the form:
	  https://apps.puc.state.or.us/edockets/docket.asp?DocketID=24813

	Presents a multi-item picker listing all filings that have a PDF.
	For each selected filing, creates a Zotero Legal Case item and attaches the PDF.

	Metadata extracted from the docket page:
	  - Docket number (e.g. "AR 681")
	  - Docket name (e.g. "Microgrid Frameworks...")
	  - "In the Matter of..." case title
	  - Case manager name
	  - Per-filing: date, action type, description, PDF URL

	Also fetches the service list page to look up the filing organization
	from the "filed by [Name]" pattern in the description.
*/

// ---------------------------------------------------------------------------
// Utility: convert ALL CAPS strings to Title Case
// ---------------------------------------------------------------------------

function toTitleCase(str) {
	if (!str) return str;
	// If the string is not all caps, return as-is
	if (str !== str.toUpperCase()) return str;
	var minorWords = {
		"a": true, "an": true, "the": true, "and": true, "but": true,
		"or": true, "for": true, "nor": true, "on": true, "at": true,
		"to": true, "by": true, "in": true, "of": true, "up": true,
		"as": true, "is": true, "it": true
	};
	return str.toLowerCase().replace(/\S+/g, function(word, offset) {
		if (offset === 0 || !minorWords[word]) {
			return word.charAt(0).toUpperCase() + word.slice(1);
		}
		return word;
	});
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function detectWeb(doc, url) {
	if (url.match(/docket\.asp\?DocketID=\d+/i)) {
		return "multiple";
	}
	return false;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function doWeb(doc, url) {
	var docketMeta = parseDocketMeta(doc);
	var filings = parseFilings(doc);

	if (filings.length === 0) return;

	var docketIdMatch = url.match(/DocketID=(\d+)/i);
	if (!docketIdMatch) {
		saveItems(filings, docketMeta, url, {});
		return;
	}

	var servlistUrl = "https://apps.puc.state.or.us/edockets/Docket.asp?DocketID="
		+ docketIdMatch[1] + "&Child=servlist";

	ZU.doGet(servlistUrl, function(html) {
		var parser = new DOMParser();
		var servDoc = parser.parseFromString(html, "text/html");
		var serviceMap = parseServiceList(servDoc);
		saveItems(filings, docketMeta, url, serviceMap);
	});
}

function saveItems(filings, docketMeta, url, serviceMap) {
	var items = {};
	for (var i = 0; i < filings.length; i++) {
		var f = filings[i];
		var label = f.date ? f.date + " \u2014 " + f.description : f.description;
		items[i] = label;
	}

	Zotero.selectItems(items, function(selected) {
		if (!selected) return;
		for (var idx in selected) {
			createItem(filings[parseInt(idx)], docketMeta, url, serviceMap);
		}
	});
}

// ---------------------------------------------------------------------------
// Metadata parsers
// ---------------------------------------------------------------------------

function parseDocketMeta(doc) {
	var meta = {
		docketNumber: null,
		docketName:   null,
		caseTitle:    null,
		caseManager:  null,
	};

	var cells = doc.querySelectorAll("td");

	for (var i = 0; i < cells.length; i++) {
		var text = ZU.trimInternal(cells[i].textContent);

		if (text.match(/^Docket No:/i)) {
			var val = text.replace(/^Docket No:/i, "").trim();
			meta.docketNumber = val || (cells[i + 1] && ZU.trimInternal(cells[i + 1].textContent));
		}

		if (text.match(/^Docket Name:/i)) {
			var val = text.replace(/^Docket Name:/i, "").trim();
			meta.docketName = toTitleCase(val || (cells[i + 1] && ZU.trimInternal(cells[i + 1].textContent)));
		}

		if (text.match(/^Case Manager:/i)) {
			var val = text.replace(/^Case Manager:/i, "").trim();
			meta.caseManager = toTitleCase(val || (cells[i + 1] && ZU.trimInternal(cells[i + 1].textContent)));
		}

		if (!meta.caseTitle && text.match(/^In the Matter of /i) && text.length > 20) {
			meta.caseTitle = toTitleCase(text.replace(/\.$/, "").trim());
		}
	}

	return meta;
}

function parseFilings(doc) {
	var filings = [];
	var cells = doc.querySelectorAll("td");

	for (var i = 0; i < cells.length - 5; i++) {
		var text = ZU.trimInternal(cells[i].textContent);

		// Filing blocks start with a cell containing exactly "Date:"
		if (text !== "Date:") continue;

		var filing = {
			date:        ZU.trimInternal(cells[i + 1].textContent),
			actionType:  null,
			description: null,
			pdfUrl:      null,
			orderNumber: null,
		};

		// Cell i+2: "Action: OTHER FILING/PLEADING"
		var actionText = ZU.trimInternal(cells[i + 2].textContent);
		var actionMatch = actionText.match(/^Action:\s*(.+)$/);
		if (actionMatch) {
			filing.actionType = toTitleCase(ZU.trimInternal(actionMatch[1]));
		}

		// Cell i+3: link cell — "Searchable Doc" or "Getdocs" order link
		var linkCell = cells[i + 3];

		// Searchable Doc link → build direct PDF URL from FileType and FileName
		var docLinks = linkCell.querySelectorAll('a[href*="FileName="]');
		if (docLinks.length > 0) {
			var href = docLinks[0].getAttribute("href");
			var ftMatch = href.match(/FileType=([^&]+)/i);
			var fnMatch = href.match(/FileName=([^&]+)/i);
			if (ftMatch && fnMatch) {
				filing.pdfUrl = "https://edocs.puc.state.or.us/efdocs/"
					+ ftMatch[1] + "/" + fnMatch[1];
			}
		}

		// Order link → orders.asp?OrderNumber=YY-NNN
		// Converts to: https://apps.puc.state.or.us/orders/20YYords/YY-NNN.pdf
		var orderLinks = linkCell.querySelectorAll('a[href*="orders.asp"]');
		if (orderLinks.length > 0) {
			var orderHref = orderLinks[0].getAttribute("href");
			var onMatch = orderHref.match(/OrderNumber=(\d+)-(\d+)/i);
			if (onMatch) {
				var orderYear = "20" + onMatch[1];
				var orderNumber = onMatch[1] + "-" + onMatch[2];
				filing.orderNumber = orderNumber;
				filing.pdfUrl = "https://apps.puc.state.or.us/orders/"
					+ orderYear + "ords/" + orderNumber + ".pdf";
			}
		}

		// Cell i+5: "Description ..."
		// Strip "Description" label and "Informal Phase:" prefix
		var descText = ZU.trimInternal(cells[i + 5].textContent);
		filing.description = descText
			.replace(/^Description\s*/i, "")
			.replace(/^Informal Phase:\s*/i, "")
			.replace(/[;,]?\s*(?:filed by|,\s*by|;\s*by)\s+.+$/i, "")
			.trim();

		if (!filing.description) {
			filing.description = filing.actionType || ("Filing dated " + filing.date);
		}

		// Only keep filings that have a PDF
		if (filing.pdfUrl) {
			filings.push(filing);
		}
	}

	return filings;
}

function parseServiceList(doc) {
	// Returns a map of "FIRSTNAME LASTNAME" -> "Organization Name"
	// Service list name cells look like: "FIRSTNAME LASTNAME ORGANIZATION NAME"
	var serviceMap = {};
	var cells = doc.querySelectorAll("td");

	for (var i = 0; i < cells.length; i++) {
		var text = ZU.trimInternal(cells[i].textContent);

		// Service list name+org cells are all-caps, no digits, min length
		if (!text.match(/^[A-Z\s\.\-\']+$/) || text.length < 5) continue;

		// Skip known header/nav cells
		if (text.match(/^(ACTIONS|SERVICE LIST|SCHEDULE|PUBLIC COMMENTS|SORT BY|EMAIL SERVICE|EFILE|EDOCKETS|DOCKET|RETURN|SUBMIT|OREGON)/)) continue;

		var words = text.trim().split(/\s+/);
		if (words.length < 3) continue;

		// 2-word name: words[0] + words[1], org = rest
		var name2 = words[0] + " " + words[1];
		var org2  = toTitleCase(words.slice(2).join(" "));
		serviceMap[name2] = org2;

		// Last name only as fallback
		serviceMap[words[1]] = org2;

		// 3-word name (e.g. "MARY ALICE TAYLOR")
		if (words.length >= 4) {
			var name3 = words[0] + " " + words[1] + " " + words[2];
			var org3  = toTitleCase(words.slice(3).join(" "));
			serviceMap[name3] = org3;
		}
	}

	return serviceMap;
}

// ---------------------------------------------------------------------------
// Organization lookup from "filed by [Name]" in description
// ---------------------------------------------------------------------------

function lookupOrg(description, serviceMap) {
	// Match "filed by Name", ", by Name", or "; by Name" at or near end of string
	var match = description.match(/(?:filed by|,\s*by|;\s*by)\s+([A-Za-z]+(?: [A-Za-z]+){1,3})\s*\.?\s*$/i);
	if (!match) return null;

	var rawName = ZU.trimInternal(match[1]).toUpperCase();
	var words = rawName.split(/\s+/);

	// Try full name first
	if (serviceMap[rawName]) return serviceMap[rawName];

	// Try last name only
	if (words.length >= 2 && serviceMap[words[words.length - 1]]) {
		return serviceMap[words[words.length - 1]];
	}

	return null;
}

// ---------------------------------------------------------------------------
// Item creation
// ---------------------------------------------------------------------------

function createItem(filing, docketMeta, docketPageUrl, serviceMap) {
	var item = new Zotero.Item("case");

	item.title = filing.description;
	item.caseName = filing.description;
	item.court = "Oregon Public Utility Commission";

	if (docketMeta.docketNumber) item.docketNumber = docketMeta.docketNumber;
	if (filing.date) item.dateDecided = filing.date;

	// URL: direct PDF link, fall back to docket page
	item.url = filing.pdfUrl || docketPageUrl;

	// Creator: organization from service list lookup
	var org = lookupOrg(filing.description, serviceMap);
	if (org) {
		item.creators.push({
			lastName:    org,
			creatorType: "author",
			fieldMode:   1  // single-field (organization) name
		});
	}

	// Extra
	var extraParts = [];
	if (docketMeta.caseTitle)   extraParts.push("Case Title: " + docketMeta.caseTitle);
	if (docketMeta.docketName)  extraParts.push("Docket Name: " + docketMeta.docketName);
	if (filing.actionType)      extraParts.push("Action Type: " + filing.actionType);
	if (docketMeta.caseManager) extraParts.push("Case Manager: " + docketMeta.caseManager);
	if (filing.orderNumber)     extraParts.push("Order Number: " + filing.orderNumber);
	if (extraParts.length) item.extra = extraParts.join("\n");

	if (filing.pdfUrl) {
		item.attachments.push({
			url:      filing.pdfUrl,
			title:    "Oregon PUC Filing (PDF)",
			mimeType: "application/pdf",
		});
	}

	item.complete();
}

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
