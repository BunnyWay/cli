import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { RECORD_TYPES } from "../../../core/dns-record-types.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];

/** A value the preset needs from the user (account-specific keys, selectors, codes). */
export interface PresetParam {
  key: string;
  message: string;
  initial?: string;
  optional?: boolean;
}

export interface PresetContext {
  domain: string;
  params: Record<string, string>;
}

export interface DnsPreset {
  id: string;
  title: string;
  category: "Email" | "Email security" | "Verification";
  description: string;
  aliases?: string[];
  params: PresetParam[];
  build: (ctx: PresetContext) => AddDnsRecordModel[];
}

/** "@" / "" both mean the zone apex, which the API represents as an empty name. */
const at = (name: string) => (name === "@" ? "" : name);

const mx = (
  name: string,
  value: string,
  priority: number,
): AddDnsRecordModel => ({
  Type: RECORD_TYPES.MX,
  Name: at(name),
  Value: value,
  Priority: priority,
});
const txt = (name: string, value: string): AddDnsRecordModel => ({
  Type: RECORD_TYPES.TXT,
  Name: at(name),
  Value: value,
});
const cname = (name: string, value: string): AddDnsRecordModel => ({
  Type: RECORD_TYPES.CNAME,
  Name: at(name),
  Value: value,
});
const caa = (name: string, tag: string, value: string): AddDnsRecordModel => ({
  Type: RECORD_TYPES.CAA,
  Name: at(name),
  Flags: 0,
  Tag: tag,
  Value: value,
});

/** Assemble a DMARC policy string without trailing separators. */
function dmarc(policy: string, report?: string): string {
  const parts = ["v=DMARC1", `p=${policy}`];
  if (report) parts.push(`rua=mailto:${report}`);
  return parts.join("; ");
}

