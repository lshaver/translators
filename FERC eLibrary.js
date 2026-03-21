{
	"translatorID": "f3c4a8b2-1e57-4d90-b3fa-ferc00000001",
	"label": "FERC eLibrary",
	"creator": "Custom",
	"target": "^https://elibrary\\.ferc\\.gov/eLibrary/filelist\\?accession_num(ber)?=",
	"minVersion": "5.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-21 04:17:25"
}

/*
 * FERC eLibrary Translator
 *
 * Makes two API calls via ZU.doGet (plain GETs, work from the connector):
 *
 *   1. GET /eLibraryWebAPI/api/File/GetFileListFromP8/{accessionNum}
 *      -> file metadata: description, dates, file type, original filename
 *
 *   2. GET /eLibraryWebAPI/api/Document/GetDocInfoFromP8/{accessionNum}
 *      -> document metadata: eLcAffiliation (authors), eLcDocket, eLcClassType
 *
 * PDF download is not automatic. FERC's download endpoints require a
 * credentialed POST that the Zotero connector cannot send (ZU.doPost routes
 * through Zotero's background process, not the browser's network stack, so
 * session cookies are not included). The filelist page URL is attached as a
 * link so the user can return to the page, click "Generate PDF", and drag
 * the downloaded file into Zotero.
 *
 * Supported URL patterns:
 *   https://elibrary.ferc.gov/eLibrary/filelist?accession_num=YYYYMMDD-NNNN
 *   https://elibrary.ferc.gov/eLibrary/filelist?accession_number=YYYYMMDD-NNNN
 */

function detectWeb(doc, url) {
	if (/\/eLibrary\/filelist\?accession_num(ber)?=/i.test(url)) {
		return "case";
	}
	return false;
}

function doWeb(doc, url) {
	scrape(doc, url);
}

function scrape(doc, url) {
	var accessionMatch = url.match(/accession_num(?:ber)?=([0-9]{8}-[0-9]{4})/i);
	var accessionNum = accessionMatch ? accessionMatch[1] : null;

	if (!accessionNum) {
		var item = new Zotero.Item("case");
		item.caseName = ZU.trimInternal(doc.title || "FERC Filing");
		item.court = "Federal Energy Regulatory Commission";
		item.url = url;
		item.complete();
		return;
	}

	// First call: file list (description, dates, file type, filename)
	var fileApiUrl = "https://elibrary.ferc.gov/eLibraryWebAPI/api/File/GetFileListFromP8/"
		+ accessionNum;

	ZU.doGet(fileApiUrl, function (fileResponse) {
		var fileData;
		try { fileData = JSON.parse(fileResponse); }
		catch (e) { fileData = { DataList: [] }; }
		var files = (fileData.DataList && fileData.DataList.length) ? fileData.DataList : [];
		var fileFirst = files[0] || {};

		// Second call: document info (authors, dockets, class type)
		var docApiUrl = "https://elibrary.ferc.gov/eLibraryWebAPI/api/Document/GetDocInfoFromP8/"
			+ accessionNum;

		ZU.doGet(docApiUrl, function (docResponse) {
			var docData;
			try { docData = JSON.parse(docResponse); }
			catch (e) { docData = { DataList: [] }; }
			var docList = (docData.DataList && docData.DataList.length) ? docData.DataList : [];
			var docFirst = docList[0] || {};

			buildItem(doc, url, accessionNum, fileFirst, files, docFirst);
		});
	});
}

