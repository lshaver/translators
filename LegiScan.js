{
	"translatorID": "e8c5a7b2-4f1d-4a3e-9c6d-1b2e8f3a5d7c",
	"label": "LegiScan",
	"creator": "",
	"target": "^https?://legiscan\\.com/[A-Z]{2}/(?:bill|text)/",
	"minVersion": "3.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-05-15 21:30:04"
}

/*
	LegiScan Zotero Translator
	Fires on:
	  - Bill detail pages:  legiscan.com/{STATE}/bill/{BILLNUMBER}/{YEAR}
	  - Bill text pages:    legiscan.com/{STATE}/text/{BILLNUMBER}/id/{ID}

	Strategy:
	  - On a text page: scrape metadata from the linked "[BillNumber] Detail" page,
		then attach the most recent PDF.
	  - On a bill detail page: scrape metadata directly, navigate to the most
		recent text version page, and attach the PDF from there.
*/

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a LegiScan URL and return { state, billNumber, year } or null.
 * Handles both /bill/ and /text/ URLs.
 */
function parseUrl(url) {
	// Bill detail:  /ND/bill/HB1579/2025
	var billMatch = url.match(/legiscan\.com\/([A-Z]{2})\/bill\/([^/]+)\/(\d{4})/);
	if (billMatch) {
		return { state: billMatch[1], billNumber: billMatch[2], year: billMatch[3] };
	}
	// Text page:    /ND/text/HB1579/id/12345  or  /ND/text/HB1579/2025
	var textMatch = url.match(/legiscan\.com\/([A-Z]{2})\/text\/([^/]+)/);
	if (textMatch) {
		// year may not be in URL; will be pulled from page content
		return { state: textMatch[1], billNumber: textMatch[2], year: null };
	}
	return null;
}

/** Build the canonical bill detail URL from parts. */
function billDetailUrl(state, billNumber, year) {
	return 'https://legiscan.com/' + state + '/bill/' + billNumber + '/' + year;
}

// ── detectWeb ─────────────────────────────────────────────────────────────────