export const PRESETS: DnsPreset[] = [
  {
    id: "google-workspace",
    title: "Google Workspace",
    category: "Email",
    description: "Gmail-hosted email: MX, SPF, optional DKIM and DMARC.",
    aliases: ["gmail", "gsuite"],
    params: [
      {
        key: "dkim",
        message: "Google DKIM TXT value (Admin console)",
        optional: true,
      },
      { key: "dmarc", message: "DMARC report email", optional: true },
    ],
    build: ({ params }) => {
      const records = [
        mx("@", "smtp.google.com", 1),
        txt("@", "v=spf1 include:_spf.google.com ~all"),
      ];
      if (params.dkim) records.push(txt("google._domainkey", params.dkim));
      if (params.dmarc)
        records.push(txt("_dmarc", dmarc("none", params.dmarc)));
      return records;
    },
  },
  {
    id: "microsoft365",
    title: "Microsoft 365 (Outlook)",
    category: "Email",
    description: "Microsoft 365 / Outlook: MX, SPF, autodiscover.",
    aliases: ["outlook", "office365", "o365"],
    params: [{ key: "dmarc", message: "DMARC report email", optional: true }],
    build: ({ domain, params }) => {
      const mxHost = `${domain.replace(/\./g, "-")}.mail.protection.outlook.com`;
      const records = [
        mx("@", mxHost, 0),
        txt("@", "v=spf1 include:spf.protection.outlook.com -all"),
        cname("autodiscover", "autodiscover.outlook.com"),
      ];
      if (params.dmarc)
        records.push(txt("_dmarc", dmarc("none", params.dmarc)));
      return records;
    },
  },
  {
    id: "zoho",
    title: "Zoho Mail",
    category: "Email",
    description: "Zoho-hosted email: MX, SPF, optional verification and DKIM.",
    params: [
      {
        key: "region",
        message: "Zoho region TLD (com, eu, in, ...)",
        initial: "com",
      },
      { key: "verify", message: "zoho-verification code", optional: true },
      { key: "dkimSelector", message: "DKIM selector", initial: "zmail" },
      { key: "dkim", message: "DKIM TXT value", optional: true },
    ],
    build: ({ params }) => {
      const region = params.region || "com";
      const records = [
        mx("@", `mx.zoho.${region}`, 10),
        mx("@", `mx2.zoho.${region}`, 20),
        mx("@", `mx3.zoho.${region}`, 50),
        txt("@", `v=spf1 include:zoho.${region} ~all`),
      ];
      if (params.verify)
        records.push(txt("@", `zoho-verification=${params.verify}`));
      if (params.dkim)
        records.push(
          txt(`${params.dkimSelector || "zmail"}._domainkey`, params.dkim),
        );
      return records;
    },
  },
  {
    id: "mailgun",
    title: "Mailgun",
    category: "Email",
    description:
      "Mailgun sending domain: SPF, DKIM, receiving MX, tracking CNAME.",
    params: [
      { key: "sub", message: "Sending subdomain", initial: "mg" },
      { key: "dkimSelector", message: "DKIM selector", initial: "mx" },
      { key: "dkim", message: "DKIM TXT value", optional: true },
    ],
    build: ({ params }) => {
      const sub = params.sub || "mg";
      const selector = params.dkimSelector || "mx";
      const records = [
        txt(sub, "v=spf1 include:mailgun.org ~all"),
        mx(sub, "mxa.mailgun.org", 10),
        mx(sub, "mxb.mailgun.org", 10),
        cname(`email.${sub}`, "mailgun.org"),
      ];
      if (params.dkim)
        records.push(txt(`${selector}._domainkey.${sub}`, params.dkim));
      return records;
    },
  },
  {
    id: "resend",
    title: "Resend",
    category: "Email",
    description: "Resend sending domain: MX, SPF, DKIM.",
    params: [
      { key: "sub", message: "Sending subdomain", initial: "send" },
      { key: "region", message: "Resend/SES region", initial: "us-east-1" },
      {
        key: "dkim",
        message: "resend._domainkey.<sub> TXT value",
        optional: true,
      },
    ],
    build: ({ params }) => {
      const sub = params.sub || "send";
      const region = params.region || "us-east-1";
      const records = [
        mx(sub, `feedback-smtp.${region}.amazonses.com`, 10),
        txt(sub, "v=spf1 include:amazonses.com ~all"),
      ];
      // Resend expects the DKIM host under the sending subdomain (resend._domainkey.send), not the apex.
      if (params.dkim)
        records.push(txt(`resend._domainkey.${sub}`, params.dkim));
      return records;
    },
  },
  {
    id: "proton",
    title: "Proton Mail",
    category: "Email",
    description: "Proton Mail: verification, MX, SPF, optional DKIM CNAMEs.",
    aliases: ["protonmail"],
    params: [
      {
        key: "verify",
        message: "protonmail-verification code",
        optional: true,
      },
      { key: "dkim1", message: "DKIM CNAME target 1", optional: true },
      { key: "dkim2", message: "DKIM CNAME target 2", optional: true },
      { key: "dkim3", message: "DKIM CNAME target 3", optional: true },
    ],
    build: ({ params }) => {
      const records: AddDnsRecordModel[] = [];
      if (params.verify)
        records.push(txt("@", `protonmail-verification=${params.verify}`));
      records.push(mx("@", "mail.protonmail.ch", 10));
      records.push(mx("@", "mailsec.protonmail.ch", 20));
      records.push(txt("@", "v=spf1 include:_spf.protonmail.ch ~all"));
      if (params.dkim1)
        records.push(cname("protonmail._domainkey", params.dkim1));
      if (params.dkim2)
        records.push(cname("protonmail2._domainkey", params.dkim2));
      if (params.dkim3)
        records.push(cname("protonmail3._domainkey", params.dkim3));
      return records;
    },
  },
  {
    id: "bluesky",
    title: "Bluesky handle",
    category: "Verification",
    description:
      "Verify a domain as a Bluesky handle via an _atproto TXT record.",
    params: [
      { key: "did", message: "Your DID (did:plc:...)" },
      {
        key: "handle",
        message: "Handle subdomain (blank for the apex)",
        optional: true,
      },
    ],
    build: ({ params }) => {
      const name = params.handle ? `_atproto.${params.handle}` : "_atproto";
      return [txt(name, `did=${params.did}`)];
    },
  },
  {
    id: "dmarc",
    title: "DMARC policy",
    category: "Email security",
    description:
      "A DMARC record at _dmarc with a chosen policy and report address.",
    params: [
      {
        key: "policy",
        message: "Policy (none, quarantine, reject)",
        initial: "none",
      },
      { key: "report", message: "DMARC report email", optional: true },
    ],
    build: ({ params }) => [
      txt("_dmarc", dmarc(params.policy || "none", params.report)),
    ],
  },
  {
    id: "caa",
    title: "CAA (restrict certificate issuance)",
    category: "Email security",
    description: "Limit which CAs may issue certificates for this domain.",
    params: [
      { key: "ca", message: "Allowed CA domain", initial: "letsencrypt.org" },
    ],
    build: ({ params }) => [caa("@", "issue", params.ca || "letsencrypt.org")],
  },
  {
    id: "no-email",
    title: "No email (anti-spoofing)",
    category: "Email security",
    description:
      "Null MX, SPF -all, and a reject DMARC for a domain that never sends mail.",
    params: [],
    build: () => [
      mx("@", ".", 0),
      txt("@", "v=spf1 -all"),
      txt("_dmarc", dmarc("reject")),
    ],
  },
];

/** Find a preset by id or alias, case-insensitively. */
export function findPreset(name: string): DnsPreset | undefined {
  const needle = name.trim().toLowerCase();
  return PRESETS.find(
    (t) =>
      t.id === needle ||
      (t.aliases ?? []).some((a) => a.toLowerCase() === needle),
  );
}
