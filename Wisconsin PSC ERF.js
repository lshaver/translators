{
	"translatorID": "e2b3c4d5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
	"label": "Wisconsin PSC ERF",
	"creator": "Your Name",
	"target": "https?://apps\\.psc\\.wi\\.gov/ERF/ERFsearch/content/documentInfo\\.aspx",
	"minVersion": "5.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-04-08 18:43:45"
}

/*
	Wisconsin PSC ERF Translator
	Scrapes document metadata from:
	  https://apps.psc.wi.gov/ERF/ERFsearch/content/documentInfo.aspx?docid=XXXXXX
	Attaches the PDF from:
	  https://apps.psc.wi.gov/ERF/ERFview/viewdoc.aspx?docid=XXXXXX
*/

function detectWeb(doc, url) {
	if (/documentInfo\.aspx/i.test(url)) {
		return "case";
	}
	return false;
}

function getField(doc, labelText) {
	var cells = doc.querySelectorAll("td.td_left_detail");
	for (var i = 0; i < cells.length; i++) {
		var label = cells[i].textContent.replace(/\u00a0/g, " ").trim().replace(/:?\s*$/, "");
		if (label === labelText) {
			var sibling = cells[i].nextElementSibling;
			if (sibling) return sibling.textContent.trim();
		}
	}
	return "";
}

function getFiledByName(doc) {
	var cells = doc.querySelectorAll("td.td_left_detail");
	for (var i = 0; i < cells.length; i++) {
		var label = cells[i].textContent.replace(/\u00a0/g, " ").trim().replace(/:?\s*$/, "");
		if (label === "Filed By Info") {
			var sibling = cells[i].nextElementSibling;
			if (!sibling) break;
			var html = sibling.innerHTML;
			var parts = html.split(/<br\s*\/?>/i);
			var tmp = doc.createElement("span");
			tmp.innerHTML = parts[0];
			return tmp.textContent.trim();
		}
	}
	return "";
}

function parseDate(dateStr) {
	if (!dateStr) return "";
	var m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
	if (m) {
		return m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
	}
	return dateStr;
}

function getDocId(url) {
	var m = url.match(/[?&]docid=(\d+)/i);
	return m ? m[1] : null;
}

function doWeb(doc, url) {
	var item = new Zotero.Item("case");

	var docId        = getDocId(url);
	var docketId     = getField(doc, "Utility/Docket ID");
	var docType      = getField(doc, "Document Type");
	var docDesc      = getField(doc, "Document Description");
	var receivedDate = getField(doc, "Received Date");
	var pscRef       = getField(doc, "PSC Ref#");
	var keyword      = getField(doc, "Keyword");
	var serviceType  = getField(doc, "Service Type");
	var filerName    = getFiledByName(doc);

	item.title        = docDesc || docType || ("PSC Document " + pscRef);
	item.caseName     = item.title;
	item.court        = "Wisconsin Public Service Commission";
	item.docketNumber = docketId;
	item.dateDecided  = parseDate(receivedDate);
	item.url          = url;

	// Extra
	var extraLines = [];
	if (pscRef)      extraLines.push("PSC Ref#: " + pscRef);
	if (docType)     extraLines.push("Document Type: " + docType);
	if (serviceType) extraLines.push("Service Type: " + serviceType);
	if (keyword)     extraLines.push("Keyword: " + keyword);
	if (docketId)    extraLines.push("Docket Page: http://apps.psc.wi.gov/pages/docketDetail.htm?dockt_id=" + docketId);
	if (extraLines.length) item.extra = extraLines.join("\n");

	// Creator
	if (filerName) {
		var nameParts = filerName.trim().split(/\s+/);
		var creator = { creatorType: "author" };
		if (nameParts.length >= 2) {
			creator.firstName = nameParts.slice(0, -1).join(" ");
			creator.lastName  = nameParts[nameParts.length - 1];
		} else {
			creator.lastName  = filerName;
			creator.firstName = "";
		}
		item.creators.push(creator);
	}

	// PDF attachment
	if (docId) {
		item.attachments.push({
			url:      "https://apps.psc.wi.gov/ERF/ERFview/viewdoc.aspx?docid=" + docId,
			title:    (docDesc || docType || ("Document " + docId)) + ".pdf",
			mimeType: "application/pdf"
		});
	}

	item.complete();
}

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
