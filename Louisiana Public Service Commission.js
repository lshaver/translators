{
	"translatorID": "e8a7e945-8e63-4b58-b1b2-4b0e4e4e4e4e",
	"label": "Louisiana Public Service Commission",
	"creator": "Your Name",
	"target": "^https://lpscpubvalence\\.lpsc\\.louisiana\\.gov/portal/PSC/DocketDetails",
	"minVersion": "5.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-09 20:05:02"
}

/*
	Louisiana Public Service Commission Zotero Translator
	Target: https://lpscpubvalence.lpsc.louisiana.gov/portal/PSC/DocketDetails?docketId=XXXXX

	Approach:
	  - detectWeb fires on DocketDetails pages
	  - doWeb fetches ALL documents via the Docket_Documents API (paging through all results)
	  - Presents a multiple-item picker: one entry per individual file
	  - Each selected file is saved as a "case" item with metadata from the docket + document row
	  - The PDF is attached via the ViewFile endpoint
*/

function detectWeb(doc, url) {
	if (url.indexOf("DocketDetails") !== -1 && getDocketId(url)) {
		return "multiple";
	}
	return false;
}

// -- Helpers ------------------------------------------------------------------

function getDocketId(url) {
	var m = url.match(/[?&]docketId=(\d+)/);
	return m ? m[1] : null;
}