function buildItem(doc, url, accessionNum, fileFirst, files, docFirst) {
	var item = new Zotero.Item("case");

	/* Case name — prefer docinfo description, fall back to file list, then DOM */
	var caseName = (docFirst.Description && docFirst.Description.trim())
		|| (fileFirst.Description && fileFirst.Description.trim())
		|| getDomLabel(doc)
		|| ("FERC Filing " + accessionNum);
	item.caseName = caseName;
	item.title    = caseName;

	/* Date — prefer docinfo, fall back to file list, then accession prefix */
	var rawDate = docFirst.Filed_Date
		|| docFirst.First_received_Date
		|| fileFirst.Filed_Date
		|| fileFirst.First_received_Date
		|| fileFirst.Issued_Date
		|| fileFirst.Accession_Date
		|| null;

	if (rawDate) {
		var isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
		var usMatch  = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
		if (isoMatch) {
			item.dateDecided = isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
		}
		else if (usMatch) {
			item.dateDecided = usMatch[3] + "-" + pad2(usMatch[1]) + "-" + pad2(usMatch[2]);
		}
		else {
			item.dateDecided = rawDate;
		}
	}
	else {
		var ap = accessionNum.replace(/-.*/, "");
		item.dateDecided = ap.slice(0, 4) + "-" + ap.slice(4, 6) + "-" + ap.slice(6, 8);
	}

	/* Dockets — prefer eLcDocket from docinfo; append sub-docket */
	var dockets = [];
	if (Array.isArray(docFirst.eLcDocket)) {
		docFirst.eLcDocket.forEach(function (d) {
			var num = d.Docket_Number || d.Docket_Num || "";
			if (!num) return;
			var sub = d.SubDocket_Number || d.Sub_Docket_Number || "";
			var full = sub ? num + "-" + sub : num;
			if (dockets.indexOf(full) === -1) dockets.push(full);
		});
	}
	if (dockets.length === 0 && fileFirst.Lead_Docket) dockets.push(fileFirst.Lead_Docket);
	if (dockets.length === 0) dockets = getDomDockets(doc);
	if (dockets.length > 0) item.docketNumber = dockets[0];

	/* Court */
	item.court = "Federal Energy Regulatory Commission";

	/* Creators — AUTHOR entries from eLcAffiliation, organization only */
	var filer = "";
	var affiliations = docFirst.eLcAffiliation || fileFirst.eLcAffiliation || [];
	if (Array.isArray(affiliations)) {
		affiliations.forEach(function (aff) {
			if (aff.Correspondent_Type !== "AUTHOR") return;
			if (!aff.Affiliation_Organization) return;
			item.creators.push({
				creatorType: "author",
				fieldMode:   1,
				lastName:    aff.Affiliation_Organization
			});
			if (!filer) filer = aff.Affiliation_Organization;
		});
	}
	if (!filer) {
		var orgs = docFirst.Affiliation_Organization || fileFirst.Affiliation_Organization || [];
		if (Array.isArray(orgs) && orgs.length) filer = orgs[0];
	}

	/* Extra */
	var extraParts = [];
	extraParts.push("Accession Number: " + accessionNum);
	if (dockets.length > 1)         extraParts.push("Dockets: " + dockets.join(", "));
	var docType = "";
	if (Array.isArray(docFirst.eLcClassType) && docFirst.eLcClassType.length) {
		docType = docFirst.eLcClassType[0].Type || docFirst.eLcClassType[0].Class || "";
	}
	if (docType)                    extraParts.push("Document Type: " + docType);
	if (fileFirst.File_Type_Code)   extraParts.push("File Type: " + fileFirst.File_Type_Code);

	if (fileFirst.Orig_File_Name)   extraParts.push("Original Filename: " + fileFirst.Orig_File_Name);
	if (files.length > 1)           extraParts.push("Files in filing: " + files.length);
	item.extra = extraParts.join("\n");

	item.url = url;



	item.complete();
}

function getDomLabel(doc) {
	var el = doc.querySelector("label[tabindex='0']");
	return el ? ZU.trimInternal(el.textContent) : "";
}

function getDomDockets(doc) {
	var dockets = [];
	var bodyText = doc.body ? doc.body.innerText : "";
	for (var dm of bodyText.matchAll(/([A-Z]{2,4}[0-9]{2}-[0-9]+-[0-9]+|[A-Z]{2,4}[0-9]{2}-[0-9]+)/g)) {
		if (dockets.indexOf(dm[1]) === -1) dockets.push(dm[1]);
	}
	return dockets;
}

function pad2(n) {
	return ("0" + parseInt(n, 10)).slice(-2);
}

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
