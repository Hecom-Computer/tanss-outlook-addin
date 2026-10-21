/** Read-only customer recognition. A subject or address is evidence, never authority. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch",
  "web.de", "t-online.de", "freenet.de", "outlook.com", "outlook.de",
  "hotmail.com", "hotmail.de", "live.com", "live.de", "icloud.com", "me.com",
  "yahoo.com", "yahoo.de", "aol.com", "posteo.de", "mailbox.org", "protonmail.com",
  "proton.me", "pm.me", "yahoo.co.uk", "yahoo.fr", "aol.de", "msn.com", "live.at",
  "outlook.at", "gmx.com", "mail.de", "email.de", "arcor.de", "online.de", "o2online.de",
]);

export function normalizeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : "";
}

function domainOf(address) {
  return normalizeAddress(address).split("@")[1] || "";
}

/** Accept only explicit ticket markers; order numbers and naked digits are not tickets. */
export function ticketIdsFromSubject(subject) {
  const matches = String(subject || "").slice(0, 2000)
    .matchAll(/\[(?:hecom[ -]|tanss[ -])?ticket\s*#\s*(\d{1,10})\]/gi);
  return [...new Set([...matches].map((match) => Number(match[1])))].filter((id) => id > 0);
}

function uniqueCompanies(items) {
  return [...new Map(items.filter((item) => item && item.id && !item.inactive && !item.lockout)
    .map((item) => [Number(item.id), item])).values()];
}

function domainMatches(company, domain) {
  if (domainOf(company.email) === domain) return true;
  try {
    const website = String(company.website || "").trim();
    if (!website) return false;
    const url = new URL(website.includes("://") ? website : `https://${website}`);
    return ["https:", "http:"].includes(url.protocol)
      && url.hostname.toLowerCase().replace(/^www\./, "") === domain;
  } catch {
    return false;
  }
}

async function optional(work, fallback) {
  try { return await work(); } catch (error) {
    if (error && error.name === "AbortError") throw error;
    return fallback;
  }
}

/** Resolve named linked entities through the company search, retaining lockout checks. */
async function verifiedCompanies(repo, references, known, signal) {
  const unique = uniqueCompanies(references);
  const rows = await Promise.all(unique.slice(0, 10).map(async (reference) => {
    const existing = known.find((company) => Number(company.id) === Number(reference.id));
    if (existing) return existing;
    const result = await optional(() => repo.searchCompanies(reference.name || String(reference.id),
      { limit: 25, signal }), { items: [] });
    return result.items.find((company) => Number(company.id) === Number(reference.id));
  }));
  return uniqueCompanies(rows);
}

export async function recognizeCustomer(repo, { senderAddress, subject }, { signal } = {}) {
  const address = normalizeAddress(senderAddress);
  const requestedTickets = ticketIdsFromSubject(subject);
  const empty = { items: [], tooMany: false, companies: [] };
  const [companies, contacts, tickets] = await Promise.all([
    address ? repo.searchCompanies(address, { limit: 25, signal }) : empty,
    address ? optional(() => repo.searchEmployees(address, { limit: 25, signal }),
      { ...empty, tooMany: true }) : empty,
    requestedTickets.length ? optional(() => repo.ticketsById(requestedTickets, { signal }), []) : [],
  ]);
  const exactContacts = contacts.items.filter((person) => !person.inactive
    && normalizeAddress(person.email) === address && address);
  const contactCompanyIds = [...new Set(exactContacts.flatMap((person) => person.companyIds || []))];
  const contactReferences = contactCompanyIds.map((id) => ({ id,
    name: (contacts.companies || []).find((company) => Number(company.id) === Number(id))?.name || "" }));
  const contactCompanies = await verifiedCompanies(repo, contactReferences, companies.items, signal);
  const direct = companies.items.filter((company) => address && normalizeAddress(company.email) === address);
  let candidates = uniqueCompanies([...contactCompanies, ...companies.items]);
  const contactComplete = !contacts.tooMany && exactContacts.every((person) => person.companyIds?.length)
    && contactCompanyIds.length === contactCompanies.length;
  const exact = uniqueCompanies([...contactCompanies, ...direct]);
  let company = null;
  let confidence = "none";
  let reason = "unknown";
  if (exact.length === 1 && !companies.tooMany && contactComplete) {
    company = exact[0];
    confidence = contactCompanies.length ? "contact" : "address";
  } else if (exact.length > 0 || !contactComplete || companies.tooMany) {
    reason = "ambiguous";
  } else {
    const domain = domainOf(address);
    if (domain && !PUBLIC_DOMAINS.has(domain)) {
      const found = await optional(() => repo.searchCompanies(domain, { limit: 25, signal }),
        { ...empty, tooMany: true });
      const matching = uniqueCompanies([...companies.items, ...found.items])
        .filter((candidate) => domainMatches(candidate, domain));
      candidates = uniqueCompanies([...candidates, ...matching]);
      if (matching.length === 1 && !found.tooMany) {
        company = matching[0];
        confidence = "domain";
      } else if (matching.length > 1 || found.tooMany) reason = "ambiguous";
    } else if (domain) reason = "publicDomain";
  }

  const referencedTickets = tickets.filter((ticket) => requestedTickets.includes(Number(ticket.id)));
  if (referencedTickets.length === 1 && requestedTickets.length === 1) {
    const ticket = referencedTickets[0];
    const verified = await verifiedCompanies(repo,
      [{ id: ticket.companyId, name: ticket.companyName }], candidates, signal);
    const ticketCompany = verified[0];
    if (ticketCompany) {
      candidates = uniqueCompanies([...candidates, ticketCompany]);
      if (company && Number(company.id) !== Number(ticketCompany.id)) {
        company = null;
        confidence = "none";
        reason = "conflict";
      } else if (!company && reason !== "ambiguous") {
        company = ticketCompany;
        confidence = "ticket";
      }
    }
  }

  const remitters = company ? exactContacts.filter((person) =>
    (person.companyIds || []).includes(Number(company.id))) : [];
  return {
    company, confidence, candidates, reason,
    remitter: remitters.length === 1 && !contacts.tooMany ? remitters[0] : null,
    remitterCandidates: contacts.tooMany ? [] : exactContacts,
    referencedTickets,
  };
}
