import test from "node:test";
import assert from "node:assert/strict";
import { recognizeCustomer, ticketIdsFromSubject } from "../../taskpane/js/services/customer-recognition.js";

const company = { id: 3, name: "Muster", email: "info@muster.example", website: "https://www.muster.example" };
const other = { id: 4, name: "Andere", email: "info@andere.example" };
const sender = "anna@muster.example";
const contact = { id: 7, email: sender, companyIds: [3] };

function repository({ companies = [], contacts = [], linked = [company], tickets = [],
  truncated = false, contactsTruncated = false } = {}) {
  const calls = [];
  return {
    calls,
    async searchCompanies(query) {
      calls.push(query);
      const verified = [company, other].filter((item) => item.name === query);
      return { items: verified.length ? verified : companies, tooMany: truncated };
    },
    async searchEmployees() { return { items: contacts, companies: linked, tooMany: contactsTruncated }; },
    async ticketsById(ids) { return tickets.filter((ticket) => ids.includes(ticket.id)); },
  };
}

test("known contact determines the customer even without a company-address search hit", async () => {
  const result = await recognizeCustomer(repository({ contacts: [contact] }), { senderAddress: sender });
  assert.equal(result.company.id, 3);
  assert.equal(result.confidence, "contact");
  assert.equal(result.remitter.id, 7);
});

test("company email match ignores case and surrounding whitespace", async () => {
  const result = await recognizeCustomer(repository({ companies: [company] }),
    { senderAddress: " INFO@MUSTER.EXAMPLE " });
  assert.equal(result.company.id, 3);
  assert.equal(result.confidence, "address");
});

test("a fuzzy search hit alone is not proof of a customer match", async () => {
  const result = await recognizeCustomer(repository({ companies: [other] }), { senderAddress: sender });
  assert.equal(result.company, null);
});

test("a matching company email domain selects a customer", async () => {
  const result = await recognizeCustomer(repository({ companies: [company] }), { senderAddress: sender });
  assert.equal(result.company.id, 3);
  assert.equal(result.confidence, "domain");
});

test("a matching website domain selects a customer", async () => {
  const result = await recognizeCustomer(repository({ companies: [{ ...company, email: "", website: "www.muster.example" }] }),
    { senderAddress: sender });
  assert.equal(result.confidence, "domain");
});

test("lookalike and nested website domains do not match", async () => {
  for (const website of ["https://muster.example.evil.test", "https://notmuster.example", "https://evil.test/muster.example"]) {
    const result = await recognizeCustomer(repository({ companies: [{ ...company, email: "", website }] }),
      { senderAddress: sender });
    assert.equal(result.company, null, website);
  }
});

test("public mail domains never determine a customer", async () => {
  const repo = repository({ companies: [{ ...company, email: "someone@gmail.com", website: "https://gmail.com" }] });
  const result = await recognizeCustomer(repo, { senderAddress: "unknown@gmail.com" });
  assert.equal(result.company, null);
  assert.equal(result.reason, "publicDomain");
  assert.equal(repo.calls.includes("gmail.com"), false);
});

test("an exact personal address at a public provider remains usable", async () => {
  const result = await recognizeCustomer(repository({ contacts: [{ ...contact, email: "anna@gmail.com" }] }),
    { senderAddress: "anna@gmail.com" });
  assert.equal(result.company.id, 3);
});

test("shared domains require a customer choice", async () => {
  const result = await recognizeCustomer(repository({ companies: [company, { ...other, email: "info@muster.example" }] }),
    { senderAddress: sender });
  assert.equal(result.company, null);
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("a contact assigned to multiple companies requires a choice", async () => {
  const result = await recognizeCustomer(repository({ contacts: [{ ...contact, companyIds: [3, 4] }], linked: [company, other] }),
    { senderAddress: sender });
  assert.equal(result.company, null);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.remitter, null);
});

test("duplicate people do not automatically select one contact", async () => {
  const result = await recognizeCustomer(repository({ contacts: [contact, { ...contact, id: 8 }] }), { senderAddress: sender });
  assert.equal(result.company.id, 3);
  assert.equal(result.remitter, null);
});

test("incomplete search results never establish uniqueness", async () => {
  for (const options of [{ truncated: true }, { contactsTruncated: true }]) {
    const result = await recognizeCustomer(repository({ companies: [company], contacts: [contact], ...options }),
      { senderAddress: sender });
    assert.equal(result.company, null);
  }
});

test("unknown contact company assignments are not guessed from a fuzzy hit", async () => {
  const result = await recognizeCustomer(repository({ companies: [company], contacts: [{ ...contact, companyIds: [] }] }),
    { senderAddress: sender });
  assert.equal(result.company, null);
});

test("inactive contacts are ignored", async () => {
  const result = await recognizeCustomer(repository({ contacts: [{ ...contact, inactive: true }] }), { senderAddress: sender });
  assert.equal(result.company, null);
  assert.equal(result.remitter, null);
});

test("subject markers are recognized but plain order numbers are ignored", () => {
  assert.deepEqual(ticketIdsFromSubject("AW: [hecom-Ticket #34224] Antwort"), [34224]);
  assert.deepEqual(ticketIdsFromSubject("[TANSS-Ticket #4] [Ticket #4]"), [4]);
  assert.deepEqual(ticketIdsFromSubject("Rechnung 34224 / Kundennummer #42"), []);
});

test("a readable ticket in the subject offers attachment and its verified customer", async () => {
  const result = await recognizeCustomer(repository({ tickets: [{ id: 42, companyId: 3, companyName: "Muster" }] }),
    { subject: "AW: [hecom-Ticket #42]", senderAddress: "" });
  assert.equal(result.company.id, 3);
  assert.equal(result.confidence, "ticket");
  assert.equal(result.referencedTickets[0].id, 42);
});

test("a ticket that conflicts with the sender requires manual customer selection", async () => {
  const result = await recognizeCustomer(repository({ contacts: [contact],
    tickets: [{ id: 42, companyId: 4, companyName: "Andere" }] }),
    { senderAddress: sender, subject: "[hecom-Ticket #42]" });
  assert.equal(result.company, null);
  assert.equal(result.reason, "conflict");
  assert.equal(result.candidates.length, 2);
});

test("unreadable tickets and multiple subject markers never invent a customer", async () => {
  const repo = repository({ tickets: [{ id: 42, companyId: 3, companyName: "Muster" }] });
  for (const subject of ["[Ticket #99]", "[Ticket #42] [Ticket #99]"]) {
    const result = await recognizeCustomer(repo, { subject });
    assert.equal(result.company, null);
  }
});

test("cancelled lookups do not become recognition results", async () => {
  const repo = repository();
  repo.searchEmployees = async () => { throw new DOMException("cancelled", "AbortError"); };
  await assert.rejects(() => recognizeCustomer(repo, { senderAddress: sender }), { name: "AbortError" });
});

test("a locked company referenced by a contact is not selected", async () => {
  const repo = repository({ contacts: [contact] });
  repo.searchCompanies = async () => ({ items: [{ ...company, lockout: true }], tooMany: false });
  const result = await recognizeCustomer(repo, { senderAddress: sender });
  assert.equal(result.company, null);
  assert.equal(result.candidates.length, 0);
});

test("a failed employee lookup cannot silently establish a unique match", async () => {
  const repo = repository({ companies: [company] });
  repo.searchEmployees = async () => { throw new Error("unavailable"); };
  const result = await recognizeCustomer(repo, { senderAddress: "info@muster.example" });
  assert.equal(result.company, null);
});
