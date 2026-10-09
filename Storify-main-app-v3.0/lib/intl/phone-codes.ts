// International dialing codes shared across forms.
// Extracted from the vendor registration form so the phone-code select can be
// reused by any form that needs a country dial code + phone number field.

interface PhoneCodeOption {
  value: string;
  label: string;
}

// Shortlisted, commonly used dialing codes shown at the top of the select.
export const PHONE_CODES: PhoneCodeOption[] = [
  { value: "+1", label: "+1 (US/CA)" },
  { value: "+44", label: "+44 (UK)" },
  { value: "+91", label: "+91 (India)" },
  { value: "+86", label: "+86 (China)" },
  { value: "+81", label: "+81 (Japan)" },
  { value: "+49", label: "+49 (Germany)" },
  { value: "+33", label: "+33 (France)" },
  { value: "+39", label: "+39 (Italy)" },
  { value: "+34", label: "+34 (Spain)" },
  { value: "+61", label: "+61 (Australia)" },
  { value: "+55", label: "+55 (Brazil)" },
  { value: "+7", label: "+7 (Russia)" },
  { value: "+82", label: "+82 (S. Korea)" },
  { value: "+52", label: "+52 (Mexico)" },
  { value: "+62", label: "+62 (Indonesia)" },
  { value: "+90", label: "+90 (Turkey)" },
  { value: "+966", label: "+966 (Saudi)" },
  { value: "+971", label: "+971 (UAE)" },
  { value: "+880", label: "+880 (BD)" },
  { value: "+92", label: "+92 (Pakistan)" },
  { value: "+234", label: "+234 (Nigeria)" },
  { value: "+27", label: "+27 (S. Africa)" },
  { value: "+20", label: "+20 (Egypt)" },
  { value: "+63", label: "+63 (Philippines)" },
  { value: "+84", label: "+84 (Vietnam)" },
  { value: "+66", label: "+66 (Thailand)" },
  { value: "+60", label: "+60 (Malaysia)" },
  { value: "+65", label: "+65 (Singapore)" },
  { value: "+977", label: "+977 (Nepal)" },
  { value: "+94", label: "+94 (Sri Lanka)" },
  { value: "+213", label: "+213 (Algeria)" },
  { value: "+256", label: "+256 (Uganda)" },
];

/**
 * Compose a dial code and a locally entered number into one international
 * phone string, tolerating users who retype the country code:
 *   ("+91", "98765 43210")      -> "+919876543210"
 *   ("+91", "098765 43210")     -> "+919876543210"   (trunk "0" dropped)
 *   ("+91", "+91 98765 43210")  -> "+919876543210"   (no "+91+91...")
 *   ("+91", "0091 98765 43210") -> "+919876543210"
 * Input that starts with "+" or "00" is taken as already-international and
 * used as-is; bare digits are treated as a national number behind `dialCode`.
 * Returns "" when no digits were entered.
 */
export function composeInternationalPhone(
  dialCode: string,
  localNumber: string,
): string {
  const raw = String(localNumber || "").trim();
  const codeDigits = String(dialCode || "").replace(/\D/g, "");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (raw.startsWith("+") || raw.startsWith("00")) {
    if (raw.startsWith("00")) digits = digits.slice(2);
    return digits ? `+${digits}` : "";
  }

  // National format: drop a single leading trunk "0".
  digits = digits.replace(/^0/, "");
  if (!digits) return "";
  return `+${codeDigits}${digits}`;
}