function detectWeb(doc, url) {
	if (url.match(/legiscan\.com\/[A-Z]{2}\/(?:bill|text)\//)) {
		return 'bill';
	}
	return false;
}

// ── doWeb ─────────────────────────────────────────────────────────────────────

async function doWeb(doc, url) {
	if (url.match(/legiscan\.com\/[A-Z]{2}\/text\//)) {
		// On a text page — find the "[Bill] Detail" link to get the detail page URL
		await scrapeFromTextPage(doc, url);
	} else {
		// On a bill detail page
		await scrapeFromDetailPage(doc, url);
	}
}

// ── Scraping: text page entry point ──────────────────────────────────────────

async function scrapeFromTextPage(doc, url) {
	// The text page contains a "[HB1579 Detail]" link back to the bill page.
	// Example: <a href="/ND/bill/HB1579/2025">[HB1579 Detail]</a>
	var detailLink = doc.querySelector('a[href*="/bill/"]');
	if (detailLink) {
		var detailUrl = detailLink.href;
		var detailDoc = await requestDocument(detailUrl);
		await scrapeFromDetailPage(detailDoc, detailUrl, doc);
	} else {
		// Fallback: try to scrape what we can from the text page itself
		await scrapeFromDetailPage(doc, url, doc);
	}
}

// ── Scraping: bill detail page ────────────────────────────────────────────────

/**
 * Main scraping function.
 * @param {Document} doc       - The bill detail page document.
 * @param {string}   url       - The bill detail page URL.
 * @param {Document} [textDoc] - If we arrived from a text page, pass it here
 *                               to avoid a redundant fetch.
 */
async function scrapeFromDetailPage(doc, url, textDoc) {
	var parsed = parseUrl(url);
	if (!parsed) return;

	var item = new Zotero.Item('bill');

	// ── Title ──────────────────────────────────────────────────────────────
	// LegiScan renders the bill title in <div id="bill-title">, preceded by
	// <h2 class="title" id="header-title">Title</h2>.
	// Fall back to the <title> tag minus the site suffix.
	var billTitleDiv = doc.querySelector('#bill-title');
	var rawTitle = billTitleDiv
		? ZU.trimInternal(billTitleDiv.textContent)
		: doc.title.replace(/\s*[\|–—].*$/, '').trim();
	item.title = toSentenceCase(rawTitle);

	// ── Bill Number ────────────────────────────────────────────────────────
	item.billNumber = parsed.billNumber;

	// ── Session / Year ─────────────────────────────────────────────────────
	// Look for a "Session" label in the bill info table.
	var sessionEl = getFieldByLabel(doc, 'Session');
	item.session = sessionEl
		? ZU.trimInternal(sessionEl)
		: (parsed.year || '');

	// ── Legislative Body ────────────────────────────────────────────────────
	// Compose from state + chamber implied by bill prefix.
	// e.g. "HB" → House, "SB" → Senate, "HCR" → House, "SCR" → Senate, etc.
	var chamber = chamberFromBillNumber(parsed.billNumber);
	var stateLabel = stateFullName(parsed.state);
	item.legislativeBody = stateLabel
		? stateLabel + (chamber ? ' ' + chamber : '')
		: parsed.state + (chamber ? ' ' + chamber : '');

	// ── Sponsors ────────────────────────────────────────────────────────────
	// LegiScan detail pages list sponsors in a "Sponsors" section.
	// Try common selectors; sponsors are typically in a <td> or <div> following
	// a "Sponsors" or "Primary Sponsor" label.
	addSponsors(doc, item);

	// ── Status / History ────────────────────────────────────────────────────
	var statusEl = getFieldByLabel(doc, 'Status');
	if (statusEl) {
		item.history = ZU.trimInternal(statusEl);
	}

	// ── URL ─────────────────────────────────────────────────────────────────
	item.url = url;

	// ── Date ────────────────────────────────────────────────────────────────
	// The last action date is in <div id="bill-last-action">, in a line like:
	//   "Action: 2025-06-27 - In committee upon adjournment."
	var lastActionDiv = doc.querySelector('#bill-last-action');
	if (lastActionDiv) {
		var lastActionText = lastActionDiv.textContent;
		var isoMatch = lastActionText.match(/Action:\s*(\d{4}-\d{2}-\d{2})/);
		if (isoMatch) item.date = isoMatch[1];
	}

	// ── PDF Attachment ───────────────────────────────────────────────────────
	// Find the most recent bill text PDF.
	// On the detail page, text versions are linked as rows in a "Bill Text" table.
	// Each row links to a text page at /STATE/text/BILL/id/NNNN.
	// We pick the first (most recent) one and fetch its PDF link.
	var pdfUrl = await findMostRecentPdf(doc, parsed, textDoc);
	if (pdfUrl) {
		item.attachments.push({
			url: pdfUrl,
			title: parsed.billNumber + ' Bill Text (PDF)',
			mimeType: 'application/pdf'
		});
	}

	item.complete();
}

// ── Finding the most recent PDF ───────────────────────────────────────────────

async function findMostRecentPdf(detailDoc, parsed, existingTextDoc) {
	// Strategy 1: already on / given the text page — look for the Download link.
	if (existingTextDoc) {
		var pdf = extractPdfFromTextPage(existingTextDoc);
		if (pdf) return pdf;
	}

	// Strategy 1b: the detail page's #bill-last-action div contains a
	// "Latest bill text (Introduced) [PDF]" link pointing to the text page.
	// Follow that link to get the PDF — this avoids scanning the whole page.
	var lastActionDiv = detailDoc.querySelector('#bill-last-action');
	if (lastActionDiv) {
		var textLink = lastActionDiv.querySelector('a[href*="/text/"]');
		if (textLink) {
			try {
				var latestTextDoc = await requestDocument(textLink.href);
				var pdf = extractPdfFromTextPage(latestTextDoc);
				if (pdf) return pdf;
			} catch (e) {
				Zotero.debug('LegiScan: failed to fetch text page from last-action div: ' + e);
			}
		}
	}

	// Strategy 2: scan all /text/ links on the detail page as a fallback.
	// LegiScan lists versions in a table; links look like /ND/text/HB1579/id/12345
	var textLinks = detailDoc.querySelectorAll('a[href*="/text/"]');
	// Filter to same bill, pick first (most recent — LegiScan lists newest first)
	var billPattern = new RegExp('/' + parsed.state + '/text/' + parsed.billNumber + '/', 'i');
	for (var i = 0; i < textLinks.length; i++) {
		var href = textLinks[i].href;
		if (billPattern.test(href)) {
			// Fetch that text page and extract its PDF
			try {
				var textDoc = await requestDocument(href);
				var pdf = extractPdfFromTextPage(textDoc);
				if (pdf) return pdf;
			} catch (e) {
				Zotero.debug('LegiScan: failed to fetch text page ' + href + ': ' + e);
			}
			break; // only try the first (most recent) link
		}
	}

	return null;
}

/**
 * Given a LegiScan text page document, return the absolute URL of the PDF,
 * or null if not found.
 *
 * The download link is rendered as:
 *   <a href="/Storage/2025/nd/pdf/HB1579/...pdf">Download: ND-2025-HB1579-Introduced.pdf</a>
 * or directly visible as:
 *   Download: <a href="...">ND-2025-HB1579-Introduced.pdf</a>
 */
function extractPdfFromTextPage(doc) {
	// Look for any anchor whose href ends in .pdf
	var links = doc.querySelectorAll('a[href$=".pdf"]');
	if (links.length > 0) {
		return links[0].href; // absolute URL in the DOM
	}

	// Fallback: look for text "Download:" and grab the adjacent link
	var allLinks = doc.querySelectorAll('a');
	for (var i = 0; i < allLinks.length; i++) {
		var text = ZU.trimInternal(allLinks[i].textContent);
		if (/^Download:/i.test(text) || /\.pdf$/.test(text)) {
			return allLinks[i].href;
		}
	}

	return null;
}

// ── Sponsor extraction ────────────────────────────────────────────────────────

function addSponsors(doc, item) {
	// LegiScan sponsor links point to /STATE/people/name/id/NNNNN.
	// Each anchor's text is e.g. "Rep. Anna Novak" or "Sen. Greg Kessel",
	// followed by a non-breaking space and "[R]" or "[D]" as a text node.
	// We grab all such links, clean the name, and treat them all as 'sponsor'
	// (LegiScan doesn't distinguish primary vs co-sponsor in the HTML structure).
	var links = doc.querySelectorAll('a[href*="/people/"]');
	var seen = {};
	for (var i = 0; i < links.length; i++) {
		var raw = ZU.trimInternal(links[i].textContent);
		var name = cleanSponsorName(raw);
		if (!name || seen[name]) continue;
		seen[name] = true;
		item.creators.push(ZU.cleanAuthor(name, 'sponsor', false));
	}
}

/**
 * Strip legislative title prefixes (Rep., Sen., etc.) and trailing
 * party/annotation suffixes ([R], [D], [I], [Primary], etc.).
 */
function cleanSponsorName(name) {
	return name
		.replace(/\[.*?\]/g, '')           // remove [R], [D], [Primary], etc.
		.replace(/^\s*(Rep|Sen|Senator|Representative|Delegate|Assemblyman|Assemblywoman|Del|Dr|Mr|Ms|Mrs)\.?\s+/i, '')
		.trim();
}

// ── Utility: get value from a label-value table row ──────────────────────────

/**
 * Searches the document for a <th> or label-ish element containing `label`,
 * then returns the text of the adjacent value cell/element.
 */
function getFieldByLabel(doc, label) {
	var rows = doc.querySelectorAll('tr');
	for (var i = 0; i < rows.length; i++) {
		var th = rows[i].querySelector('th');
		if (th && th.textContent.trim().toLowerCase().indexOf(label.toLowerCase()) !== -1) {
			var td = rows[i].querySelector('td');
			if (td) return ZU.trimInternal(td.textContent);
		}
	}

	// Also try definition-list style: <dt>Label</dt><dd>Value</dd>
	var dts = doc.querySelectorAll('dt');
	for (var j = 0; j < dts.length; j++) {
		if (dts[j].textContent.trim().toLowerCase().indexOf(label.toLowerCase()) !== -1) {
			var dd = dts[j].nextElementSibling;
			if (dd && dd.tagName === 'DD') return ZU.trimInternal(dd.textContent);
		}
	}

	return null;
}

// ── Utility: sentence case conversion ───────────────────────────────────────

/**
 * Convert a string to sentence case and strip trailing punctuation.
 * Handles all-caps inputs like "AN ACT TO PROVIDE FOR..." as well as
 * already-mixed-case titles. Preserves acronyms would be lost here, but
 * bill titles don't typically contain them mid-sentence.
 *
 * Steps:
 *   1. Lowercase everything.
 *   2. Uppercase the first character.
 *   3. Strip trailing punctuation (period, comma, semicolon, colon).
 */
function toSentenceCase(str) {
	if (!str) return str;
	var lower = str.toLowerCase();
	var sentenced = lower.charAt(0).toUpperCase() + lower.slice(1);
	// Remove trailing punctuation characters
	return sentenced.replace(/[.,;:]+$/, '');
}

// ── Utility: chamber from bill number prefix ──────────────────────────────────

function chamberFromBillNumber(billNumber) {
	var prefix = billNumber.match(/^([A-Z]+)/);
	if (!prefix) return '';
	var p = prefix[1].toUpperCase();
	if (/^H/.test(p)) return 'House';
	if (/^S/.test(p)) return 'Senate';
	if (/^A/.test(p)) return 'Assembly';  // some states (CA, NY, NJ…)
	if (/^HB|HF|HR/.test(p)) return 'House';
	if (/^SB|SF|SR/.test(p)) return 'Senate';
	return '';
}

// ── Utility: state abbreviation → full name ───────────────────────────────────

function stateFullName(abbr) {
	var states = {
		AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
		CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
		FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
		IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
		KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
		MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
		MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
		NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
		NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
		OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
		SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
		VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
		WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
		US: 'United States Congress'
	};
	return states[abbr] || abbr;
}

/** @preserve ZoteroTranslator */

/** BEGIN TEST CASES **/
var testCases = [
]
/** END TEST CASES **/