/** Parse a .NET JSON Date string like "/Date(1730264400000)/" into "YYYY-MM-DD" */
function parseDotNetDate(val) {
	if (!val) return "";
	var m = val.match(/\/Date\((-?\d+)\)\//);
	if (!m) return "";
	var d = new Date(parseInt(m[1], 10));
	var yyyy = d.getFullYear();
	var mm   = (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
	var dd   = (d.getDate() < 10 ? "0" : "") + d.getDate();
	return yyyy + "-" + mm + "-" + dd;
}

/** URL-safe base64 -> standard base64 -> percent-encode for use in ViewFile URLs */
function fileIdToParam(fileId) {
	// fileId arrives from JSON already as a plain string (e.g. "4y5xTw/15do=")
	// The ViewFile endpoint expects it percent-encoded.
	return encodeURIComponent(fileId);
}

/** Build the full ViewFile URL for a given fileId string */
function viewFileUrl(fileId) {
	return "https://lpscpubvalence.lpsc.louisiana.gov/portal/PSC/ViewFile?fileId="
		+ fileIdToParam(fileId);
}

/** Scrape docket-level metadata from the current page DOM */
function getDocketMeta(doc) {
	var meta = {
		docketNumber:  "",
		dateOpened:    "",
		datePublished: "",
		status:        "",
		description:   "",
		synopsis:      ""
	};

	// The docket detail page renders labelled pairs inside .detail-* or plain text.
	// We use a robust text-search approach across all visible text nodes.
	var bodyText = doc.body ? doc.body.innerText || doc.body.textContent : "";

	function extractAfterLabel(label) {
		// Looks for "Label\nValue" patterns in the rendered text
		var re = new RegExp(label + "\\s*\\n([^\\n]+)");
		var m = bodyText.match(re);
		return m ? m[1].trim() : "";
	}

	meta.docketNumber  = extractAfterLabel("Docket Number");
	meta.dateOpened    = extractAfterLabel("Date Opened");
	meta.datePublished = extractAfterLabel("Date Published");
	meta.status        = extractAfterLabel("Status");
	meta.description   = extractAfterLabel("Description");
	meta.synopsis      = extractAfterLabel("Synopsis");

	// Fallback: try querying labelled elements directly
	// The page uses definition-list-style layout in some themes
	if (!meta.docketNumber) {
		var allText = doc.querySelectorAll("*");
		for (var i = 0; i < allText.length; i++) {
			var el = allText[i];
			if (el.children.length === 0) { // leaf node
				var t = (el.textContent || "").trim();
				if (t === "Docket Number" && el.nextElementSibling) {
					meta.docketNumber = el.nextElementSibling.textContent.trim();
				}
				if (t === "Description" && el.nextElementSibling) {
					meta.description = el.nextElementSibling.textContent.trim();
				}
				if (t === "Synopsis" && el.nextElementSibling) {
					meta.synopsis = el.nextElementSibling.textContent.trim();
				}
				if (t === "Date Opened" && el.nextElementSibling) {
					meta.dateOpened = el.nextElementSibling.textContent.trim();
				}
				if (t === "Date Published" && el.nextElementSibling) {
					meta.datePublished = el.nextElementSibling.textContent.trim();
				}
				if (t === "Status" && el.nextElementSibling) {
					meta.status = el.nextElementSibling.textContent.trim();
				}
			}
		}
	}

	return meta;
}

/**
 * Fetch one page of documents from the Docket_Documents endpoint.
 * Returns a promise-like via ZU.doPost / the translator's XHR interface.
 */
function fetchDocumentPage(docketId, page, pageSize, callback) {
	var body = "sort=&page=" + page + "&pageSize=" + pageSize
		+ "&group=&filter=&docketId=" + docketId;

	ZU.doPost(
		"https://lpscpubvalence.lpsc.louisiana.gov/portal/PSC/Docket_Documents",
		body,
		function(responseText) {
			try {
				callback(null, JSON.parse(responseText));
			}
			catch (e) {
				callback(e, null);
			}
		},
		{ "Content-Type": "application/x-www-form-urlencoded" }
	);
}

/**
 * Recursively page through all documents, collecting them into `allDocs`.
 * Calls `done(allDocs)` when finished.
 */
function fetchAllDocuments(docketId, allDocs, page, total, done) {
	var PAGE_SIZE = 100; // fetch in large batches to minimise round-trips

	fetchDocumentPage(docketId, page, PAGE_SIZE, function(err, data) {
		if (err || !data || !data.Data) {
			done(allDocs); // return whatever we have on error
			return;
		}

		allDocs = allDocs.concat(data.Data);

		var fetchedSoFar = (page - 1) * PAGE_SIZE + data.Data.length;
		var knownTotal   = data.Total || total;

		if (fetchedSoFar < knownTotal) {
			fetchAllDocuments(docketId, allDocs, page + 1, knownTotal, done);
		}
		else {
			done(allDocs);
		}
	});
}

/**
 * Returns true for documents issued by the Commission itself -- Orders, Rulings,
 * Bulletins, scheduling Notices -- as opposed to filings submitted by parties.
 */
function isLPSCIssued(desc) {
	if (!desc) return false;
	var patterns = [
		/^Bulletin\s+#/i,
		/^Order\s+No\./i,
		/^(?:Procedural\s+|Interlocutory\s+|Final\s+|Commission\s+)?Order(\s+on\s+|\s*\b)/i,
		/^(?:ALJ\s+)?Ruling\s+on\s+/i,
		/^Notice\s+of\s+(?:Hearing|Prehearing|Scheduling|Continuance|Cancellation)/i,
	];
	for (var i = 0; i < patterns.length; i++) {
		if (patterns[i].test(desc)) return true;
	}
	return false;
}


/**
 * Returns an org name string, or "" if no author can be identified.
 */
function extractAuthor(desc) {
	if (!desc) return "";

	var prefixes = [
		// Intervention / participation filings
		/^(?:Fax-filed\s+)?Notice of Intervention and (?:Request for )?Inclusion on Service List for\s+/i,
		/^(?:Fax-filed\s+)?Notice of Intent to Participate as an Interested Party and Inclusion on Service List for\s+/i,
		/^(?:Fax-filed\s+)?Petition (?:of|for) Intervention and Request for Inclusion on Service List for\s+/i,
		/^(?:Fax-filed\s+)?Petition (?:of|for) Intervention for\s+/i,
		/^(?:Fax-filed\s+)?Request to Participate as (?:an\s+)?Interested Party (?:and Inclusion on Service List\s+)?for\s+/i,
		// Testimony
		/^(?:Pre-filed\s+|Fax-filed\s+|Supplemental\s+)?(?:Direct\s+|Rebuttal\s+|Surrebuttal\s+)?Testimony of .+?\s+(?:on Behalf of|for)\s+/i,
		// Briefs, comments, objections, responses -- 'of [the] X'
		/^(?:Initial\s+|Reply\s+|Post-Hearing\s+)?Brief of\s+(?:the\s+)?/i,
		/^(?:Initial\s+|Reply\s+)?Comments of\s+(?:the\s+)?/i,
		/^(?:Reply\s+)?(?:Response|Objection|Answer) of\s+(?:the\s+)?/i,
		// Motions -- 'filed by X' or 'Motion of/by X'
		/^(?:Fax-filed\s+)?Motion\s+.+?\s+filed by\s+/i,
		/^(?:Fax-filed\s+)?Motion\s+(?:of|by)\s+(?:the\s+)?/i,
	];

	for (var i = 0; i < prefixes.length; i++) {
		var m = desc.match(prefixes[i]);
		if (m) {
			var remainder = desc.slice(m[0].length)
				.replace(/\s*\([^)]*\)\s*$/, "")
				.replace(/\s+(?:to|in|regarding|re:)\s+.+$/i, "")
				.replace(/[.,;]+$/, "")
				.trim();
			return remainder;
		}
	}

	// Catch-all: scan for the first ' for [Party]' where the party starts with a
	// capital letter and contains a recognised org-name suffix. Taking the *first*
	// valid hit (not the last) correctly handles names like "Alliance for Affordable
	// Energy" where 'for' appears inside the org name.
	var ORG_SUFFIX = /\b(?:LLC|Inc\.?|Corp\.?|Corporation|Association|Cooperative|Company|Commission|Staff|Club|Council|Group|Coalition|Scientists|Energy|Electric|Power|Authority|Foundation)\b/i;
	var GENERIC_START = /^(?:Approval|Review|Production|Comment|Filing|Hearing|Inclusion|Intervention|Participation|the\s|A\s|An\s)/i;
	var forRe = /\s+for\s+/gi;
	var forMatch;
	while ((forMatch = forRe.exec(desc)) !== null) {
		var candidate = desc.slice(forMatch.index + forMatch[0].length)
			.replace(/\s*\([^)]*\)\s*$/, "")
			.replace(/[.,;]+$/, "")
			.trim();
		if (/^[A-Z]/.test(candidate) && !GENERIC_START.test(candidate) && ORG_SUFFIX.test(candidate)) {
			return candidate;
		}
	}

	return "";
}

