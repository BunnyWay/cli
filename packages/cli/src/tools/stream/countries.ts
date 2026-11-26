import { UserError } from "@bunny.net/openapi-client";

/** Where the supported countries are documented; kept in step with the table there. */
export const GEO_BLOCKING_DOCS_URL =
  "https://bunny.net/docs/stream/geo-blocking#supported-countries-and-codes";

/**
 * The countries and territories geo-blocking supports, exactly as the docs
 * list them: ISO 3166-1 alpha-2 codes, with GB (not UK) for the United
 * Kingdom and XK for Kosovo. Antarctica (AQ) is not on the list.
 */
export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  ["AF", "Afghanistan"],
  ["AX", "Åland Islands"],
  ["AL", "Albania"],
  ["DZ", "Algeria"],
  ["AS", "American Samoa"],
  ["AD", "Andorra"],
  ["AO", "Angola"],
  ["AI", "Anguilla"],
  ["AG", "Antigua and Barbuda"],
  ["AR", "Argentina"],
  ["AM", "Armenia"],
  ["AW", "Aruba"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["AZ", "Azerbaijan"],
  ["BS", "Bahamas"],
  ["BH", "Bahrain"],
  ["BD", "Bangladesh"],
  ["BB", "Barbados"],
  ["BY", "Belarus"],
  ["BE", "Belgium"],
  ["BZ", "Belize"],
  ["BJ", "Benin"],
  ["BM", "Bermuda"],
  ["BT", "Bhutan"],
  ["BO", "Bolivia"],
  ["BA", "Bosnia and Herzegovina"],
  ["BW", "Botswana"],
  ["BV", "Bouvet Island"],
  ["BR", "Brazil"],
  ["IO", "British Indian Ocean Territory"],
  ["VG", "British Virgin Islands"],
  ["BN", "Brunei"],
  ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"],
  ["BI", "Burundi"],
  ["KH", "Cambodia"],
  ["CM", "Cameroon"],
  ["CA", "Canada"],
  ["CV", "Cape Verde"],
  ["BQ", "Caribbean Netherlands"],
  ["KY", "Cayman Islands"],
  ["CF", "Central African Republic"],
  ["TD", "Chad"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CX", "Christmas Island"],
  ["CC", "Cocos (Keeling) Islands"],
  ["CO", "Colombia"],
  ["KM", "Comoros"],
  ["CG", "Congo"],
  ["CD", "Congo (DRC)"],
  ["CK", "Cook Islands"],
  ["CR", "Costa Rica"],
  ["CI", "Côte d'Ivoire"],
  ["HR", "Croatia"],
  ["CU", "Cuba"],
  ["CW", "Curaçao"],
  ["CY", "Cyprus"],
  ["CZ", "Czech Republic"],
  ["DK", "Denmark"],
  ["DJ", "Djibouti"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["EC", "Ecuador"],
  ["EG", "Egypt"],
  ["SV", "El Salvador"],
  ["GQ", "Equatorial Guinea"],
  ["ER", "Eritrea"],
  ["EE", "Estonia"],
  ["SZ", "Eswatini"],
  ["ET", "Ethiopia"],
  ["FK", "Falkland Islands"],
  ["FO", "Faroe Islands"],
  ["FJ", "Fiji"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GF", "French Guiana"],
  ["PF", "French Polynesia"],
  ["TF", "French Southern Territories"],
  ["GA", "Gabon"],
  ["GM", "Gambia"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GH", "Ghana"],
  ["GI", "Gibraltar"],
  ["GR", "Greece"],
  ["GL", "Greenland"],
  ["GD", "Grenada"],
  ["GP", "Guadeloupe"],
  ["GU", "Guam"],
  ["GT", "Guatemala"],
  ["GG", "Guernsey"],
  ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"],
  ["GY", "Guyana"],
  ["HT", "Haiti"],
  ["HM", "Heard Island and McDonald Islands"],
  ["HN", "Honduras"],
  ["HK", "Hong Kong"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["IR", "Iran"],
  ["IQ", "Iraq"],
  ["IE", "Ireland"],
  ["IM", "Isle of Man"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JM", "Jamaica"],
  ["JP", "Japan"],
  ["JE", "Jersey"],
  ["JO", "Jordan"],
  ["KZ", "Kazakhstan"],
  ["KE", "Kenya"],
  ["KI", "Kiribati"],
  ["XK", "Kosovo"],
  ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"],
  ["LA", "Laos"],
  ["LV", "Latvia"],
  ["LB", "Lebanon"],
  ["LS", "Lesotho"],
  ["LR", "Liberia"],
  ["LY", "Libya"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MO", "Macao"],
  ["MG", "Madagascar"],
  ["MW", "Malawi"],
  ["MY", "Malaysia"],
  ["MV", "Maldives"],
  ["ML", "Mali"],
  ["MT", "Malta"],
  ["MH", "Marshall Islands"],
  ["MQ", "Martinique"],
  ["MR", "Mauritania"],
  ["MU", "Mauritius"],
  ["YT", "Mayotte"],
  ["MX", "Mexico"],
  ["FM", "Micronesia"],
  ["MD", "Moldova"],
  ["MC", "Monaco"],
  ["MN", "Mongolia"],
  ["ME", "Montenegro"],
  ["MS", "Montserrat"],
  ["MA", "Morocco"],
  ["MZ", "Mozambique"],
  ["MM", "Myanmar"],
  ["NA", "Namibia"],
  ["NR", "Nauru"],
  ["NP", "Nepal"],
  ["NL", "Netherlands"],
  ["NC", "New Caledonia"],
  ["NZ", "New Zealand"],
  ["NI", "Nicaragua"],
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["NU", "Niue"],
  ["NF", "Norfolk Island"],
  ["KP", "North Korea"],
  ["MK", "North Macedonia"],
  ["MP", "Northern Mariana Islands"],
  ["NO", "Norway"],
  ["OM", "Oman"],
  ["PK", "Pakistan"],
  ["PW", "Palau"],
  ["PS", "Palestine"],
  ["PA", "Panama"],
  ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PN", "Pitcairn Islands"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["PR", "Puerto Rico"],
  ["QA", "Qatar"],
  ["RE", "Réunion"],
  ["RO", "Romania"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["BL", "Saint Barthélemy"],
  ["SH", "Saint Helena (incl. Ascension and Tristan da Cunha)"],
  ["KN", "Saint Kitts and Nevis"],
  ["LC", "Saint Lucia"],
  ["MF", "Saint Martin (French part)"],
  ["PM", "Saint Pierre and Miquelon"],
  ["VC", "Saint Vincent and the Grenadines"],
  ["WS", "Samoa"],
  ["SM", "San Marino"],
  ["ST", "Sao Tome and Principe"],
  ["SA", "Saudi Arabia"],
  ["SN", "Senegal"],
  ["RS", "Serbia"],
  ["SC", "Seychelles"],
  ["SL", "Sierra Leone"],
  ["SG", "Singapore"],
  ["SX", "Sint Maarten (Dutch part)"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["SB", "Solomon Islands"],
  ["SO", "Somalia"],
  ["ZA", "South Africa"],
  ["GS", "South Georgia and the South Sandwich Islands"],
  ["KR", "South Korea"],
  ["SS", "South Sudan"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["SD", "Sudan"],
  ["SR", "Suriname"],
  ["SJ", "Svalbard and Jan Mayen"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["SY", "Syria"],
  ["TW", "Taiwan"],
  ["TJ", "Tajikistan"],
  ["TZ", "Tanzania"],
  ["TH", "Thailand"],
  ["TL", "Timor-Leste"],
  ["TG", "Togo"],
  ["TK", "Tokelau"],
  ["TO", "Tonga"],
  ["TT", "Trinidad and Tobago"],
  ["TN", "Tunisia"],
  ["TR", "Turkey"],
  ["TM", "Turkmenistan"],
  ["TC", "Turks and Caicos Islands"],
  ["TV", "Tuvalu"],
  ["UG", "Uganda"],
  ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["UM", "US Minor Outlying Islands"],
  ["VI", "US Virgin Islands"],
  ["UZ", "Uzbekistan"],
  ["VU", "Vanuatu"],
  ["VA", "Vatican City"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["WF", "Wallis and Futuna"],
  ["EH", "Western Sahara"],
  ["YE", "Yemen"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
].map(([code, name]) => ({ code: code as string, name: name as string }));

export const COUNTRY_CODES: readonly string[] = COUNTRIES.map((c) => c.code);

const NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name]));

/** Upper-case, validate and dedupe country codes; `UK` is accepted and stored as `GB`. */
export function parseCountryCodes(values: readonly string[]): string[] {
  const codes = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .map((code) => (code === "UK" ? "GB" : code));
  const invalid = codes.filter((code) => !NAMES.has(code));
  if (invalid.length > 0) {
    throw new UserError(
      `Unsupported country code(s): ${[...new Set(invalid)].join(", ")}.`,
      `Use ISO 3166-1 alpha-2 codes from the supported list (GB for the United Kingdom, XK for Kosovo): ${GEO_BLOCKING_DOCS_URL}`,
    );
  }
  return [...new Set(codes)];
}

/** A country's name as the docs list it, or the code itself when unknown. */
export function countryName(code: string): string {
  return NAMES.get(code) ?? code;
}

const OCEANIA =
  "AS AU CX CC CK FJ PF GU HM KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV UM VU WF";
const EU =
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE";
const EEA = `${EU} IS LI NO`;

/**
 * Geo-blocking presets, exactly as the docs define them. A preset only adds
 * its countries to the list; whether the list blocks or allows them is up to
 * the mode, and presets can be combined with each other and with codes.
 */
export const GEO_PRESETS: Readonly<
  Record<string, { name: string; group: string; codes: readonly string[] }>
> = Object.fromEntries(
  (
    [
      [
        "africa",
        "Africa",
        "Continents",
        "DZ AO BJ BW IO BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET TF GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
      ],
      [
        "asia",
        "Asia",
        "Continents",
        "AF AM AZ BH BD BT BN KH CN GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE",
      ],
      [
        "europe",
        "Europe",
        "Continents",
        "AX AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA",
      ],
      [
        "north-america",
        "North America",
        "Continents",
        "AI AG AW BS BB BZ BM VG CA BQ KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI",
      ],
      ["oceania", "Oceania", "Continents", OCEANIA],
      [
        "south-america",
        "South America",
        "Continents",
        "AR BO BV BR CL CO EC FK GF GY PY PE GS SR UY VE",
      ],
      ["eu", "European Union (EU)", "Data protection", EU],
      ["eea", "EEA (GDPR)", "Data protection", EEA],
      [
        "eea-uk",
        "EEA and UK (GDPR and UK GDPR)",
        "Data protection",
        `${EEA} GB`,
      ],
      [
        "apac",
        "Asia-Pacific (APAC)",
        "Regions",
        `${OCEANIA} BD BT BN KH CN HK IN ID JP LA MO MY MV MN MM NP KP PK PH SG KR LK TW TH TL VN`,
      ],
      ["anz", "Australia and New Zealand", "Regions", "AU NZ"],
      ["benelux", "Benelux", "Regions", "BE LU NL"],
      ["dach", "DACH", "Regions", "AT DE CH"],
      [
        "latam",
        "Latin America (LATAM)",
        "Regions",
        "AR BO BR CL CO CR CU DO EC SV GT HT HN MX NI PA PY PE PR UY VE",
      ],
      [
        "mena",
        "Middle East and North Africa (MENA)",
        "Regions",
        "DZ BH DJ EG IR IQ IL JO KW LB LY MA OM PS QA SA SY TN AE YE",
      ],
      ["nordics", "Nordics", "Regions", "AX DK FO FI GL IS NO SE"],
      ["uk-ireland", "UK and Ireland", "Regions", "GG IE IM JE GB"],
      ["us-canada", "US and Canada", "Regions", "AS CA GU MP PR US VI"],
    ] as const
  ).map(([id, name, group, codes]) => [
    id,
    { name, group, codes: codes.split(" ") },
  ]),
);

export const GEO_PRESET_IDS = Object.keys(GEO_PRESETS);

/** The countries of one or more presets (comma-separated or repeated), deduplicated. */
export function expandGeoPresets(values: readonly string[]): string[] {
  const ids = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const unknown = ids.filter((id) => !GEO_PRESETS[id]);
  if (unknown.length > 0) {
    throw new UserError(
      `Unknown geo-blocking preset(s): ${[...new Set(unknown)].join(", ")}.`,
      `Presets: ${GEO_PRESET_IDS.join(", ")}.`,
    );
  }
  return [...new Set(ids.flatMap((id) => GEO_PRESETS[id]?.codes ?? []))];
}