// Country (ISO 3166-1 alpha-2) -> international dialing code.
export const COUNTRY_DIAL_CODES: Record<string, string> = {
  AF: "+93", AX: "+358", AL: "+355", DZ: "+213", AS: "+1684", AD: "+376",
  AO: "+244", AI: "+1264", AQ: "+672", AG: "+1268", AR: "+54", AM: "+374",
  AW: "+297", AU: "+61", AT: "+43", AZ: "+994", BS: "+1242", BH: "+973",
  BD: "+880", BB: "+1246", BY: "+375", BE: "+32", BZ: "+501", BJ: "+229",
  BM: "+1441", BT: "+975", BO: "+591", BA: "+387", BW: "+267", BR: "+55",
  IO: "+246", VG: "+1284", BN: "+673", BG: "+359", BF: "+226", BI: "+257",
  KH: "+855", CM: "+237", CA: "+1", CV: "+238", BQ: "+599", KY: "+1345",
  CF: "+236", TD: "+235", CL: "+56", CN: "+86", CX: "+61", CC: "+61",
  CO: "+57", KM: "+269", CG: "+242", CK: "+682", CR: "+506", HR: "+385",
  CU: "+53", CW: "+599", CY: "+357", CZ: "+420", CD: "+243", DK: "+45",
  DJ: "+253", DM: "+1767", DO: "+1809", EC: "+593", EG: "+20", SV: "+503",
  GQ: "+240", ER: "+291", EE: "+372", SZ: "+268", ET: "+251", FK: "+500",
  FO: "+298", FJ: "+679", FI: "+358", FR: "+33", GF: "+594", PF: "+689",
  GA: "+241", GM: "+220", GE: "+995", DE: "+49", GH: "+233", GI: "+350",
  GR: "+30", GL: "+299", GD: "+1473", GP: "+590", GU: "+1671", GT: "+502",
  GG: "+44", GN: "+224", GW: "+245", GY: "+592", HT: "+509", HN: "+504",
  HK: "+852", HU: "+36", IS: "+354", IN: "+91", ID: "+62", IR: "+98",
  IQ: "+964", IE: "+353", IM: "+44", IL: "+972", IT: "+39", CI: "+225",
  JM: "+1876", JP: "+81", JE: "+44", JO: "+962", KZ: "+7", KE: "+254",
  KI: "+686", XK: "+383", KW: "+965", KG: "+996", LA: "+856", LV: "+371",
  LB: "+961", LS: "+266", LR: "+231", LY: "+218", LI: "+423", LT: "+370",
  LU: "+352", MO: "+853", MG: "+261", MW: "+265", MY: "+60", MV: "+960",
  ML: "+223", MT: "+356", MH: "+692", MQ: "+596", MR: "+222", MU: "+230",
  YT: "+262", MX: "+52", FM: "+691", MD: "+373", MC: "+377", MN: "+976",
  ME: "+382", MS: "+1664", MA: "+212", MZ: "+258", MM: "+95", NA: "+264",
  NR: "+674", NP: "+977", NL: "+31", NC: "+687", NZ: "+64", NI: "+505",
  NE: "+227", NG: "+234", NU: "+683", NF: "+672", KP: "+850", MK: "+389",
  MP: "+1670", NO: "+47", OM: "+968", PK: "+92", PW: "+680", PS: "+970",
  PA: "+507", PG: "+675", PY: "+595", PE: "+51", PH: "+63", PN: "+64",
  PL: "+48", PT: "+351", PR: "+1787", QA: "+974", RE: "+262", RO: "+40",
  RU: "+7", RW: "+250", BL: "+590", SH: "+290", KN: "+1869", LC: "+1758",
  MF: "+590", PM: "+508", VC: "+1784", WS: "+685", SM: "+378", ST: "+239",
  SA: "+966", SN: "+221", RS: "+381", SC: "+248", SL: "+232", SG: "+65",
  SX: "+1721", SK: "+421", SI: "+386", SB: "+677", SO: "+252", ZA: "+27",
  GS: "+500", KR: "+82", SS: "+211", ES: "+34", LK: "+94", SD: "+249",
  SR: "+597", SJ: "+47", SE: "+46", CH: "+41", SY: "+963", TW: "+886",
  TJ: "+992", TZ: "+255", TH: "+66", TL: "+670", TG: "+228", TK: "+690",
  TO: "+676", TT: "+1868", TN: "+216", TR: "+90", TM: "+993", TC: "+1649",
  TV: "+688", UG: "+256", UA: "+380", AE: "+971", GB: "+44", US: "+1",
  UM: "+1", VI: "+1340", UY: "+598", UZ: "+998", VU: "+678", VA: "+379",
  VE: "+58", VN: "+84", WF: "+681", EH: "+212", YE: "+967", ZM: "+260",
  ZW: "+263",
};
