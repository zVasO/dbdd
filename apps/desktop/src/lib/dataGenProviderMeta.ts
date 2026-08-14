// Lightweight metadata for the provider picker UI. Deliberately faker-free so
// components that only need { id, label, category } (e.g. ProviderSelect) don't
// pull the faker bundle in — the `generate` closures live in dataGenProviders.ts,
// loaded lazily behind dataGenStore's loadProviders().
export interface GenProviderMeta {
  id: string;
  label: string;
  category: string;
}

export const providerMeta: GenProviderMeta[] = [
  // ── Person ──
  { id: 'person.firstName', label: 'First Name', category: 'Person' },
  { id: 'person.lastName', label: 'Last Name', category: 'Person' },
  { id: 'person.fullName', label: 'Full Name', category: 'Person' },
  { id: 'person.gender', label: 'Gender', category: 'Person' },
  { id: 'person.prefix', label: 'Prefix (Mr/Ms)', category: 'Person' },
  { id: 'person.jobTitle', label: 'Job Title', category: 'Person' },
  { id: 'person.bio', label: 'Bio', category: 'Person' },

  // ── Internet ──
  { id: 'internet.email', label: 'Email', category: 'Internet' },
  { id: 'internet.username', label: 'Username', category: 'Internet' },
  { id: 'internet.url', label: 'URL', category: 'Internet' },
  { id: 'internet.ip', label: 'IP Address', category: 'Internet' },
  { id: 'internet.ipv6', label: 'IPv6 Address', category: 'Internet' },
  { id: 'internet.mac', label: 'MAC Address', category: 'Internet' },
  { id: 'internet.userAgent', label: 'User Agent', category: 'Internet' },

  // ── Address ──
  { id: 'address.street', label: 'Street Address', category: 'Address' },
  { id: 'address.city', label: 'City', category: 'Address' },
  { id: 'address.state', label: 'State', category: 'Address' },
  { id: 'address.zip', label: 'Zip Code', category: 'Address' },
  { id: 'address.country', label: 'Country', category: 'Address' },
  { id: 'address.countryCode', label: 'Country Code', category: 'Address' },
  { id: 'address.latitude', label: 'Latitude', category: 'Address' },
  { id: 'address.longitude', label: 'Longitude', category: 'Address' },

  // ── Date ──
  { id: 'date.past', label: 'Past Date', category: 'Date' },
  { id: 'date.future', label: 'Future Date', category: 'Date' },
  { id: 'date.recent', label: 'Recent Date', category: 'Date' },
  { id: 'date.datetime', label: 'DateTime', category: 'Date' },
  { id: 'date.birthdate', label: 'Birthdate', category: 'Date' },

  // ── Number ──
  { id: 'number.int', label: 'Integer', category: 'Number' },
  { id: 'number.float', label: 'Float', category: 'Number' },
  { id: 'number.boolean', label: 'Boolean (0/1)', category: 'Number' },
  { id: 'number.percentage', label: 'Percentage (0-100)', category: 'Number' },

  // ── Text ──
  { id: 'text.uuid', label: 'UUID', category: 'Text' },
  { id: 'text.word', label: 'Word', category: 'Text' },
  { id: 'text.sentence', label: 'Sentence', category: 'Text' },
  { id: 'text.paragraph', label: 'Paragraph', category: 'Text' },
  { id: 'text.slug', label: 'Slug', category: 'Text' },
  { id: 'text.hexColor', label: 'Hex Color', category: 'Text' },

  // ── Commerce ──
  { id: 'commerce.productName', label: 'Product Name', category: 'Commerce' },
  { id: 'commerce.price', label: 'Price', category: 'Commerce' },
  { id: 'commerce.department', label: 'Department', category: 'Commerce' },
  { id: 'commerce.isbn', label: 'ISBN', category: 'Commerce' },

  // ── Company ──
  { id: 'company.name', label: 'Company Name', category: 'Company' },
  { id: 'company.catchPhrase', label: 'Catch Phrase', category: 'Company' },
  { id: 'company.buzzPhrase', label: 'Buzz Phrase', category: 'Company' },

  // ── Finance ──
  { id: 'finance.accountNumber', label: 'Account Number', category: 'Finance' },
  { id: 'finance.amount', label: 'Amount', category: 'Finance' },
  { id: 'finance.currency', label: 'Currency Code', category: 'Finance' },
  { id: 'finance.creditCard', label: 'Credit Card Number', category: 'Finance' },
  { id: 'finance.iban', label: 'IBAN', category: 'Finance' },
  { id: 'finance.bic', label: 'BIC/SWIFT', category: 'Finance' },

  // ── Phone ──
  { id: 'phone.number', label: 'Phone Number', category: 'Person' },
];

export function getProviderMetaByCategory(): Record<string, GenProviderMeta[]> {
  const grouped: Record<string, GenProviderMeta[]> = {};
  for (const p of providerMeta) {
    if (!grouped[p.category]) {
      grouped[p.category] = [];
    }
    grouped[p.category].push(p);
  }
  return grouped;
}
