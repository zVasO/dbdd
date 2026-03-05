import { faker } from '@faker-js/faker';

export interface GenProvider {
  id: string;
  label: string;
  category: string;
  generate: () => string | number | boolean;
}

export const providers: GenProvider[] = [
  // ── Person ──
  { id: 'person.firstName', label: 'First Name', category: 'Person', generate: () => faker.person.firstName() },
  { id: 'person.lastName', label: 'Last Name', category: 'Person', generate: () => faker.person.lastName() },
  { id: 'person.fullName', label: 'Full Name', category: 'Person', generate: () => faker.person.fullName() },
  { id: 'person.gender', label: 'Gender', category: 'Person', generate: () => faker.person.sex() },
  { id: 'person.prefix', label: 'Prefix (Mr/Ms)', category: 'Person', generate: () => faker.person.prefix() },
  { id: 'person.jobTitle', label: 'Job Title', category: 'Person', generate: () => faker.person.jobTitle() },
  { id: 'person.bio', label: 'Bio', category: 'Person', generate: () => faker.person.bio() },

  // ── Internet ──
  { id: 'internet.email', label: 'Email', category: 'Internet', generate: () => faker.internet.email() },
  { id: 'internet.username', label: 'Username', category: 'Internet', generate: () => faker.internet.username() },
  { id: 'internet.url', label: 'URL', category: 'Internet', generate: () => faker.internet.url() },
  { id: 'internet.ip', label: 'IP Address', category: 'Internet', generate: () => faker.internet.ip() },
  { id: 'internet.ipv6', label: 'IPv6 Address', category: 'Internet', generate: () => faker.internet.ipv6() },
  { id: 'internet.mac', label: 'MAC Address', category: 'Internet', generate: () => faker.internet.mac() },
  { id: 'internet.userAgent', label: 'User Agent', category: 'Internet', generate: () => faker.internet.userAgent() },

  // ── Address ──
  { id: 'address.street', label: 'Street Address', category: 'Address', generate: () => faker.location.streetAddress() },
  { id: 'address.city', label: 'City', category: 'Address', generate: () => faker.location.city() },
  { id: 'address.state', label: 'State', category: 'Address', generate: () => faker.location.state() },
  { id: 'address.zip', label: 'Zip Code', category: 'Address', generate: () => faker.location.zipCode() },
  { id: 'address.country', label: 'Country', category: 'Address', generate: () => faker.location.country() },
  { id: 'address.countryCode', label: 'Country Code', category: 'Address', generate: () => faker.location.countryCode() },
  { id: 'address.latitude', label: 'Latitude', category: 'Address', generate: () => parseFloat(faker.location.latitude().toString()) },
  { id: 'address.longitude', label: 'Longitude', category: 'Address', generate: () => parseFloat(faker.location.longitude().toString()) },

  // ── Date ──
  { id: 'date.past', label: 'Past Date', category: 'Date', generate: () => faker.date.past().toISOString().slice(0, 10) },
  { id: 'date.future', label: 'Future Date', category: 'Date', generate: () => faker.date.future().toISOString().slice(0, 10) },
  { id: 'date.recent', label: 'Recent Date', category: 'Date', generate: () => faker.date.recent().toISOString().slice(0, 10) },
  { id: 'date.datetime', label: 'DateTime', category: 'Date', generate: () => faker.date.past().toISOString().slice(0, 19).replace('T', ' ') },
  { id: 'date.birthdate', label: 'Birthdate', category: 'Date', generate: () => faker.date.birthdate().toISOString().slice(0, 10) },

  // ── Number ──
  { id: 'number.int', label: 'Integer', category: 'Number', generate: () => faker.number.int({ min: 0, max: 10000 }) },
  { id: 'number.float', label: 'Float', category: 'Number', generate: () => parseFloat(faker.number.float({ min: 0, max: 10000, fractionDigits: 2 }).toFixed(2)) },
  { id: 'number.boolean', label: 'Boolean (0/1)', category: 'Number', generate: () => faker.datatype.boolean() },
  { id: 'number.percentage', label: 'Percentage (0-100)', category: 'Number', generate: () => faker.number.int({ min: 0, max: 100 }) },

  // ── Text ──
  { id: 'text.uuid', label: 'UUID', category: 'Text', generate: () => crypto.randomUUID() },
  { id: 'text.word', label: 'Word', category: 'Text', generate: () => faker.lorem.word() },
  { id: 'text.sentence', label: 'Sentence', category: 'Text', generate: () => faker.lorem.sentence() },
  { id: 'text.paragraph', label: 'Paragraph', category: 'Text', generate: () => faker.lorem.paragraph() },
  { id: 'text.slug', label: 'Slug', category: 'Text', generate: () => faker.lorem.slug() },
  { id: 'text.hexColor', label: 'Hex Color', category: 'Text', generate: () => faker.color.rgb() },

  // ── Commerce ──
  { id: 'commerce.productName', label: 'Product Name', category: 'Commerce', generate: () => faker.commerce.productName() },
  { id: 'commerce.price', label: 'Price', category: 'Commerce', generate: () => parseFloat(faker.commerce.price()) },
  { id: 'commerce.department', label: 'Department', category: 'Commerce', generate: () => faker.commerce.department() },
  { id: 'commerce.isbn', label: 'ISBN', category: 'Commerce', generate: () => faker.commerce.isbn() },

  // ── Company ──
  { id: 'company.name', label: 'Company Name', category: 'Company', generate: () => faker.company.name() },
  { id: 'company.catchPhrase', label: 'Catch Phrase', category: 'Company', generate: () => faker.company.catchPhrase() },
  { id: 'company.buzzPhrase', label: 'Buzz Phrase', category: 'Company', generate: () => faker.company.buzzPhrase() },

  // ── Finance ──
  { id: 'finance.accountNumber', label: 'Account Number', category: 'Finance', generate: () => faker.finance.accountNumber() },
  { id: 'finance.amount', label: 'Amount', category: 'Finance', generate: () => parseFloat(faker.finance.amount()) },
  { id: 'finance.currency', label: 'Currency Code', category: 'Finance', generate: () => faker.finance.currencyCode() },
  { id: 'finance.creditCard', label: 'Credit Card Number', category: 'Finance', generate: () => faker.finance.creditCardNumber() },
  { id: 'finance.iban', label: 'IBAN', category: 'Finance', generate: () => faker.finance.iban() },
  { id: 'finance.bic', label: 'BIC/SWIFT', category: 'Finance', generate: () => faker.finance.bic() },

  // ── Phone ──
  { id: 'phone.number', label: 'Phone Number', category: 'Person', generate: () => faker.phone.number() },
];