// -- Main entry points ---------------------------------------------------------

function doWeb(doc, url) {
	var docketId = getDocketId(url);
	if (!docketId) return;

	var docketMeta = getDocketMeta(doc);

	fetchAllDocuments(docketId, [], 1, 0, function(allDocs) {
		// Build the items object for Zotero.selectItems()
		// Key: a unique string encoding docId + fileIndex
		// Value: human-readable label shown in the picker
		var items = {};

		for (var i = 0; i < allDocs.length; i++) {
			var docRow = allDocs[i];
			var dateFiled = parseDotNetDate(docRow.DateFiled);
			var files = docRow.Files || [];

			for (var j = 0; j < files.length; j++) {
				var file = files[j];
				// Concatenate document description + filename as the picker label
				var label = docRow.Description
					? docRow.Description + " -- " + file.FileName
					: file.FileName;

				// Encode all needed info into the key so we can reconstruct on select
				var key = JSON.stringify({
					docId:       docRow.DocumentId,
					docType:     docRow.DocumentType || "",
					dateFiled:   dateFiled,
					filedBy:     docRow.FiledBy || "",
					description: docRow.Description || "",
					fileId:      file.FileId,
					fileName:    file.FileName
				});

				items[key] = "[" + dateFiled + "] " + label;
			}
		}

		Zotero.selectItems(items, function(selectedItems) {
			if (!selectedItems) return;

			for (var key in selectedItems) {
				var info = JSON.parse(key);
				scrapeFile(info, docketMeta, docketId);
			}
		});
	});
}

/**
 * Create a single Zotero "case" item for one file.
 */
function scrapeFile(info, docketMeta, docketId) {
	var item = new Zotero.Item("case");

	// -- Title --------------------------------------------------------------
	// Use description alone if the filename (sans .pdf) is identical to it;
	// otherwise concatenate "Description -- FileName" for extra specificity.
	var baseName = info.fileName.replace(/\.pdf$/i, "");
	var descNorm = (info.description || "").trim();
	item.title = (descNorm && descNorm !== baseName)
		? descNorm + " -- " + baseName
		: (descNorm || baseName);

	// -- Author -------------------------------------------------------------
	// Prefer the FiledBy field if populated; otherwise parse from description.
	var authorName = info.filedBy
		|| (isLPSCIssued(info.description) ? "Louisiana Public Service Commission" : null)
		|| extractAuthor(info.description);
	if (authorName) {
		item.creators.push({ lastName: authorName, creatorType: "author", fieldMode: 1 });
	}

	// -- Case / docket identifiers ------------------------------------------
	item.docketNumber = docketMeta.docketNumber || ("Docket " + docketId);
	item.court        = "Louisiana Public Service Commission";

	// Use the document's filed date as the date; fall back to docket open date
	item.dateDecided  = info.dateFiled || docketMeta.dateOpened || "";

	// -- Extra fields packed into "Extra" -----------------------------------
	var extras = [];
	if (docketMeta.synopsis)       extras.push("Synopsis: "            + docketMeta.synopsis);
	if (docketMeta.status)         extras.push("Docket Status: "       + docketMeta.status);
	if (docketMeta.datePublished)  extras.push("Date Published: "      + docketMeta.datePublished);
	if (info.docType)              extras.push("Document Type: "       + info.docType);
	if (info.filedBy)              extras.push("Filed By: "            + info.filedBy);
	if (docketMeta.description)    extras.push("Docket Description: "  + docketMeta.description);
	item.extra = extras.join("\n");

	// -- URL -- direct link to the PDF --------------------------------------
	item.url = viewFileUrl(info.fileId);

	// -- Attach the PDF -----------------------------------------------------
	item.attachments.push({
		title:    info.fileName,
		url:      viewFileUrl(info.fileId),
		mimeType: "application/pdf"
	});

	item.complete();
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://lpscpubvalence.lpsc.louisiana.gov/portal/PSC/DocketDetails?docketId=32146",
		"items": "multiple"
	}
]
/** END TEST CASES **/
