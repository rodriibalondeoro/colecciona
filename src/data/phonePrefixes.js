import { COUNTRIES } from "./countries";

// Prefijos telefónicos por código de país (ISO 3166-1 alpha-2).
// Mantener sincronizado con `COUNTRIES`: los prefijos del registro se
// generan a partir de esa misma lista para que SIEMPRE coincidan.
export const COUNTRY_DIAL = {
  ES: "+34",
  MX: "+52",
  AR: "+54",
  CO: "+57",
  PE: "+51",
  CL: "+56",
  VE: "+58",
  EC: "+593",
  BO: "+591",
  PY: "+595",
  UY: "+598",
  BR: "+55",
  CU: "+53",
  DO: "+1809",
  GT: "+502",
  HN: "+504",
  SV: "+503",
  NI: "+505",
  CR: "+506",
  PA: "+507",
  PR: "+1787",
  PT: "+351",
  FR: "+33",
  DE: "+49",
  IT: "+39",
  GB: "+44",
  IE: "+353",
  NL: "+31",
  BE: "+32",
  CH: "+41",
  AT: "+43",
  SE: "+46",
  NO: "+47",
  DK: "+45",
  FI: "+358",
  PL: "+48",
  CZ: "+420",
  GR: "+30",
  RO: "+40",
  HU: "+36",
  HR: "+385",
  SI: "+386",
  RS: "+381",
  BG: "+359",
  TR: "+90",
  UA: "+380",
  MA: "+212",
  DZ: "+213",
  TN: "+216",
  EG: "+20",
  ZA: "+27",
  NG: "+234",
  KE: "+254",
  IL: "+972",
  AE: "+971",
  SA: "+966",
  IN: "+91",
  PK: "+92",
  CN: "+86",
  JP: "+81",
  KR: "+82",
  TH: "+66",
  VN: "+84",
  ID: "+62",
  MY: "+60",
  SG: "+65",
  PH: "+63",
  AU: "+61",
  NZ: "+64",
  CA: "+1",
  US: "+1",
  IS: "+354",
};

function flagEmoji(code) {
  return String(code)
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// Opciones de prefijo derivadas SIEMPRE de COUNTRIES (misma fuente que el perfil)
export function phonePrefixOptions() {
  return COUNTRIES.map((c) => ({
    id: c.code,
    label: c.name,
    code: COUNTRY_DIAL[c.code] || "",
    flag: flagEmoji(c.code),
  })).filter((p) => p.code);
}