const providerMap = new Map<string, GenProvider>();
for (const p of providers) {
  providerMap.set(p.id, p);
}

export function getProvider(id: string): GenProvider | undefined {
  return providerMap.get(id);
}

export function getProvidersByCategory(): Record<string, GenProvider[]> {
  const grouped: Record<string, GenProvider[]> = {};
  for (const p of providers) {
    if (!grouped[p.category]) {
      grouped[p.category] = [];
    }
    grouped[p.category].push(p);
  }
  return grouped;
}

const columnPatterns: [RegExp, string][] = [
  // Person
  [/\b(first_?name|fname|given_?name)\b/i, 'person.firstName'],
  [/\b(last_?name|lname|surname|family_?name)\b/i, 'person.lastName'],
  [/\b(full_?name|display_?name|user_?name_full)\b/i, 'person.fullName'],
  [/^name$/i, 'person.fullName'],
  [/\b(gender|sex)\b/i, 'person.gender'],
  [/\b(job_?title|position|occupation)\b/i, 'person.jobTitle'],
  [/\b(bio|about|description)\b/i, 'person.bio'],

  // Internet
  [/\b(email|e_?mail|mail)\b/i, 'internet.email'],
  [/\b(username|user_?name|login|handle)\b/i, 'internet.username'],
  [/\b(url|website|link|homepage|webpage)\b/i, 'internet.url'],
  [/\b(ip_?address|ip|ipv4)\b/i, 'internet.ip'],
  [/\b(user_?agent|ua)\b/i, 'internet.userAgent'],

  // Address
  [/\b(street|address|address_?line)\b/i, 'address.street'],
  [/\b(city|town)\b/i, 'address.city'],
  [/\b(state|province|region)\b/i, 'address.state'],
  [/\b(zip|zip_?code|postal_?code|postcode)\b/i, 'address.zip'],
  [/\b(country)\b/i, 'address.country'],
  [/\b(country_?code)\b/i, 'address.countryCode'],
  [/\b(latitude|lat)\b/i, 'address.latitude'],
  [/\b(longitude|lng|lon)\b/i, 'address.longitude'],

  // Date
  [/\b(created_?at|updated_?at|modified_?at|timestamp|datetime)\b/i, 'date.datetime'],
  [/\b(birth_?date|dob|date_?of_?birth|birthday)\b/i, 'date.birthdate'],
  [/\b(date|start_?date|end_?date|due_?date)\b/i, 'date.past'],

  // Number
  [/\b(age|quantity|count|amount|total|score|rating|rank|priority|level|order)\b/i, 'number.int'],
  [/\b(percentage|percent|pct)\b/i, 'number.percentage'],
  [/\b(is_?active|is_?enabled|is_?admin|is_?verified|active|enabled|verified|deleted)\b/i, 'number.boolean'],

  // Text
  [/\b(uuid|guid|id)\b/i, 'text.uuid'],
  [/\b(title|subject|headline)\b/i, 'text.sentence'],
  [/\b(body|content|text|message|note|comment|review)\b/i, 'text.paragraph'],
  [/\b(slug|permalink)\b/i, 'text.slug'],
  [/\b(color|colour)\b/i, 'text.hexColor'],

  // Commerce
  [/\b(product_?name|product|item_?name)\b/i, 'commerce.productName'],
  [/\b(price|cost|unit_?price|sale_?price)\b/i, 'commerce.price'],
  [/\b(department|category)\b/i, 'commerce.department'],

  // Company
  [/\b(company|company_?name|organization|org)\b/i, 'company.name'],

  // Finance
  [/\b(account_?number|acct)\b/i, 'finance.accountNumber'],
  [/\b(currency|currency_?code)\b/i, 'finance.currency'],
  [/\b(credit_?card|card_?number|cc)\b/i, 'finance.creditCard'],
  [/\b(iban)\b/i, 'finance.iban'],

  // Phone
  [/\b(phone|phone_?number|tel|telephone|mobile|cell)\b/i, 'phone.number'],
];

/**
 * Auto-detect the best provider for a given column name and data type.
 * Returns the provider id, or a sensible default based on data type.
 */
export function autoDetectProvider(columnName: string, dataType: string): string {
  // Try matching column name patterns first
  for (const [pattern, providerId] of columnPatterns) {
    if (pattern.test(columnName)) {
      return providerId;
    }
  }

  // Fall back to data type matching
  const dt = dataType.toLowerCase();
  if (dt.includes('int') || dt.includes('serial')) return 'number.int';
  if (dt.includes('float') || dt.includes('double') || dt.includes('decimal') || dt.includes('numeric') || dt.includes('real')) return 'number.float';
  if (dt.includes('bool')) return 'number.boolean';
  if (dt.includes('date') && dt.includes('time')) return 'date.datetime';
  if (dt.includes('date')) return 'date.past';
  if (dt.includes('time')) return 'date.datetime';
  if (dt.includes('uuid')) return 'text.uuid';
  if (dt.includes('json')) return 'text.sentence';

  return 'text.word';
}
