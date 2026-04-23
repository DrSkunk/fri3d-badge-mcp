/**
 * Lightweight Porter-style suffix stemmer.
 *
 * Sphinx's `searchindex.js` stores tokens in their stemmed form (English
 * Porter stemmer). To match a user query against the index we either need to
 * do the exact same stemming, or — pragmatically — strip a small set of
 * common suffixes and also try prefix-matching keys against the result.
 *
 * This is intentionally tiny and avoids a heavy dependency. It is good enough
 * for technical docs queries (`pins`, `interrupts`, `controlling`, …).
 */

const SUFFIXES = [
  "ationally",
  "ization",
  "ization",
  "ational",
  "fulness",
  "ousness",
  "iveness",
  "tional",
  "biliti",
  "lessli",
  "entli",
  "ation",
  "alism",
  "aliti",
  "iviti",
  "ement",
  "ement",
  "ables",
  "ables",
  "ibles",
  "ousli",
  "ation",
  "ators",
  "izers",
  "izing",
  "ation",
  "ings",
  "ings",
  "ness",
  "ment",
  "ence",
  "ance",
  "able",
  "ible",
  "ical",
  "ized",
  "izer",
  "ous",
  "ive",
  "ate",
  "iti",
  "ful",
  "ion",
  "ing",
  "est",
  "ies",
  "ied",
  "ed",
  "es",
  "er",
  "ly",
  "s",
];

export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suf of SUFFIXES) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}
